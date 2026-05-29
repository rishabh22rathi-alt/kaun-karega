import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/auth";
import { isProviderWorkIntakeAiEnabled } from "@/lib/featureFlags";
import { resolveCategoryAliasDetailed } from "@/lib/categoryAliases";
import {
  findActiveCanonical,
  loadActiveAliasKeys,
  loadActiveAliasesByCanonical,
  loadActiveCategoryNames,
  normalizeCategoryKey,
} from "@/lib/workIntake/categoryCandidates";
import { findDeniedTerm } from "@/lib/workIntake/safety";
import { classifyWorkIntake } from "@/lib/workIntake/resolvePrompt";
import {
  WORK_INTAKE_CONFIDENCE_FLOOR,
  WORK_INTAKE_MAX_TAG_LEN,
  WORK_INTAKE_MAX_TAGS,
  WORK_INTAKE_MAX_TEXT,
  type WorkIntakeAiRaw,
  type WorkIntakeResolveResponse,
  type WorkIntakeWorkTag,
} from "@/lib/workIntake/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY resolve endpoint (Phase 2A). Writes ZERO rows to any table — it only
// SELECTs active categories/aliases for closed-set validation. The provider must
// confirm anything before it touches their selection (later phase). Gated by
// PROVIDER_WORK_INTAKE_AI_ENABLED; falls back to manual on any failure.
//
// Test hook: when PROVIDER_WORK_INTAKE_TEST_HOOK === "true", three request
// headers are honored so the deterministic server logic can be tested without a
// real AI call or DB:
//   - x-kk-ai-mock:         JSON WorkIntakeAiRaw (skips the Anthropic call)
//   - x-kk-categories-mock: comma-separated active category names (skips the
//                           categories DB read). When provided WITHOUT
//                           x-kk-aliases-mock, the alias DB read is also
//                           skipped (legacy behaviour — isExistingAlias=false).
//   - x-kk-aliases-mock:    JSON object { "Canonical": ["alias", ...], ... }
//                           used both to seed the AI candidate block with
//                           alias hints AND to mark isExistingAlias on work
//                           tags. Only honored alongside x-kk-categories-mock.
// The hook env is NEVER set in production, so these headers are ignored there.
// ─────────────────────────────────────────────────────────────────────────────

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function onlyDigits(s: unknown): string {
  return String(s ?? "").replace(/\D/g, "");
}

function testHookEnabled(): boolean {
  return (
    String(process.env.PROVIDER_WORK_INTAKE_TEST_HOOK || "")
      .trim()
      .toLowerCase() === "true"
  );
}

export async function POST(request: Request) {
  // 1) Feature flag — first, so a disabled deployment never authenticates,
  //    loads data, or calls AI. Exact contract from the spec.
  if (!isProviderWorkIntakeAiEnabled()) {
    return noStore({ ok: false, fallbackToManual: true, reason: "AI_DISABLED" });
  }

  // 2) Auth — require a valid signed session only. Phase 2A writes nothing and
  //    needs no provider_id, so we resolve identity from the cookie and skip the
  //    providers-table read. validateVersion:false keeps this inert read-only
  //    path off the profiles session-version DB dependency (documented low-trust
  //    use in lib/auth.ts).
  const session = await getAuthSession({
    cookie: request.headers.get("cookie") ?? "",
    validateVersion: false,
  });
  const phone10 = onlyDigits(session?.phone).slice(-10);
  if (!session || phone10.length !== 10) {
    return noStore(
      { ok: false, fallbackToManual: true, reason: "AI_UNAVAILABLE", error: "UNAUTHORIZED" },
      401
    );
  }

  // 3) Body + validation.
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return noStore(
      { ok: false, fallbackToManual: true, reason: "NO_INPUT" },
      400
    );
  }

  const rawText = typeof body.text === "string" ? body.text.trim() : "";
  if (!rawText) {
    return noStore(
      { ok: false, fallbackToManual: true, reason: "NO_INPUT" },
      400
    );
  }
  // Clamp instead of reject so an over-long paste still resolves.
  const text = rawText.slice(0, WORK_INTAKE_MAX_TEXT);

  const cityRaw =
    typeof body.cityCode === "string" ? body.cityCode.trim().toUpperCase() : "";
  const cityCode = /^[A-Z]{3}$/.test(cityRaw) ? cityRaw : undefined;

  const echo = { text };

  // 4) Deterministic deny-list — authoritative RED. Runs before any AI/DB so an
  //    unsafe request is blocked even if the model is unavailable or wrong.
  const denied = findDeniedTerm(text);
  if (denied) {
    const blocked: WorkIntakeResolveResponse = {
      ok: true,
      safety: "red",
      blocked: true,
      fallbackToManual: false,
      reason: "BLOCKED_UNSAFE",
      mainCategory: null,
      workTags: [],
      requiresAdminReview: false,
      echo,
    };
    return noStore(blocked);
  }

  // Test hook inputs (ignored unless the hook env is on).
  const hookOn = testHookEnabled();
  const categoriesOverrideHeader = hookOn
    ? request.headers.get("x-kk-categories-mock")
    : null;
  const aiMockHeader = hookOn ? request.headers.get("x-kk-ai-mock") : null;
  const aliasesOverrideHeader = hookOn
    ? request.headers.get("x-kk-aliases-mock")
    : null;
  const usingCategoriesOverride =
    typeof categoriesOverrideHeader === "string" &&
    categoriesOverrideHeader.length > 0;
  let aliasesOverride: Record<string, string[]> | null = null;
  if (
    usingCategoriesOverride &&
    typeof aliasesOverrideHeader === "string" &&
    aliasesOverrideHeader.length > 0
  ) {
    try {
      const parsed = JSON.parse(aliasesOverrideHeader) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const norm: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (!Array.isArray(v)) continue;
          norm[k] = v.map((x) => String(x ?? "").trim()).filter(Boolean);
        }
        aliasesOverride = norm;
      }
    } catch {
      // Bad JSON in the test hook → ignore the alias mock, behave as if absent.
      aliasesOverride = null;
    }
  }
  const usingAliasesOverride = aliasesOverride !== null;

  // 5) Load active category candidates (closed set). DB error → manual fallback.
  let activeNames: string[];
  try {
    const override = usingCategoriesOverride
      ? categoriesOverrideHeader.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    activeNames = await loadActiveCategoryNames(override);
  } catch {
    return noStore({ ok: false, fallbackToManual: true, reason: "AI_UNAVAILABLE" });
  }

  // 6) Pre-AI shortcut — if the whole text is already a known active alias or an
  //    exact active canonical, return green WITHOUT calling the model. Membership
  //    is verified against the active set so resolveCategoryAlias's fail-open
  //    passthrough can't masquerade as a match.
  try {
    const detail = await resolveCategoryAliasDetailed(text);
    const viaAlias = detail.matchedAlias
      ? findActiveCanonical(activeNames, detail.canonical)
      : null;
    const viaCanonical = findActiveCanonical(activeNames, text);
    const shortcutCanonical = viaAlias || viaCanonical;
    if (shortcutCanonical) {
      const green: WorkIntakeResolveResponse = {
        ok: true,
        safety: "green",
        blocked: false,
        fallbackToManual: false,
        reason: "OK",
        mainCategory: {
          canonical: shortcutCanonical,
          isExisting: true,
          confidence: 1,
        },
        workTags: [],
        requiresAdminReview: false,
        echo,
      };
      return noStore(green);
    }
  } catch {
    // Shortcut is best-effort; fall through to the AI path.
  }

  // 6b) Aliases-by-canonical for the AI candidate block. Best-effort: a DB
  //     error here returns an empty map, so the AI just sees names (prior
  //     behaviour) — never a hard failure. Under the test hook, the inline
  //     override is used and the DB is skipped.
  let aliasesByCanonical: Map<string, string[]>;
  try {
    aliasesByCanonical = await loadActiveAliasesByCanonical(
      activeNames,
      usingCategoriesOverride ? aliasesOverride ?? {} : undefined
    );
  } catch {
    aliasesByCanonical = new Map();
  }

  // 7) AI classification (or test-hook mock). Any failure → manual fallback.
  let raw: WorkIntakeAiRaw;
  try {
    if (aiMockHeader) {
      const parsed = JSON.parse(aiMockHeader) as Partial<WorkIntakeAiRaw>;
      raw = {
        mainCategory:
          typeof parsed.mainCategory === "string" && parsed.mainCategory.trim()
            ? parsed.mainCategory.trim()
            : null,
        isNew: parsed.isNew === true,
        confidence:
          typeof parsed.confidence === "number"
            ? Math.min(1, Math.max(0, parsed.confidence))
            : 0,
        safety:
          parsed.safety === "green" || parsed.safety === "red"
            ? parsed.safety
            : "yellow",
        workTags: Array.isArray(parsed.workTags)
          ? parsed.workTags.map((t) => String(t ?? "").trim()).filter(Boolean)
          : [],
      };
    } else {
      raw = await classifyWorkIntake({
        text,
        candidates: activeNames,
        aliasesByCanonical,
        cityCode,
      });
    }
  } catch {
    return noStore({ ok: false, fallbackToManual: true, reason: "AI_UNAVAILABLE" });
  }

  // 8) Authoritative post-processing.

  // 8a) Safety RED from the model → block (deny-list already passed, but the
  //     model may flag something the list doesn't).
  if (raw.safety === "red") {
    const blocked: WorkIntakeResolveResponse = {
      ok: true,
      safety: "red",
      blocked: true,
      fallbackToManual: false,
      reason: "BLOCKED_UNSAFE",
      mainCategory: null,
      workTags: [],
      requiresAdminReview: false,
      echo,
    };
    return noStore(blocked);
  }

  // 8b) Closed-set enforcement — the SERVER decides existence, not the AI.
  const matchedCanonical = raw.mainCategory
    ? findActiveCanonical(activeNames, raw.mainCategory)
    : null;
  const isExisting = matchedCanonical !== null;
  const canonical = isExisting
    ? matchedCanonical
    : raw.mainCategory
    ? raw.mainCategory.trim()
    : null;

  let safety = raw.safety; // green | yellow (red already returned)
  let requiresAdminReview = false;
  let reason: WorkIntakeResolveResponse["reason"] = "OK";

  // 8c) Not in the active set → force new + yellow + admin review.
  if (!isExisting) {
    safety = "yellow";
    requiresAdminReview = true;
  }

  // 8d) Low-confidence green → downgrade to yellow.
  if (isExisting && safety === "green" && raw.confidence < WORK_INTAKE_CONFIDENCE_FLOOR) {
    safety = "yellow";
    requiresAdminReview = true;
    reason = "LOW_CONFIDENCE";
  }

  if (safety === "yellow") requiresAdminReview = true;

  // 8e) Work tags — dedupe (normalized), cap count + length. Mark existing
  //     aliases only when we have a real active canonical. Under the test hook,
  //     the inline aliases override (if given) sources the keys; without it the
  //     legacy categories-only override path still skips the alias DB read.
  let aliasKeys: Set<string> = new Set<string>();
  if (isExisting && matchedCanonical) {
    if (usingCategoriesOverride) {
      if (usingAliasesOverride) {
        const list = aliasesByCanonical.get(matchedCanonical) ?? [];
        aliasKeys = new Set(list.map((a) => normalizeCategoryKey(a)));
      }
    } else {
      aliasKeys = await loadActiveAliasKeys(matchedCanonical);
    }
  }

  const seenTagKeys = new Set<string>();
  const workTags: WorkIntakeWorkTag[] = [];
  for (const rawTag of raw.workTags) {
    const label = rawTag.slice(0, WORK_INTAKE_MAX_TAG_LEN).trim();
    if (!label) continue;
    const key = normalizeCategoryKey(label);
    if (!key || seenTagKeys.has(key)) continue;
    seenTagKeys.add(key);
    workTags.push({
      label,
      isExistingAlias: aliasKeys.has(key),
      canonical: canonical ?? null,
    });
    if (workTags.length >= WORK_INTAKE_MAX_TAGS) break;
  }

  const mainCategory = canonical
    ? {
        canonical,
        isExisting,
        confidence: Math.min(1, Math.max(0, raw.confidence)),
      }
    : null;

  const response: WorkIntakeResolveResponse = {
    ok: true,
    safety,
    blocked: false,
    fallbackToManual: false,
    reason,
    mainCategory,
    workTags,
    requiresAdminReview,
    echo,
  };
  return noStore(response);
}
