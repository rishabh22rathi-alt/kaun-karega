"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import confetti from "canvas-confetti";
import InAppToastStack, { type InAppToast } from "@/components/InAppToastStack";
import ProviderAliasSubmitter from "@/components/ProviderAliasSubmitter";
import { PROVIDER_PROFILE_UPDATED_EVENT } from "@/components/sidebarEvents";
import { useTypewriterPlaceholder } from "@/hooks/useTypewriterPlaceholder";
import {
  isProviderWorkIntakeConfirmEnabled,
  isProviderWorkIntakeEnabled,
} from "@/lib/featureFlags";
import ProviderWorkIntakeConfirm, {
  type IntakeState,
} from "@/components/ProviderWorkIntakeConfirm";
import { fetchResolve } from "@/lib/workIntake/clientResolve";
import {
  PROVIDER_PLEDGE_TEXT,
  PROVIDER_PLEDGE_VERSION,
} from "@/lib/disclaimer";

// Change limits here if business rules change.
// Restricted from 3 to 1 — providers register a single canonical service
// category. Aliases / work-tags under that category are surfaced through the
// existing category_aliases table (resolveCategoryAlias) and a separate
// provider-side alias-request endpoint (/api/provider/aliases). Bumping this
// constant alone will NOT re-enable multi-category signup — backend caps in
// /api/kk (provider_register) and /api/provider/update also enforce the limit.
const MAX_CATEGORIES = 1;
// Region-based coverage: provider picks between MIN_REGIONS and
// MAX_REGIONS regions. The client expands each into the canonical areas
// underneath and ships the flat list to the existing provider_areas
// writers — schema and matching stay byte-identical. Custom localities
// (off-region typed strings) still flow into pendingNewAreas /
// area_review_queue for the admin approval lifecycle and are explicitly
// excluded from the region count.
const MIN_REGIONS = 1;
// Hard ceiling kept as a UX safety net. The effective per-render cap is
// `effectiveMaxRegions` (derived from the provider's plan via
// /api/provider/plan). Today's largest single-city region count is 25
// (Jodhpur post-25-region migration), so this number doubles as the
// natural city-wide ceiling. Reduce to 3 if you need to roll the plan-
// aware flow back to the pre-payments behavior.
const MAX_REGIONS = 25;
// Legacy area-count caps — kept only for any downstream code that still
// references them; the new flow gates on region count instead.
const MIN_AREAS = 1;
const MAX_AREAS = 5;

type RegionOption = {
  region_code: string;
  region_name: string;
  areas: string[];
};

type RegisterResponse = {
  ok?: boolean;
  status?: string;
  message?: string;
  error?: string;
  providerId?: string;
  verified?: string;
  pendingApproval?: string;
  requiresAdminApproval?: boolean;
  requestedNewCategories?: string[];
  requestedNewAreas?: string[];
  provider?: {
    ProviderID?: string;
    Name?: string;
    Phone?: string;
    Verified?: string;
    PendingApproval?: string;
    Status?: string;
  };
};

type ProviderProfileResponse = {
  ok?: boolean;
  provider?: {
    ProviderID?: string;
    Name?: string;
    Phone?: string;
    Verified?: string;
    PendingApproval?: string;
    Status?: string;
  };
};

type ProviderByPhoneResponse = {
  ok?: boolean;
  provider?: {
    ProviderID?: string;
    ProviderName?: string;
    Phone?: string;
    Verified?: string;
    Services?: { Category: string }[];
    Areas?: { Area: string }[];
    // Cascade hydration source for edit mode. Empty when the provider
    // has no city_code on any of their provider_areas rows yet.
    CityCode?: string;
    // Source-of-truth selected region set, populated from distinct
    // non-NULL provider_areas.region_code. When present and non-empty,
    // edit-mode hydration uses this directly and skips the legacy
    // area-name inference (which raced /api/provider/plan and could
    // truncate multi-region paid providers to a single visible
    // region). Empty / absent means legacy path: fall back to
    // area-name inference, gated on planLoaded so the cap doesn't
    // truncate.
    RegionCodes?: string[];
  };
  error?: string;
};

// Shape of /api/cities response (Phase 1.1 — public, unauthed). Local
// type instead of importing from publicGeoContext to avoid pulling the
// public cookie+context surface into the provider session.
type CityRow = {
  city_code: string;
  city_name: string;
  state: string;
  country: string;
  is_default: boolean;
};

function normalizePhoneToTen(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits.slice(-10);
}

function normalizePhone10(phoneRaw: string): string {
  const digits = String(phoneRaw || "").replace(/\D/g, "");
  if (!digits) return "";
  const phone10 = digits.length > 10 ? digits.slice(-10) : digits;
  return phone10.length === 10 ? phone10 : "";
}

function getUserPhone(): string {
  const session = getAuthSession();
  if (session?.phone) return normalizePhoneToTen(session.phone);
  return "";
}

function uniqueStrings(items: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    const normalized = item.replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function normalizeCategoryInput(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function categoryKey(value: string): string {
  return normalizeCategoryInput(value).toLowerCase();
}

function removeCategoryKey(list: string[], keyToRemove: string): string[] {
  return list.filter((item) => categoryKey(item) !== keyToRemove);
}

function hasCategoryKey(list: string[], keyToFind: string): boolean {
  return list.some((item) => categoryKey(item) === keyToFind);
}

function toCategoryLookup(list: string[]): Set<string> {
  return new Set(list.map((item) => categoryKey(item)));
}

function uniqueCategoryValues(list: string[]): string[] {
  return uniqueStrings(list.map((item) => normalizeCategoryInput(item)));
}

async function parseJsonSafe(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Server returned invalid JSON");
  }
}

function normalizeLoadError(
  fallbackMessage: string,
  error: unknown,
  responseText?: string,
  responseStatus?: number
) {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("INVALID_JSON")) {
    const preview = message.replace("INVALID_JSON:", "").trim() || String(responseText || "").slice(0, 120);
    return `INVALID_JSON: ${preview || fallbackMessage}`;
  }
  if (message.startsWith("HTTP_ERROR:")) {
    return message.replace("HTTP_ERROR:", "").trim() || fallbackMessage;
  }
  if (responseStatus && responseStatus >= 400) {
    return `HTTP ${responseStatus}: ${String(responseText || "").slice(0, 120) || fallbackMessage}`;
  }
  return message || fallbackMessage;
}

function popConfetti() {
  confetti({ particleCount: 120, spread: 80, startVelocity: 45, origin: { y: 0.7 } });
  confetti({ particleCount: 80, spread: 120, startVelocity: 35, origin: { y: 0.6 } });
}

function normalizeAreaInput(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.toLowerCase().replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function areaKey(value: string): string {
  return normalizeAreaInput(value).toLowerCase();
}

function capitalizeWords(text: string) {
  return text
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Animated placeholder examples for the Phase-1 work-intake textbox. General,
// respectful examples spanning different service types — deliberately NOT
// sweeper-specific (those were discussion-only). Mixed Hindi / Hinglish /
// Marwari-flavoured Devanagari + Latin so providers see they can write in
// whatever script/language is easiest. These are PLACEHOLDER hints only; they
// are never submitted and never influence category selection in this phase.
const WORK_INTAKE_HINTS = [
  "main ghar ka repair ka kaam karta hu...",
  "मैं लोहे और welding ka kaam karta हूँ...",
  "main cooler, fan aur chhote repair karta hu...",
  "मैं decoration aur event ka kaam करता हूँ...",
  "main furniture repair aur polish ka kaam karta hu...",
  "मैं packing, shifting aur loading ka kaam करता हूँ...",
];

function ProviderRegisterPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const areaBoxRef = useRef<HTMLDivElement | null>(null);
  const step2Ref = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const ignoreNextOutsideClickRef = useRef(false);

  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [phone, setPhone] = useState("");

  const [name, setName] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [customCategoryKeys, setCustomCategoryKeys] = useState<string[]>([]);
  // Tag pool from /api/categories?include=aliases. Key = canonical name lowercased.
  const [workTagsByCanonical, setWorkTagsByCanonical] = useState<
    Record<string, Array<{ tag: string; aliasType?: string }>>
  >({});
  // Alias suggestions surfaced in the category typeahead. Built from the same
  // /api/categories?include=aliases response as workTagsByCanonical, but kept
  // separate because the typeahead needs a flat list and aliasLookup needs an
  // index keyed by alias label for O(1) resolve in toggleCategory /
  // handleAddCustomCategory.
  const [aliasOptions, setAliasOptions] = useState<
    Array<{ label: string; canonical: string; aliasType?: string }>
  >([]);
  const [aliasLookup, setAliasLookup] = useState<
    Map<string, { canonical: string; label: string; aliasType?: string }>
  >(new Map());
  // Provider's tag picks per category. Key = categoryKey(category).
  const [selectedWorkTags, setSelectedWorkTags] = useState<Record<string, string[]>>(
    {}
  );
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);
  const [customAreaKeys, setCustomAreaKeys] = useState<string[]>([]);
  // Region-based coverage state (Phase 1).
  // `regionOptions` is the catalog from /api/area-intelligence/regions.
  // `selectedRegions` is the provider's pick (≤ MAX_REGIONS). `customLocalities`
  // are typed strings that don't fall inside any region — they still flow
  // into pendingNewAreas / area_review_queue, preserving the queue lifecycle.
  const [regionOptions, setRegionOptions] = useState<RegionOption[]>([]);
  const [isLoadingRegions, setIsLoadingRegions] = useState<boolean>(false);
  const [regionsError, setRegionsError] = useState<string>("");
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  // Direct-hydration source captured from
  // /api/kk?action=get_provider_by_phone in edit mode. `null` means
  // the provider profile hasn't loaded yet; `[]` means the response
  // arrived but the server returned no region_codes (legacy provider
  // — fall back to area-name inference); a non-empty array drives
  // direct hydration and bypasses the inference race.
  const [savedRegionCodes, setSavedRegionCodes] = useState<string[] | null>(
    null
  );
  // Per-region "expanded" state for the area preview inside each region
  // card. Independent of selection — expanding a card does not select
  // the region, and selecting a region does not collapse the expanded
  // panel. Keyed by region_code; a Set keeps membership checks O(1)
  // and the immutable copy in toggleExpandedRegion keeps React's
  // change detection happy.
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(
    () => new Set()
  );
  const toggleExpandedRegion = (regionCode: string) => {
    setExpandedRegions((prev) => {
      const next = new Set(prev);
      if (next.has(regionCode)) {
        next.delete(regionCode);
      } else {
        next.add(regionCode);
      }
      return next;
    });
  };
  const [customLocalities, setCustomLocalities] = useState<string[]>([]);
  const [customLocalityInput, setCustomLocalityInput] = useState<string>("");
  // ── Geo cascade state (Phase R-sync) ───────────────────────────────────
  // Mirrors the homepage Step 3 cascade but kept local to the provider
  // session — we deliberately don't share the public `kk_geo` cookie
  // because provider scope is a separate concern from public browsing.
  const [availableCities, setAvailableCities] = useState<CityRow[]>([]);
  const [selectedState, setSelectedStateRaw] = useState<string>("");
  const [selectedCityCode, setSelectedCityCodeRaw] = useState<string>("");
  // True briefly after a city switch so the UI can render a small
  // "City changed — coverage selection reset" notice; cleared on the
  // next meaningful user action (selecting a region or category).
  const [cityChangedNotice, setCityChangedNotice] = useState<boolean>(false);
  // ── Plan-aware region cap (Stage A + B) ───────────────────────────────
  // Hydrated from /api/provider/plan on mount. Defaults to the implicit
  // free plan (1 region) until the fetch resolves — safer than
  // optimistically rendering a higher cap. `planRuleKind` distinguishes
  // fixed-count plans from cityWide, which auto-selects every active
  // region and disables the chip toggles.
  const [planCode, setPlanCode] = useState<string>("free");
  const [planMaxRegions, setPlanMaxRegions] = useState<number>(1);
  const [planRuleKind, setPlanRuleKind] = useState<"fixed" | "cityWide">("fixed");
  // MVP: per-period region/category change throttle removed. The
  // matching state declarations + setters that previously rendered
  // "Region changes left this month" were deleted with the UI hint.
  // /api/provider/plan still returns `remaining` + `monthlyLimit` on
  // the wire (always set to the limit constant) so existing clients
  // remain compatible.
  const [planLoaded, setPlanLoaded] = useState<boolean>(false);
  // Effective per-render cap. Lower of (plan's max) and (hard ceiling).
  // cityWide is treated as MAX_REGIONS — every region in the city is
  // selectable (and auto-selected via the effect below).
  const effectiveMaxRegions =
    planRuleKind === "cityWide"
      ? MAX_REGIONS
      : Math.min(MAX_REGIONS, Math.max(MIN_REGIONS, planMaxRegions));
  // One-shot flag that gates both the edit-mode inference effect and the
  // region→area expansion sync effect. Declared up-front because the sync
  // effect (defined earlier in the file) references it in its deps array.
  const [hasInferredRegions, setHasInferredRegions] = useState(false);

  const [catQuery, setCatQuery] = useState("");
  const [areaSearch, setAreaSearch] = useState("");
  const [showAreaSuggestions, setShowAreaSuggestions] = useState(false);
  const [shakeCategories, setShakeCategories] = useState(false);
  const [highlightCategories, setHighlightCategories] = useState(false);

  const [isLoadingCategories, setIsLoadingCategories] = useState(true);
  const [isLoadingAreas, setIsLoadingAreas] = useState(true);
  const [categoriesError, setCategoriesError] = useState("");
  const [areasError, setAreasError] = useState("");
  const [areasLimitError, setAreasLimitError] = useState("");
  const [celebrate, setCelebrate] = useState(false);
  const [celebrateText, setCelebrateText] = useState("");

  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState<RegisterResponse | null>(null);
  const [submittedRequiresApproval, setSubmittedRequiresApproval] = useState(false);
  const [showSuccessCelebration, setShowSuccessCelebration] = useState(false);
  const [showEditSuccessModal, setShowEditSuccessModal] = useState(false);
  const [successProviderId, setSuccessProviderId] = useState("");
  const [toasts, setToasts] = useState<InAppToast[]>([]);
  // Provider Responsibility Pledge — Phase 3. Only relevant on the
  // NEW-registration path; edit mode never reads or writes these. The
  // submit button stays clickable when the box is unchecked so the user
  // sees a friendly inline message rather than wondering why nothing
  // happens.
  const [pledgeAccepted, setPledgeAccepted] = useState(false);
  const [pledgeError, setPledgeError] = useState<string | null>(null);

  const showSuccessToast = (message: string) => {
    const id = `save-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((current) => [...current, { id, title: "Saved", message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 2500);
  };

  const dismissToast = (id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  };
  const [hasLoadedEditProfile, setHasLoadedEditProfile] = useState(false);
  // ProviderID captured from the edit-mode profile load so we can mount
  // <ProviderAliasSubmitter />. Empty in registration mode (no provider
  // row exists yet — the alias submit endpoint requires one).
  const [editingProviderId, setEditingProviderId] = useState("");

  const editTarget = searchParams.get("edit");
  const isEditMode = editTarget === "services" || editTarget === "areas";

  // ── Provider Work Intake (Phase 1 — UI foundation only) ────────────────
  // Gated entirely behind NEXT_PUBLIC_PROVIDER_WORK_INTAKE_ENABLED. When the
  // flag is off, `workIntakeEnabled` is false, the block below never renders,
  // and the existing manual category flow is byte-for-byte unchanged.
  //
  // IMPORTANT (Phase 1 rules): this textbox is LOCAL STATE ONLY. It is never
  // sent to any backend, never calls AI, and never touches selectedCategories,
  // selectedWorkTags, customCategoryKeys, or handleSubmit. It is purely the UI
  // shell the AI resolve flow will plug into in a later phase.
  const workIntakeEnabled = isProviderWorkIntakeEnabled();
  // Phase 2B — "Mera kaam samjho" confirmation flow. Forced OFF in edit mode
  // (ProviderAliasSubmitter handles the equivalent surface against an existing
  // provider row) and when the Phase 1 flag is off (the trigger lives inside
  // the Phase 1 panel).
  const workIntakeConfirmEnabled =
    !isEditMode && isProviderWorkIntakeConfirmEnabled();
  const [intake, setIntake] = useState<IntakeState>({ kind: "idle" });
  // Per-canonical bag of AI-suggested tags that aren't yet active aliases.
  // Folded into the existing `workTags` JSON payload at submit time so no new
  // wire field is introduced. Tags whose isExistingAlias=true go into
  // selectedWorkTags directly (same path as a manual chip tap).
  const [pendingWorkTags, setPendingWorkTags] = useState<
    Record<string, string[]>
  >({});
  // AbortController for the in-flight resolve so a stale response from a
  // previous catQuery never overwrites the panel after the user starts typing
  // again. Ref (not state) — we never render off this and React re-renders
  // would churn the controller unnecessarily.
  const intakeAbortRef = useRef<AbortController | null>(null);
  // UI-only: whether the "Bol ke samjhaaye" explanation panel is open. The
  // intake input itself reuses the existing `catQuery` state as the single
  // source of truth — no second text state.
  const [showBolExplanation, setShowBolExplanation] = useState(false);
  // Animate the existing category-search placeholder only while it is empty and
  // no category is picked yet, so the typewriter never fights real typing.
  // `catQuery` / `selectedCategories` are declared above; `isMaxReached` is
  // derived later, so the cap is expressed here via the raw count. Hook is
  // SSR-safe and self-cleans its timers.
  const { text: workIntakePlaceholder } = useTypewriterPlaceholder(
    WORK_INTAKE_HINTS,
    {
      enabled:
        workIntakeEnabled &&
        catQuery.trim() === "" &&
        selectedCategories.length < MAX_CATEGORIES,
      // Faster cycle so more example hints surface quickly while staying
      // readable (Phase-1 polish). Overridden per call site; the hook's own
      // defaults are unchanged so other future consumers are unaffected.
      typeMs: 40,
      deleteMs: 24,
      pauseCompleteMs: 650,
    }
  );

  // ── Phase 2B — intake resolve handlers ───────────────────────────────────
  // Cleanup: any time the page unmounts mid-resolve, abort the request so we
  // don't fire a setState on an unmounted component.
  useEffect(() => {
    return () => {
      intakeAbortRef.current?.abort();
    };
  }, []);

  const handleRunIntake = async () => {
    if (!workIntakeConfirmEnabled) return;
    const text = catQuery.trim();
    if (text.length < 3) return;
    if (selectedCategories.length >= MAX_CATEGORIES) return;

    // Cancel any prior in-flight resolve so a slow earlier request can't
    // override the response we're about to render.
    intakeAbortRef.current?.abort();
    const controller = new AbortController();
    intakeAbortRef.current = controller;

    setIntake({ kind: "resolving", text });

    try {
      const data = await fetchResolve(text, selectedCityCode || undefined, {
        signal: controller.signal,
      });

      // If a newer trigger / catQuery edit replaced our controller, drop this
      // response — the user's already moved on.
      if (intakeAbortRef.current !== controller) return;
      intakeAbortRef.current = null;

      if (!data.ok) {
        setIntake({ kind: "manual", reason: data.reason });
        return;
      }
      if (data.blocked || data.safety === "red") {
        setIntake({ kind: "red", text });
        return;
      }
      if (data.safety === "yellow" || !data.mainCategory) {
        setIntake({
          kind: "yellow",
          text,
          mainCategory: data.mainCategory,
          workTags: data.workTags,
          reason: data.reason,
        });
        return;
      }
      // safety === green AND mainCategory present. Existence is server-
      // verified; we trust isExisting=true here as the closed-set gate.
      setIntake({
        kind: "green",
        text,
        mainCategory: data.mainCategory,
        workTags: data.workTags,
      });
    } catch (err) {
      // Caller-initiated aborts are intentional — leave state alone, the
      // input-change effect already moved us to idle.
      if (err && typeof err === "object" && (err as { name?: string }).name === "AbortError") {
        return;
      }
      if (intakeAbortRef.current === controller) intakeAbortRef.current = null;
      setIntake({ kind: "manual", reason: "AI_UNAVAILABLE" });
    }
  };

  const dismissIntake = () => {
    intakeAbortRef.current?.abort();
    intakeAbortRef.current = null;
    setIntake({ kind: "idle" });
  };

  const retryIntake = () => {
    // "Try different wording" — return to idle so the panel disappears; we
    // intentionally don't auto-rerun: the provider needs to type new text.
    dismissIntake();
  };

  const applyGreenResolution = () => {
    if (intake.kind !== "green") return;
    const { mainCategory, workTags } = intake;
    if (!mainCategory.isExisting) {
      // Server contract: green implies existing in the active set. Defensive
      // no-op rather than creating a pending category here — that path is the
      // existing "+ Add as new service" flow, which the user must opt into.
      dismissIntake();
      return;
    }

    const canonical = mainCategory.canonical;
    const canonKey = categoryKey(canonical);

    // Apply the canonical exactly like a manual canonical tap.
    setSelectedCategories((prev) => {
      if (hasCategoryKey(prev, canonKey)) return prev;
      if (prev.length >= MAX_CATEGORIES) return prev;
      return [...prev, canonical];
    });
    // AI-suggested green never goes through the pending-new flow.
    setCustomCategoryKeys((prev) => prev.filter((k) => k !== canonKey));

    // Bucket tags: existing aliases → selectedWorkTags (rides existing chip
    // strip); new suggestions → pendingWorkTags (merged into payload at
    // submit time, no new wire field).
    const existingLabels: string[] = [];
    const newLabels: string[] = [];
    for (const tag of workTags) {
      const label = String(tag.label || "").trim();
      if (!label) continue;
      if (tag.isExistingAlias) existingLabels.push(label);
      else newLabels.push(label);
    }

    if (existingLabels.length > 0) {
      setSelectedWorkTags((prev) => {
        const current = prev[canonKey] || [];
        const merged = [...current];
        for (const label of existingLabels) {
          if (!merged.includes(label)) merged.push(label);
        }
        if (merged.length === current.length) return prev;
        return { ...prev, [canonKey]: merged };
      });
    }
    if (newLabels.length > 0) {
      setPendingWorkTags((prev) => {
        const current = prev[canonKey] || [];
        const merged = [...current];
        for (const label of newLabels) {
          if (!merged.includes(label)) merged.push(label);
        }
        if (merged.length === current.length) return prev;
        return { ...prev, [canonKey]: merged };
      });
    }

    setCatQuery("");
    setSubmitError("");
    setSuccess(null);
    setIntake({ kind: "idle" });
  };

  useEffect(() => {
    const userPhone = getUserPhone();
    if (!/^\d{10}$/.test(userPhone)) {
      router.replace("/login");
      return;
    }

    // In edit mode the user explicitly came to update their profile — skip guard.
    if (isEditMode) {
      setPhone(userPhone);
      setIsAuthChecking(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/kk?action=get_provider_by_phone&phone=${encodeURIComponent(userPhone)}`,
          { cache: "no-store" }
        );
        const data = (await parseJsonSafe(res)) as ProviderByPhoneResponse | null;
        if (cancelled) return;
        if (res.ok && data?.ok === true && data.provider?.ProviderID) {
          router.replace("/provider/dashboard?alreadyRegistered=true");
          return;
        }
      } catch {
        // If check fails, fall through to showing the form.
        // The submit path still catches duplicate registrations via the 409 response.
      }
      if (cancelled) return;
      setPhone(userPhone);
      setIsAuthChecking(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [router, isEditMode]);

  useEffect(() => {
    const loadCategories = async () => {
      setIsLoadingCategories(true);
      setCategoriesError("");
      try {
        // Opt-in to alias suggestions so we can derive work-tag chips.
        // The strict `data.data[]` parser below is unchanged; we only ALSO
        // read the new `data.suggestions[]` array for tag building.
        const response = await fetch("/api/categories?include=aliases", {
          cache: "no-store",
        });
        const text = await response.text();
        let data: any = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          throw new Error(`INVALID_JSON:${text.slice(0, 120)}`);
        }
        if (!response.ok) {
          const apiMessage =
            typeof data?.error === "string" && data.error.trim()
              ? data.error.trim()
              : text.slice(0, 120);
          throw new Error(`HTTP_ERROR: HTTP ${response.status} ${apiMessage}`.trim());
        }
        if (Array.isArray(data?.data)) {
          setCategories(
            data.data
              .map((item: unknown) =>
                item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string"
                  ? (item as { name: string }).name
                  : null
              )
              .filter((value: string | null): value is string => typeof value === "string")
          );
        } else {
          setCategories([]);
          setCategoriesError(
            (typeof data?.error === "string" && data.error) || "Failed to load categories"
          );
        }

        // Build the tag map keyed by canonical (lowercased). Non-alias rows
        // and rows missing label/canonical are skipped. When the API or
        // mocks omit `suggestions`, this leaves the map empty and the
        // tag-chip section never renders — registration flow unaffected.
        const suggestions = Array.isArray(data?.suggestions)
          ? (data.suggestions as Array<Record<string, unknown>>)
          : [];
        const tagsMap: Record<string, Array<{ tag: string; aliasType?: string }>> = {};
        const optionsList: Array<{ label: string; canonical: string; aliasType?: string }> = [];
        const lookupMap = new Map<
          string,
          { canonical: string; label: string; aliasType?: string }
        >();
        for (const row of suggestions) {
          if (!row || row.type !== "alias") continue;
          const label = typeof row.label === "string" ? row.label.trim() : "";
          const canonical =
            typeof row.canonical === "string" ? row.canonical.trim() : "";
          if (!label || !canonical) continue;
          const aliasType =
            typeof row.aliasType === "string" ? row.aliasType.trim() : "";
          const key = canonical.toLowerCase();
          if (!tagsMap[key]) tagsMap[key] = [];

          // Guard against duplicate alias rows in the suggestions[] feed
          // (e.g. same "lohar" returned twice). Match by tag label only.
          const exists = tagsMap[key].some((t) => t.tag === label);
          if (!exists) {
            tagsMap[key].push(
              aliasType ? { tag: label, aliasType } : { tag: label }
            );
          }

          // aliasOptions feeds the category typeahead; aliasLookup is the
          // O(1) resolver for toggleCategory and the belt-and-braces guard
          // in handleAddCustomCategory. Indexed by categoryKey(label) so the
          // input normalisation matches everywhere. First-write-wins on rare
          // cross-canonical label collisions; the API already de-dupes alias-
          // vs-canonical and per-canonical duplicates.
          const labelKey = categoryKey(label);
          if (!lookupMap.has(labelKey)) {
            const entry = aliasType
              ? { canonical, label, aliasType }
              : { canonical, label };
            lookupMap.set(labelKey, entry);
            optionsList.push(
              aliasType ? { label, canonical, aliasType } : { label, canonical }
            );
          }
        }
        setWorkTagsByCanonical(tagsMap);
        setAliasOptions(optionsList);
        setAliasLookup(lookupMap);
      } catch (error) {
        setCategories([]);
        setCategoriesError(normalizeLoadError("Failed to load categories", error));
      } finally {
        setIsLoadingCategories(false);
      }
    };

    loadCategories();
  }, []);

  useEffect(() => {
    const loadAreas = async () => {
      setIsLoadingAreas(true);
      setAreasError("");
      try {
        const response = await fetch("/api/kk?action=get_areas", { cache: "no-store" });
        const text = await response.text();
        let data: any = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          throw new Error(`INVALID_JSON:${text.slice(0, 120)}`);
        }
        if (!response.ok) {
          const apiMessage =
            (typeof data?.error === "string" && data.error.trim()) || text.slice(0, 120);
          throw new Error(`HTTP_ERROR: HTTP ${response.status} ${apiMessage}`.trim());
        }
        const list = Array.isArray(data?.areas)
          ? data.areas.filter((value: unknown): value is string => typeof value === "string")
          : [];
        if (!Array.isArray(data?.areas) && typeof data?.error === "string" && data.error.trim()) {
          throw new Error(data.error.trim());
        }
        setAreas(list);
      } catch (error) {
        setAreas([]);
        setAreasError(normalizeLoadError("Failed to load areas", error));
      } finally {
        setIsLoadingAreas(false);
      }
    };

    loadAreas();
  }, []);

  // Backfill: when availableCities loads AFTER selectedCityCode was
  // hydrated (edit-mode race), pair the city with its state so the
  // State <select> renders the right option.
  useEffect(() => {
    if (!selectedCityCode || selectedState) return;
    const cityRow = availableCities.find((c) => c.city_code === selectedCityCode);
    if (cityRow) setSelectedStateRaw(cityRow.state);
  }, [availableCities, selectedCityCode, selectedState]);

  // ── Cities catalog (Phase R-sync) ──────────────────────────────────
  // Fetch once on mount. Initial selectedCityCode comes from the API's
  // default_city_code; edit mode overrides this below from the
  // provider's stored city_code, so this default only sticks for fresh
  // registrations.
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/cities", { signal: ctrl.signal, cache: "no-store" })
      .then((res) => res.json())
      .then((data: { ok?: boolean; cities?: CityRow[]; default_city_code?: string }) => {
        if (ctrl.signal.aborted) return;
        const cities = Array.isArray(data?.cities) ? data.cities : [];
        setAvailableCities(cities);
        // Only seed defaults when the cascade hasn't been set yet (e.g.
        // edit-mode hydration hasn't run). Avoids overriding a value
        // that already came from the provider's stored data.
        if (!selectedCityCode) {
          const def = String(data?.default_city_code ?? "").trim();
          const defCity = cities.find((c) => c.city_code === def);
          if (defCity) {
            setSelectedStateRaw(defCity.state);
            setSelectedCityCodeRaw(defCity.city_code);
          }
        }
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        // /api/cities failed — leave selectors empty. The region fetch
        // below bails when selectedCityCode is empty.
      });
    return () => ctrl.abort();
    // Run once on mount. selectedCityCode is intentionally NOT in deps —
    // we only want to seed defaults when there's nothing yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Provider plan + remaining monthly changes (Stage A + B) ──────────
  // Fetch on mount + after a successful save. The endpoint is auth-
  // scoped (cookie); fresh-registration (no provider row yet) returns
  // the implicit free defaults — the page renders correct caps before
  // the very first save.
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/provider/plan", { signal: ctrl.signal, cache: "no-store" })
      .then((res) => res.json())
      .then(
        (data: {
          ok?: boolean;
          plan?: {
            code?: string;
            maxRegions?: number;
            ruleKind?: "fixed" | "cityWide";
          };
          remaining?: { region_change?: number; category_change?: number };
          monthlyLimit?: number;
        }) => {
          if (ctrl.signal.aborted) return;
          if (!data?.ok) return; // keep defaults
          setPlanCode(String(data.plan?.code ?? "free"));
          setPlanMaxRegions(
            Number.isFinite(data.plan?.maxRegions) && (data.plan?.maxRegions ?? 0) >= 1
              ? Number(data.plan?.maxRegions)
              : 1
          );
          setPlanRuleKind(
            data.plan?.ruleKind === "cityWide" ? "cityWide" : "fixed"
          );
          setPlanLoaded(true);
        }
      )
      .catch((err) => {
        if (err?.name === "AbortError") return;
        // Keep the free defaults on fetch failure.
        setPlanLoaded(true);
      });
    return () => ctrl.abort();
  }, []);

  // ── cityWide auto-select ──────────────────────────────────────────────
  // For "all city" plans, the provider doesn't pick specific regions —
  // every active region in the selected city is included. Auto-select
  // whenever regionOptions or the plan changes; user cannot opt-out of
  // individual regions within a cityWide plan (the chip toggles are
  // disabled in render below).
  useEffect(() => {
    if (planRuleKind !== "cityWide") return;
    if (regionOptions.length === 0) return;
    const all = regionOptions.map((r) => r.region_code);
    // Only update when actually different — avoids a re-render loop.
    const sameLength = all.length === selectedRegions.length;
    const sameSet =
      sameLength && all.every((c, i) => c === selectedRegions[i]);
    if (sameSet) return;
    setSelectedRegions(all);
  }, [planRuleKind, regionOptions, selectedRegions]);

  // Region catalog — refetches whenever the selected city changes. Empty
  // selectedCityCode (during initial load) skips the fetch.
  useEffect(() => {
    if (!selectedCityCode) return;
    const loadRegions = async () => {
      setIsLoadingRegions(true);
      setRegionsError("");
      try {
        const res = await fetch(
          `/api/area-intelligence/regions?city=${encodeURIComponent(selectedCityCode)}`,
          { cache: "no-store" }
        );
        const data = (await res.json()) as {
          ok?: boolean;
          regions?: RegionOption[];
          error?: string;
        };
        if (!res.ok || !data?.ok || !Array.isArray(data.regions)) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        // Only keep regions that have at least one area — empty regions
        // would produce zero provider_areas rows and confuse the picker.
        setRegionOptions(
          data.regions.filter(
            (r) =>
              r.region_code &&
              Array.isArray(r.areas) &&
              r.areas.length > 0
          )
        );
      } catch (err) {
        setRegionOptions([]);
        setRegionsError(
          err instanceof Error ? err.message : "Failed to load regions"
        );
      } finally {
        setIsLoadingRegions(false);
      }
    };
    loadRegions();
  }, [selectedCityCode]);

  // ── Cascade setters ───────────────────────────────────────────────────
  // Wrappers around the raw state setters so a city change cascades to
  // the same clears the audit demanded: selectedRegions empty,
  // customLocalities empty, plus a small notice the UI can render.
  // Edit-mode hydration also uses these so the cascade-clear runs there
  // too (which is correct — switching city in edit mode invalidates the
  // saved region picks).
  const setCity = (next: string) => {
    if (!next || next === selectedCityCode) return;
    const found = availableCities.find((c) => c.city_code === next);
    if (!found) return;
    setSelectedStateRaw(found.state);
    setSelectedCityCodeRaw(found.city_code);
    setSelectedRegions([]);
    setCustomLocalities([]);
    setHasInferredRegions(false); // re-infer for new city in edit mode
    setCityChangedNotice(true);
  };
  const setState = (next: string) => {
    if (!next || next === selectedState) return;
    const firstCityInState = availableCities.find((c) => c.state === next);
    if (!firstCityInState) return;
    setCity(firstCityInState.city_code);
  };
  const statesList = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of availableCities) {
      if (!seen.has(c.state)) {
        seen.add(c.state);
        out.push(c.state);
      }
    }
    return out;
  })();
  const citiesInSelectedState = availableCities.filter(
    (c) => c.state === selectedState
  );

  useEffect(() => {
    if (!isEditMode || !/^\d{10}$/.test(phone) || hasLoadedEditProfile) {
      return;
    }

    let ignore = false;

    const loadExistingProvider = async () => {
      try {
        const response = await fetch(
          `/api/kk?action=get_provider_by_phone&phone=${encodeURIComponent(phone)}`,
          { cache: "no-store" }
        );
        const data = (await parseJsonSafe(response)) as ProviderByPhoneResponse | null;
        if (!response.ok || data?.ok !== true || !data.provider || ignore) {
          return;
        }

        const serviceCategories = uniqueCategoryValues(
          Array.isArray(data.provider.Services)
            ? data.provider.Services.map((service) => service.Category)
            : []
        );
        const serviceAreas = uniqueStrings(
          Array.isArray(data.provider.Areas)
            ? data.provider.Areas.map((area) => area.Area)
            : []
        );

        setName(String(data.provider.ProviderName || "").trim().toUpperCase());
        setSelectedCategories(serviceCategories);
        setSelectedAreas(serviceAreas);
        setCustomCategoryKeys([]);
        setCustomAreaKeys([]);

        // Capture the server's saved region_codes. The hydration effect
        // below uses this as the source of truth when present, which
        // both (a) avoids the area-name inference race against
        // /api/provider/plan that previously truncated multi-region
        // paid providers to a single visible card, and (b) preserves
        // ALL saved regions including any that exceed the current plan
        // cap (over-plan rows are surfaced with a warning rather than
        // silently hidden). Defaults to an empty array so the legacy
        // inference path kicks in for older providers whose rows still
        // carry region_code = NULL.
        const responseRegionCodes = (
          data.provider as { RegionCodes?: unknown }
        ).RegionCodes;
        const cleanRegionCodes = Array.isArray(responseRegionCodes)
          ? (responseRegionCodes as unknown[])
              .map((v) => String(v ?? "").trim())
              .filter((v) => v.length > 0)
          : [];
        setSavedRegionCodes(cleanRegionCodes);
        // Cascade hydration (Phase R-sync): preselect the provider's
        // stored city. The cascade-reset clears that the setCity wrapper
        // normally runs (selectedRegions / customLocalities empty) are
        // appropriate here too — region inference will populate them
        // from the saved areas in the dedicated inference effect once
        // both the area list and the city's region catalog are loaded.
        const editCityCode = String(
          (data.provider as { CityCode?: unknown }).CityCode ?? ""
        ).trim().toUpperCase();
        if (/^[A-Z]{3}$/.test(editCityCode)) {
          // Bypass setCity's notice (this is an initial hydration, not a
          // user-initiated change). The dedicated backfill effect pairs
          // selectedState to this city_code as soon as availableCities
          // lands — keeps the load closure free of `availableCities`
          // (and the exhaustive-deps lint clean).
          setSelectedCityCodeRaw(editCityCode);
        }
        // Capture ProviderID so the work-term panel mounted below in edit
        // mode can call /api/provider/work-terms + /api/provider/aliases.
        setEditingProviderId(
          String(
            (data.provider as { ProviderID?: unknown }).ProviderID ?? ""
          ).trim()
        );
        // Region/locality inference is deferred to a separate effect that
        // waits for both `serviceAreas` (loaded here) and `regionOptions`
        // (the catalog fetch). Without both, mapping would yield zero
        // regions and clobber the provider's saved coverage.
      } catch {
        // Keep the form usable even if prefill fails.
      } finally {
        if (!ignore) {
          setHasLoadedEditProfile(true);
        }
      }
    };

    void loadExistingProvider();

    return () => {
      ignore = true;
    };
  }, [hasLoadedEditProfile, isEditMode, phone]);

  // Region → area expansion. `selectedAreas` becomes a DERIVED value
  // (union of all canonical areas inside the selected regions, plus
  // any custom localities). All downstream submit / count / payload
  // code keeps working with `selectedAreas` unchanged.
  //
  // Skipped while the edit-mode inference effect is still running so
  // the initial empty regions+localities state doesn't temporarily
  // clobber the freshly-loaded saved set.
  useEffect(() => {
    if (isEditMode && !hasInferredRegions) return;
    const seen = new Set<string>();
    const merged: string[] = [];
    const push = (s: string) => {
      const t = s.trim();
      if (!t) return;
      const k = t.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      merged.push(t);
    };
    for (const rc of selectedRegions) {
      const region = regionOptions.find((r) => r.region_code === rc);
      if (!region) continue;
      for (const a of region.areas) push(a);
    }
    for (const c of customLocalities) push(c);
    setSelectedAreas(merged);
    // Mark custom-locality keys so the existing pendingNewAreas filter
    // (which checks customAreaKeys.includes) picks them up at submit.
    setCustomAreaKeys(customLocalities.map((c) => areaKey(c)));
  }, [
    selectedRegions,
    customLocalities,
    regionOptions,
    isEditMode,
    hasInferredRegions,
  ]);

  // Edit-mode region hydration.
  //
  // Preferred path (post region_code rollout):
  //   Server returns provider_areas.region_code aggregated into
  //   `RegionCodes`. We hydrate `selectedRegions` directly from that
  //   array. NULL rows are filtered out server-side and become
  //   customLocalities here. This path does NOT depend on
  //   effectiveMaxRegions — over-plan providers see every saved
  //   region plus a visible warning rather than a silently-truncated
  //   picker.
  //
  // Legacy fallback (RegionCodes empty/absent):
  //   Older providers whose rows still carry region_code = NULL fall
  //   back to area-name inference: regions whose every active
  //   canonical_area appears in the saved set are inferred. Capped at
  //   effectiveMaxRegions to avoid runaway selection on a wrong-plan
  //   row. THE FALLBACK NOW WAITS FOR planLoaded — without that
  //   guard, /api/provider/plan losing a race against the inference
  //   trigger pinned the cap at 1 and produced the "5 saved, 1
  //   visible" bug.
  //
  // Runs only once per edit session (gated by hasInferredRegions).
  useEffect(() => {
    if (!isEditMode) return;
    if (hasInferredRegions) return;
    if (!hasLoadedEditProfile) return;
    if (regionOptions.length === 0) return;
    if (savedRegionCodes === null) return; // provider profile still loading

    const norm = (v: string) => v.trim().toLowerCase();

    // ── Direct-hydration path ────────────────────────────────────────
    if (savedRegionCodes.length > 0) {
      const validRegionSet = new Set(
        regionOptions.map((r) => r.region_code)
      );
      const hydrated = savedRegionCodes.filter((rc) => validRegionSet.has(rc));
      // Compute leftover area names — anything in selectedAreas that
      // doesn't fall under one of the hydrated regions becomes a
      // custom locality. Captures NULL-region rows from
      // provider_areas (which the server-side filter dropped from
      // RegionCodes by design — they don't map back to a region).
      const coveredKeys = new Set<string>();
      for (const region of regionOptions) {
        if (!hydrated.includes(region.region_code)) continue;
        for (const a of region.areas) coveredKeys.add(norm(a));
      }
      const leftovers = selectedAreas.filter(
        (a) => !coveredKeys.has(norm(a))
      );

      setSelectedRegions(hydrated);
      setCustomLocalities(leftovers);
      setHasInferredRegions(true);
      return;
    }

    // ── Legacy fallback: area-name inference ─────────────────────────
    // Wait for the plan response so effectiveMaxRegions reflects the
    // provider's actual cap rather than the default of 1.
    if (!planLoaded) return;

    const savedSet = new Set(selectedAreas.map(norm).filter(Boolean));
    if (savedSet.size === 0) {
      setHasInferredRegions(true);
      return;
    }
    const inferredRegions: string[] = [];
    const coveredByInferred = new Set<string>();
    for (const region of regionOptions) {
      const regionKeys = region.areas.map(norm).filter(Boolean);
      if (regionKeys.length === 0) continue;
      const everyAreaSaved = regionKeys.every((k) => savedSet.has(k));
      if (!everyAreaSaved) continue;
      inferredRegions.push(region.region_code);
      for (const k of regionKeys) coveredByInferred.add(k);
      if (inferredRegions.length >= effectiveMaxRegions) break;
    }
    setSelectedRegions(inferredRegions);
    const leftovers = selectedAreas.filter(
      (a) => !coveredByInferred.has(norm(a))
    );
    setCustomLocalities(leftovers);
    setHasInferredRegions(true);
  }, [
    isEditMode,
    hasInferredRegions,
    hasLoadedEditProfile,
    regionOptions,
    selectedAreas,
    effectiveMaxRegions,
    planLoaded,
    savedRegionCodes,
  ]);

  // Region / locality edits should clear the most recent submit error so
  // a stale "Please pick at least 1 / up to 3" message doesn't linger
  // after the provider takes the corrective action. Mirrors the inline-
  // clear pattern toggleCategory / addArea already use for category and
  // area edits.
  useEffect(() => {
    if (submitError) setSubmitError("");
    // submitError is intentionally NOT in the dep array — including it
    // would re-run on the same setState and is unnecessary; we only want
    // edits to regions/localities to trigger the clear.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRegions, customLocalities]);

  useEffect(() => {
    if (!isEditMode || !hasLoadedEditProfile) return;

    const targetNode = editTarget === "areas" ? areaBoxRef.current : step2Ref.current;
    if (!targetNode) return;

    const timeoutId = window.setTimeout(() => {
      targetNode.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);

    return () => window.clearTimeout(timeoutId);
  }, [editTarget, hasLoadedEditProfile, isEditMode]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (areaBoxRef.current && !areaBoxRef.current.contains(target)) {
        setShowAreaSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!celebrate) return;

    timerRef.current = setTimeout(() => {
      setCelebrate(false);
    }, 5000);

    const closeHandler = () => {
      if (ignoreNextOutsideClickRef.current) {
        ignoreNextOutsideClickRef.current = false;
        return;
      }
      setCelebrate(false);
    };

    window.addEventListener("click", closeHandler);
    window.addEventListener("touchstart", closeHandler);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      window.removeEventListener("click", closeHandler);
      window.removeEventListener("touchstart", closeHandler);
      ignoreNextOutsideClickRef.current = false;
    };
  }, [celebrate]);

  const filteredCategories = useMemo<
    Array<{ value: string; display: string; isAlias: boolean; canonical: string }>
  >(() => {
    const q = categoryKey(catQuery);
    const selectedKeys = toCategoryLookup(selectedCategories);

    // Single dedup set used by both the canonical and alias pushes. Key
    // mirrors the render-side React key in the suggestion list, so a chip
    // that survives this Set is guaranteed unique on render. Prevents the
    // "two children with the same key" warning when the API or local state
    // produces duplicate canonical names (e.g. case-only differences) or
    // when an alias label collides with another alias.
    const seenKeys = new Set<string>();
    const dedupKey = (isAlias: boolean, value: string) =>
      `${isAlias ? "alias" : "canon"}:${value.toLowerCase()}`;
    const out: Array<{
      value: string;
      display: string;
      isAlias: boolean;
      canonical: string;
    }> = [];

    // Canonical entries — drop already-selected, then push only if unseen.
    for (const item of categories) {
      if (selectedKeys.has(categoryKey(item))) continue;
      const key = dedupKey(false, item);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      out.push({ value: item, display: item, isAlias: false, canonical: item });
    }

    // Default view (no query) — render NOTHING. The full canonical list
    // overwhelmed first-time providers and obscured the "+ Add as new
    // service" affordance for off-taxonomy services. Suggestions are
    // search-driven: the provider types, we show matches; if no match,
    // the noMatch branch surfaces "+ Add <query> as new service". The
    // discoverability hint under the input already tells them so.
    if (!q) return [];

    // Search view — alias entries join the pool, displayed as
    // "alias (canonical)" so the provider sees the underlying service.
    // Aliases whose canonical is already selected, or whose label collides
    // with a selected canonical, are filtered out so MAX_CATEGORIES=1
    // cannot be bypassed by picking canonical + its alias.
    for (const opt of aliasOptions) {
      if (selectedKeys.has(categoryKey(opt.canonical))) continue;
      if (selectedKeys.has(categoryKey(opt.label))) continue;
      const key = dedupKey(true, opt.label);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      out.push({
        value: opt.label,
        display: `${opt.label} (${opt.canonical})`,
        isAlias: true,
        canonical: opt.canonical,
      });
    }

    return out.filter((opt) => categoryKey(opt.value).includes(q));
  }, [categories, catQuery, selectedCategories, aliasOptions]);

  const filteredAreaSuggestions = useMemo(() => {
    const q = areaSearch.trim().toLowerCase();
    const suggestions = areas.filter((item) => {
      if (selectedAreas.some((selected) => selected.toLowerCase() === item.toLowerCase())) {
        return false;
      }
      if (!q) return true;
      return item.toLowerCase().includes(q);
    });
    return suggestions;
  }, [areas, areaSearch, selectedAreas]);

  const normalizedCatQuery = normalizeCategoryInput(catQuery);
  const normalizedAreaQuery = normalizeAreaInput(areaSearch);
  const noMatch =
    normalizedCatQuery.length >= 3 &&
    !isLoadingCategories &&
    !categoriesError &&
    filteredCategories.length === 0;
  const totalSelectedServices = selectedCategories.length;
  const isMaxReached = totalSelectedServices >= MAX_CATEGORIES;
  const canAddCustomCategory = noMatch;
  const canAddCustomArea =
    normalizedAreaQuery.length >= 3 &&
    !isLoadingAreas &&
    !areasError &&
    filteredAreaSuggestions.length === 0 &&
    selectedAreas.length < MAX_AREAS;
  const isMaxAreasReached = selectedAreas.length >= MAX_AREAS;
  // canSubmit deliberately does NOT include the exact-3-regions rule. We
  // keep the submit button clickable so the provider can ALWAYS save a
  // change once name+category basics are in place; the 3-region check is
  // enforced in handleSubmit with an inline error (same pattern as the
  // pledge gate documented near line 1006). Without this relaxation the
  // button stays silently disabled for any provider whose region
  // inference produced ≠3 regions, which is the reported Save-Changes bug.
  const canSubmit =
    !!name.trim() &&
    selectedCategories.length >= 1 &&
    !isSubmitting &&
    !showSuccessCelebration &&
    !showEditSuccessModal;
  const canAccessAreas = selectedCategories.length > 0;

  function nudgeSelectCategory() {
    setShakeCategories(true);
    setHighlightCategories(true);
    step2Ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => setShakeCategories(false), 550);
    window.setTimeout(() => setHighlightCategories(false), 1400);
  }

  const toggleCategory = (category: string) => {
    setSubmitError("");
    setSuccess(null);

    const normalizedInput = normalizeCategoryInput(category);
    if (!normalizedInput) return;
    const inputKey = categoryKey(normalizedInput);

    // Alias-aware path. If the picked value is a known alias, route the
    // canonical into selectedCategories AND auto-add the alias label into
    // selectedWorkTags[canonicalKey]. Never adds to customCategoryKeys, so
    // the submit path will not flag it as a pending category request.
    const aliasHit = aliasLookup.get(inputKey);
    if (aliasHit) {
      const canonical = normalizeCategoryInput(aliasHit.canonical);
      const canonicalKey = categoryKey(canonical);

      // Snapshot guard against MAX_CATEGORIES — same UX as the canonical
      // path. Closure value is the just-rendered state the user saw when
      // they clicked, which is correct in normal event flow.
      const isCanonicalSelected = hasCategoryKey(selectedCategories, canonicalKey);
      if (!isCanonicalSelected && selectedCategories.length >= MAX_CATEGORIES) {
        return;
      }

      setSelectedCategories((prev) => {
        if (hasCategoryKey(prev, canonicalKey)) return prev;
        if (prev.length >= MAX_CATEGORIES) return prev;
        return [...prev, canonical];
      });
      setSelectedWorkTags((prev) => {
        const current = prev[canonicalKey] || [];
        if (current.includes(aliasHit.label)) return prev;
        return { ...prev, [canonicalKey]: [...current, aliasHit.label] };
      });
      // Clear the typed query so:
      //   1. the input no longer shows the search term ("Dance") that
      //      conceptually resolved into a different label;
      //   2. noMatch derives from an empty q → false → "+ Add as new"
      //      cannot fire on a value that was actually a known alias.
      setCatQuery("");
      return;
    }

    // Canonical / unknown path — preserved verbatim from prior behaviour.
    setSelectedCategories((prev) => {
      if (hasCategoryKey(prev, inputKey)) {
        setCustomCategoryKeys((existingKeys) => existingKeys.filter((item) => item !== inputKey));
        // Drop any tag picks tied to a category that's being deselected so
        // we never ship orphan tags in the payload.
        setSelectedWorkTags((wt) => {
          if (!wt[inputKey]) return wt;
          const next = { ...wt };
          delete next[inputKey];
          return next;
        });
        return removeCategoryKey(prev, inputKey);
      }
      if (prev.length >= MAX_CATEGORIES) {
        return prev;
      }
      return [...prev, normalizedInput];
    });
  };

  const addArea = (area: string) => {
    setSubmitError("");
    setSuccess(null);
    setAreasLimitError("");
    const normalizedArea = normalizeAreaInput(area);
    const normalizedAreaKey = areaKey(normalizedArea);
    setSelectedAreas((prev) => {
      if (prev.some((item) => areaKey(item) === normalizedAreaKey)) return prev;
      if (prev.length >= MAX_AREAS) {
        setAreasLimitError("Max 5 areas allowed");
        return prev;
      }
      return [...prev, normalizedArea];
    });
    setCustomAreaKeys((prev) => prev.filter((item) => item !== normalizedAreaKey));
    setAreaSearch("");
    setShowAreaSuggestions(false);
  };

  const removeCategory = (category: string) => {
    const key = categoryKey(category);
    setCustomCategoryKeys((prev) => prev.filter((item) => item !== key));
    setSelectedCategories((prev) => removeCategoryKey(prev, key));
    // Mirror toggleCategory's cleanup so the X button doesn't leave orphans.
    setSelectedWorkTags((wt) => {
      if (!wt[key]) return wt;
      const next = { ...wt };
      delete next[key];
      return next;
    });
  };

  // Tag derivation per category. If any row for this canonical has
  // alias_type IN ('work_tag','local_name'), use ONLY those. Otherwise fall
  // back to all aliases for the category — matches the user spec for
  // partially-populated `alias_type` data.
  const getWorkTagsForCategory = (category: string): string[] => {
    const key = categoryKey(category);
    const rows = workTagsByCanonical[key] || [];
    if (rows.length === 0) return [];
    const strict = rows
      .filter(
        (r) => r.aliasType === "work_tag" || r.aliasType === "local_name"
      )
      .map((r) => r.tag);
    return strict.length > 0 ? strict : rows.map((r) => r.tag);
  };

  const toggleWorkTag = (category: string, tag: string) => {
    const key = categoryKey(category);
    setSelectedWorkTags((prev) => {
      const current = prev[key] || [];
      const next = current.includes(tag)
        ? current.filter((t) => t !== tag)
        : [...current, tag];
      return { ...prev, [key]: next };
    });
  };

  const removeArea = (area: string) => {
    setAreasLimitError("");
    const key = areaKey(area);
    setCustomAreaKeys((prev) => prev.filter((item) => item !== key));
    setSelectedAreas((prev) => prev.filter((item) => areaKey(item) !== key));
  };

  const handleAddCustomArea = () => {
    if (isMaxAreasReached) {
      setAreasLimitError("Max 5 areas allowed");
      return;
    }
    if (!canAddCustomArea) return;
    const pendingArea = normalizedAreaQuery;
    const pendingAreaKey = areaKey(pendingArea);
    addArea(pendingArea);
    setCustomAreaKeys((prev) => (prev.includes(pendingAreaKey) ? prev : [...prev, pendingAreaKey]));
  };

  const triggerConfettiAndModal = () => {
    setCelebrateText(
      "Woo hoo! Congratulations \uD83C\uDF89 You are the first one to register with us in this new category.\nWe have sent this request for admin approval."
    );
    ignoreNextOutsideClickRef.current = true;
    setCelebrate(true);
    popConfetti();
    setSubmitError("");
    setSuccess(null);
  };

  const handleAddCustomCategory = () => {
    if (!canAddCustomCategory) return;
    const pending = normalizedCatQuery;
    const key = categoryKey(pending);

    // Belt-and-braces: if the typed value is actually a known alias, divert
    // to the alias-resolved path so it never becomes a pending category
    // request. The canAddCustomCategory gate already excludes aliases via
    // filteredCategories, but this guards against a race during initial
    // alias load and against any future filter drift.
    if (aliasLookup.has(key)) {
      toggleCategory(pending);
      setCatQuery("");
      return;
    }

    const selectedKeys = toCategoryLookup(selectedCategories);
    const newKeys = new Set(customCategoryKeys);
    if (selectedKeys.has(key) || newKeys.has(key)) {
      setCatQuery("");
      return;
    }
    if (totalSelectedServices >= MAX_CATEGORIES) {
      return;
    }
    setSelectedCategories((prev) => uniqueCategoryValues([...prev, pending]));
    setCustomCategoryKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setCatQuery("");
    triggerConfettiAndModal();
  };

  const handleSubmit = async () => {
    if (!canSubmit || !/^\d{10}$/.test(phone)) return;

    // Region-count gate — moved out of `canSubmit` so the button stays
    // clickable. Rule: at least MIN_REGIONS (1), at most effectiveMaxRegions
    // (plan-derived). Custom localities are explicitly excluded from
    // this count. Surface a clear inline error instead of silently
    // disabling Save.
    if (selectedRegions.length < MIN_REGIONS) {
      setSubmitError("Please pick at least 1 service region before saving.");
      return;
    }
    if (planRuleKind === "fixed" && selectedRegions.length > effectiveMaxRegions) {
      // Mirror the server's strict-reduction relaxation: an over-cap
      // save is allowed when this submission adds nothing new AND is
      // strictly smaller than the saved set. Lets an over-plan
      // provider (e.g. after a downgrade) trim toward compliance in
      // steps without each intermediate save bouncing off this gate.
      const savedCount = Array.isArray(savedRegionCodes)
        ? savedRegionCodes.length
        : 0;
      const savedSet = new Set(savedRegionCodes ?? []);
      const isStrictReduction =
        savedCount > 0 &&
        selectedRegions.length < savedCount &&
        selectedRegions.every((rc) => savedSet.has(rc));
      if (!isStrictReduction) {
        setSubmitError(
          `Your plan covers ${effectiveMaxRegions} region${effectiveMaxRegions === 1 ? "" : "s"}. Reduce your selection or upgrade to save.`
        );
        return;
      }
    }

    // Pledge gate — NEW-registration path only. Edit mode (provider_update
    // flow below) skips this entirely so existing / imported / legacy
    // providers can keep saving changes without re-accepting. The submit
    // button is intentionally still enabled when the box is unchecked
    // (canSubmit excludes pledgeAccepted) so the user gets a clear inline
    // message instead of a silently-disabled button.
    if (!isEditMode && !pledgeAccepted) {
      setPledgeError(
        "Please accept the Provider Responsibility Pledge to continue."
      );
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");
    setSuccess(null);

    try {
      if (isEditMode) {
        // Provider self-update path. This does NOT use provider_register (insert)
        // semantics and must send real arrays, not JSON.stringify strings. The
        // server resolves provider_id from the session phone for ownership.
        const updateRes = await fetch("/api/provider/update", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim().toUpperCase(),
            categories: uniqueCategoryValues(selectedCategories),
            areas: selectedAreas,
            // Phase R-sync: cascade-supplied city. Server falls back to
            // default city when omitted.
            cityCode: selectedCityCode,
            // Stage A + B: explicit region-code list drives the plan-
            // aware enforcement on the server. Without this field the
            // server skips the region cap (legacy clients).
            selectedRegionCodes: selectedRegions,
          }),
        });
        const updateData = (await parseJsonSafe(updateRes)) as
          | {
              ok?: boolean;
              error?: string;
              message?: string;
              // Stage 3A payment enforcement response shape — only
              // present when the server rejects with PLAN_LIMIT_EXCEEDED.
              planCode?: string;
              maxRegions?: number;
              attempted?: number;
              // Stage A + B monthly-cap shape.
              changeType?: "region_change" | "category_change";
              monthlyLimit?: number;
              usedThisMonth?: number;
            }
          | null;
        if (!updateRes.ok || updateData?.ok !== true) {
          // Surface clear messages for the two enforcement gates.
          if (updateData?.error === "PLAN_LIMIT_EXCEEDED") {
            const allowed = Number(updateData.maxRegions ?? 1);
            const regionLabel = allowed === 1 ? "region" : "regions";
            throw new Error(
              `Your current plan supports only ${allowed} ${regionLabel}. Upgrade to add more regions.`
            );
          }
          // MONTHLY_CHANGE_LIMIT_EXCEEDED is no longer returned by
          // the server (the per-period throttle was removed for MVP),
          // so the dedicated client branch was deleted. The generic
          // fallback below catches it defensively if the route ever
          // returns it during a rollout window.
          throw new Error(
            updateData?.error || updateData?.message || "Failed to save changes"
          );
        }

        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event(PROVIDER_PROFILE_UPDATED_EVENT));
        }

        setShowEditSuccessModal(true);
        popConfetti();
        window.setTimeout(() => {
          router.push("/provider/dashboard");
        }, 1800);
        return;
      }

      const pendingNewCategories = selectedCategories.filter((category) =>
        customCategoryKeys.includes(categoryKey(category))
      );
      const pendingNewAreas = selectedAreas.filter((area) =>
        customAreaKeys.includes(areaKey(area))
      );
      const customCategory = pendingNewCategories[0] || "";
      // Phase 2B: merge AI-suggested-but-not-yet-active tags into the existing
      // workTags JSON field per canonical. No new wire field — server still
      // ignores unknowns today; when persistence lands the new tags arrive
      // through the same key as manually-picked ones.
      const mergedWorkTags: Record<string, string[]> = {};
      const tagKeys = new Set<string>([
        ...Object.keys(selectedWorkTags),
        ...Object.keys(pendingWorkTags),
      ]);
      for (const k of tagKeys) {
        const seen = new Set<string>();
        const merged: string[] = [];
        for (const t of selectedWorkTags[k] || []) {
          if (!seen.has(t)) {
            seen.add(t);
            merged.push(t);
          }
        }
        for (const t of pendingWorkTags[k] || []) {
          if (!seen.has(t)) {
            seen.add(t);
            merged.push(t);
          }
        }
        if (merged.length > 0) mergedWorkTags[k] = merged;
      }
      const payload = {
        action: "provider_register",
        phone,
        name: name.trim().toUpperCase(),
        categories: JSON.stringify(uniqueCategoryValues(selectedCategories)),
        areas: JSON.stringify(selectedAreas),
        pendingNewCategories: JSON.stringify(pendingNewCategories),
        pendingNewAreas: JSON.stringify(pendingNewAreas),
        customCategory,
        // MVP: ship tag picks on the wire. Backend currently ignores unknown
        // fields — when DB persistence lands the route reads this directly.
        // Edit-mode path doesn't reach this payload.
        workTags: JSON.stringify(mergedWorkTags),
        requiresAdminApproval:
          pendingNewCategories.length > 0 || pendingNewAreas.length > 0 ? "true" : "false",
        // Provider Responsibility Pledge — version only. The server
        // generates and stores pledge_accepted_at itself; we deliberately
        // do NOT send a client-side timestamp.
        pledgeVersion: PROVIDER_PLEDGE_VERSION,
        // Phase R-sync: cascade-supplied city. /api/kk register_provider
        // validates ^[A-Z]{3}$ and falls back to default city when
        // missing/malformed — preserves old-client compatibility.
        cityCode: selectedCityCode,
        // Stage A + B: explicit region-code list drives the free-plan
        // cap on first registration. The server rejects with
        // PLAN_LIMIT_EXCEEDED when length > 1 (free) and no paid plan
        // is on the provider yet.
        selectedRegionCodes: selectedRegions,
      };

      const response = await fetch("/api/kk", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = (await parseJsonSafe(response)) as RegisterResponse | null;
      if (!response.ok || data?.ok !== true) {
        // Backend returns 409 { error: "already_registered" } when the phone already
        // exists in providers. The register-entry guard handles this for new signups;
        // in edit mode it can still fire, but this form must not surface that message.
        if (
          data?.error === "already_registered" ||
          data?.message === "already_registered"
        ) {
          showSuccessToast("You are already registered. Redirecting to dashboard...");
          setTimeout(() => {
            router.push("/provider/dashboard");
          }, 1200);
          return;
        }
        throw new Error(data?.error || data?.message || "Failed to submit registration");
      }

      setSuccess(data ?? { ok: true, status: "success" });
      const hasPendingApproval =
        String(data?.pendingApproval || data?.provider?.PendingApproval || "no").trim().toLowerCase() ===
        "yes";
      const hasPendingAreaReview = Boolean(data?.requestedNewAreas?.length);
      const requiresAdminApproval = hasPendingApproval || hasPendingAreaReview;
      setSubmittedRequiresApproval(requiresAdminApproval);
      if (typeof window !== "undefined") {
        const canonicalPhone = normalizePhone10(phone);
        const responseProviderId = data?.providerId || "";
        const fallbackProfile = {
          ProviderID: responseProviderId,
          Name: name.trim().toUpperCase(),
          Phone: canonicalPhone,
          Verified: String(data?.verified || data?.provider?.Verified || "no").trim() || "no",
          PendingApproval:
            String(data?.pendingApproval || data?.provider?.PendingApproval || "no").trim() ||
            "no",
          Status:
            data?.provider?.Status ||
            (hasPendingApproval ? "Pending Admin Approval" : "Active"),
        };
        window.localStorage.setItem("kk_provider_profile", JSON.stringify(fallbackProfile));
        window.dispatchEvent(new Event(PROVIDER_PROFILE_UPDATED_EVENT));

        try {
          const profileResponse = await fetch(
            `/api/kk?action=get_provider_by_phone&phone=${encodeURIComponent(phone)}`,
            { cache: "no-store" }
          );
          const profileData = (await parseJsonSafe(profileResponse)) as ProviderProfileResponse | null;
          if (profileResponse.ok && profileData?.ok && profileData.provider) {
            window.localStorage.setItem(
              "kk_provider_profile",
              JSON.stringify(profileData.provider)
            );
            window.dispatchEvent(new Event(PROVIDER_PROFILE_UPDATED_EVENT));
          }
        } catch {
          // Sidebar will keep fallback until next successful profile refresh.
        }
      }
      setSuccessProviderId(data?.providerId || "");
      setShowSuccessCelebration(true);
      popConfetti();
      window.setTimeout(() => {
        router.push("/provider/dashboard");
      }, 2000);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to submit registration");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isAuthChecking) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="mx-auto w-full max-w-6xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          Loading...
        </div>
      </main>
    );
  }

  return (
    <main
      className={`min-h-screen bg-slate-50 px-4 py-8 ${
        showSuccessCelebration ? "pointer-events-none select-none" : ""
      }`}
    >
      <div className="mx-auto w-full max-w-6xl space-y-6">
        {isEditMode ? (
          <section className="rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4 shadow-sm">
            <p className="text-sm font-semibold text-sky-900">Edit Provider Profile</p>
            <p className="mt-1 text-sm text-sky-800">
              Your current provider details have been loaded so you can update your
              {editTarget === "areas" ? " service areas" : " services"} without changing the
              existing submission flow.
            </p>
          </section>
        ) : null}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-600">Service Provider</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900 md:text-3xl">List your service on Kaun Karega</h1>
          <p className="mt-2 text-sm text-slate-600">
            Complete your profile to join as a provider. Your application will go for verification.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="space-y-6">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Account</p>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  Logged-in WhatsApp: <span className="font-semibold text-slate-900">{phone}</span>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Step 1: Your name</label>
                <input
                  type="text"
                  value={name}
                  disabled={showSuccessCelebration}
                  onChange={(event) => {
                    setName(event.target.value.toUpperCase());
                    setSubmitError("");
                    setSuccess(null);
                  }}
                  placeholder="Enter your full name"
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 uppercase shadow-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label className="block text-sm font-semibold text-slate-700">Step 2: Service Categories</label>
                  <span className="text-xs font-medium text-slate-500">
                    {totalSelectedServices}/{MAX_CATEGORIES}
                  </span>
                </div>
                <p className="mb-2 text-xs text-slate-500">(Choose the services you actually provide)</p>

                {/* ── Provider Work Intake (Phase 1 UI shell) ──────────────
                    Renders ONLY behind NEXT_PUBLIC_PROVIDER_WORK_INTAKE_ENABLED.
                    Compact help header above the EXISTING category search — no
                    separate input. The category search below doubles as the
                    natural-language intake. Purely cosmetic in this phase: it
                    reuses `catQuery`, is never submitted differently, and does
                    not change the manual category selection behaviour. */}
                {workIntakeEnabled ? (
                  <div
                    data-testid="kk-work-intake-section"
                    className="mb-3 rounded-xl border border-orange-200 bg-orange-50/60 px-3 py-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-bold text-[#003d20]">
                        What work do you do?
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {workIntakeConfirmEnabled ? (
                          <button
                            type="button"
                            data-testid="kk-work-intake-trigger"
                            onClick={handleRunIntake}
                            disabled={
                              catQuery.trim().length < 3 ||
                              selectedCategories.length >= MAX_CATEGORIES ||
                              intake.kind === "resolving"
                            }
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#003d20] bg-[#003d20] px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#002a16] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <span aria-hidden="true">✨</span>
                            {intake.kind === "resolving"
                              ? "Understanding…"
                              : "Mera kaam samjho"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          data-testid="kk-bol-ke-samjhaaye"
                          aria-expanded={showBolExplanation}
                          onClick={() => setShowBolExplanation((v) => !v)}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#003d20] bg-white px-3 py-1.5 text-xs font-bold text-[#003d20] shadow-sm transition hover:bg-[#003d20] hover:text-white"
                        >
                          <span aria-hidden="true">💬</span>
                          Bol ke samjhaaye
                        </button>
                      </div>
                    </div>

                    {workIntakeConfirmEnabled ? (
                      <ProviderWorkIntakeConfirm
                        intake={intake}
                        onUse={applyGreenResolution}
                        onDismiss={dismissIntake}
                        onRetry={retryIntake}
                      />
                    ) : null}

                    {showBolExplanation ? (
                      <div
                        data-testid="kk-bol-explanation"
                        className="mt-2.5 rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-xs leading-5 text-slate-700"
                      >
                        <p>
                          Apna kaam simple bhasha mein bataiye. Jaise aap
                          customer ko samjhate ho, waise hi yahan likhiye. Kaun
                          Karega aapke kaam ko sahi service aur work type mein
                          set karne mein madad karega.
                        </p>
                        <button
                          type="button"
                          onClick={() => setShowBolExplanation(false)}
                          className="mt-2 inline-flex items-center rounded-full bg-[#003d20] px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-[#002a16]"
                        >
                          Theek hai
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* The existing category search is the SINGLE intake input. When
                    the flag is on and the field is empty, a dark/bold overlay
                    renders the animated Hindi/Hinglish hint (native placeholder
                    is too light); the overlay is pointer-events-none so taps and
                    typing reach the input, and the native placeholder is made
                    transparent only while the overlay shows. When the flag is
                    off, the input renders exactly as before. */}
                {(() => {
                  const showIntakeOverlay =
                    workIntakeEnabled &&
                    catQuery === "" &&
                    !isMaxReached &&
                    !showSuccessCelebration;
                  return (
                    <div className="relative">
                      <input
                        type="text"
                        value={catQuery}
                        onChange={(event) => {
                          const formatted = capitalizeWords(event.target.value);
                          setCatQuery(formatted);
                          // Phase 2B: any text edit invalidates the current
                          // resolve. Abort in-flight + dismiss panel so a stale
                          // green/yellow card can't reappear against new text.
                          if (workIntakeConfirmEnabled) {
                            intakeAbortRef.current?.abort();
                            intakeAbortRef.current = null;
                            setIntake((prev) =>
                              prev.kind === "idle" ? prev : { kind: "idle" }
                            );
                          }
                        }}
                        disabled={isMaxReached || showSuccessCelebration}
                        aria-label={
                          workIntakeEnabled
                            ? "Search a service or describe your work"
                            : undefined
                        }
                        placeholder={
                          isMaxReached
                            ? "You can choose only one main service category"
                            : "Search categories"
                        }
                        data-testid="kk-category-search"
                        className={`w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200 ${
                          showIntakeOverlay ? "placeholder:text-transparent" : ""
                        }`}
                      />
                      {showIntakeOverlay ? (
                        <div
                          aria-hidden="true"
                          data-testid="kk-work-intake-overlay"
                          className="pointer-events-none absolute inset-0 flex items-center truncate px-4 text-sm font-semibold text-black"
                        >
                          {workIntakePlaceholder || "Search categories"}
                        </div>
                      ) : null}
                    </div>
                  );
                })()}
                {workIntakeEnabled ? (
                  <p className="mt-2 text-[11px] text-slate-500">
                    Search a service or describe your work in your own words.
                  </p>
                ) : null}
                {/* Discoverability hint — the "+ Add as new service"
                    affordance below only surfaces after 3+ chars with no
                    match. The chip strip is empty by default (no full
                    canonical dump) so this hint is the primary cue that
                    typing is required. */}
                {!isMaxReached && !isLoadingCategories ? (
                  <p className="mt-2 text-[11px] text-slate-500">
                    Start typing your service. Don&apos;t see it? Tap{" "}
                    <span className="font-semibold text-[#003d20]">
                      + Add as new service
                    </span>{" "}
                    — admin will review it.
                  </p>
                ) : null}
                {isLoadingCategories ? <p className="mt-2 text-xs text-slate-500">Loading categories...</p> : null}
                {categoriesError ? <p className="mt-2 text-xs text-red-600">{categoriesError}</p> : null}
                <div
                  ref={step2Ref}
                  className={[
                    "mt-3 rounded-xl transition-all",
                    highlightCategories ? "ring-2 ring-red-400 bg-red-50/40" : "",
                    shakeCategories ? "kk-shake" : "",
                  ].join(" ")}
                >
                  {!isLoadingCategories && !categoriesError ? (
                    <div className="flex flex-wrap gap-2">
                    {filteredCategories.length > 0 ? (
                      filteredCategories.map((option) => {
                        // For aliases the "selected" state tracks the resolved
                        // canonical, but those rows are pre-filtered when the
                        // canonical is already selected, so this stays false in
                        // the alias case — kept for symmetry with the canonical
                        // path.
                        const selected = hasCategoryKey(
                          selectedCategories,
                          categoryKey(option.canonical)
                        );
                        const disabled = !selected && totalSelectedServices >= MAX_CATEGORIES;
                        return (
                          <button
                            key={`${option.isAlias ? "alias" : "canon"}:${option.value}`}
                            type="button"
                            onClick={() => toggleCategory(option.value)}
                            disabled={disabled}
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                              selected
                                ? "border-green-700 bg-green-700 text-white"
                                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                            } disabled:cursor-not-allowed disabled:opacity-60`}
                          >
                            {option.display}
                          </button>
                        );
                      })
                    ) : null}
                    {canAddCustomCategory ? (
                      <button
                        type="button"
                        onClick={handleAddCustomCategory}
                        className="inline-flex items-center gap-2 rounded-full border border-green-700 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-800"
                      >
                        + Add &ldquo;{normalizedCatQuery}&rdquo; as new
                        service
                      </button>
                    ) : null}
                    </div>
                  ) : null}
                  {totalSelectedServices > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                    {selectedCategories.map((category) => {
                      // Show alias-derived work tags inline so the provider
                      // sees what they actually picked. After an alias-pick
                      // the chip reads e.g. "dance teacher (hobby classes)"
                      // instead of just the canonical. Empty when the
                      // canonical was picked directly with no tags toggled.
                      const tags = selectedWorkTags[categoryKey(category)] || [];
                      const displayLabel =
                        tags.length > 0
                          ? `${tags.join(", ")} (${category})`
                          : category;
                      return (
                        <button
                          key={category}
                          type="button"
                          onClick={() => removeCategory(category)}
                          className="inline-flex items-center gap-2 rounded-full border border-green-700 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-800"
                        >
                          {displayLabel}
                          {customCategoryKeys.includes(categoryKey(category)) ? (
                            <span className="rounded bg-green-700 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                              NEW
                            </span>
                          ) : null}
                          <span aria-hidden="true">x</span>
                        </button>
                      );
                    })}
                    </div>
                  ) : null}
                  {/* Work-tag chips, one section per selected category that
                      has tags. Hidden in edit mode (decision 7) and hidden
                      for categories with no tag rows so the UI stays quiet
                      for plain categories. */}
                  {!isEditMode && totalSelectedServices > 0 ? (
                    <div className="mt-3 space-y-3">
                      {selectedCategories.map((category) => {
                        const tags = getWorkTagsForCategory(category);
                        if (tags.length === 0) return null;
                        const key = categoryKey(category);
                        const selectedTags = new Set(
                          selectedWorkTags[key] || []
                        );
                        return (
                          <div key={`tags-${key}`}>
                            <p className="mb-1 text-xs text-slate-500">
                              Work tags for{" "}
                              <span className="font-semibold text-slate-700">
                                {category}
                              </span>
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {tags.map((tag) => {
                                const isSelected = selectedTags.has(tag);
                                return (
                                  <button
                                    key={`${key}-${tag}`}
                                    type="button"
                                    onClick={() => toggleWorkTag(category, tag)}
                                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                                      isSelected
                                        ? "border-green-700 bg-green-700 text-white"
                                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                                    }`}
                                  >
                                    {tag}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  {/* Edit-mode work-term panel — reuses the same component
                      the provider dashboard mounts. It loads approved
                      work-tag chips for the selected canonical, persists
                      taps via /api/provider/work-terms, and routes custom
                      typed terms through /api/provider/aliases (admin
                      review). Registration mode keeps the inline
                      selectedWorkTags chips above because the provider row
                      doesn't exist yet — /api/provider/aliases would 403.
                      Mounts only when exactly one canonical is selected
                      AND the providerId has been captured from the edit
                      profile load. */}
                  {isEditMode &&
                  editingProviderId &&
                  selectedCategories.length === 1 ? (
                    <ProviderAliasSubmitter
                      providerId={editingProviderId}
                      canonicalCategory={selectedCategories[0]}
                    />
                  ) : null}
                </div>
                {highlightCategories ? (
                  <p className="mt-2 text-xs font-medium text-red-700">
                    Please select at least 1 service category first.
                  </p>
                ) : null}
              </div>

              <div
                ref={areaBoxRef}
                className="relative"
                tabIndex={!canAccessAreas ? 0 : -1}
                aria-disabled={!canAccessAreas}
                onMouseDown={(event) => {
                  if (canAccessAreas) return;
                  event.preventDefault();
                  nudgeSelectCategory();
                }}
                onClick={(event) => {
                  if (canAccessAreas) return;
                  event.preventDefault();
                  nudgeSelectCategory();
                }}
                onKeyDownCapture={(event) => {
                  if (canAccessAreas) return;
                  event.preventDefault();
                  nudgeSelectCategory();
                }}
              >
                {/* Phase R-sync: State + City cascade above the region
                    picker. Mirrors the homepage Step 3 cascade. Today
                    (single active city) both selects show one option;
                    rails are in place for multi-city without further
                    component changes. */}
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor="provider-geo-state">
                    State
                  </label>
                  <select
                    id="provider-geo-state"
                    value={selectedState}
                    onChange={(e) => setState(e.target.value)}
                    disabled={availableCities.length === 0}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
                  >
                    {statesList.length === 0 ? (
                      <option value="">Loading…</option>
                    ) : (
                      statesList.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))
                    )}
                  </select>
                  <label className="sr-only" htmlFor="provider-geo-city">
                    City
                  </label>
                  <select
                    id="provider-geo-city"
                    value={selectedCityCode}
                    onChange={(e) => setCity(e.target.value)}
                    disabled={citiesInSelectedState.length === 0}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
                  >
                    {citiesInSelectedState.length === 0 ? (
                      <option value="">Loading…</option>
                    ) : (
                      citiesInSelectedState.map((c) => (
                        <option key={c.city_code} value={c.city_code}>
                          {c.city_name}
                        </option>
                      ))
                    )}
                  </select>
                </div>
                {cityChangedNotice ? (
                  <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    City changed — coverage selection reset.
                    <button
                      type="button"
                      onClick={() => setCityChangedNotice(false)}
                      className="ml-2 font-semibold underline underline-offset-2 hover:text-amber-900"
                    >
                      Dismiss
                    </button>
                  </div>
                ) : null}
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label className="block text-sm font-semibold text-slate-700">
                    Step 3: Service regions —{" "}
                    {planRuleKind === "cityWide"
                      ? "whole city coverage"
                      : effectiveMaxRegions === 1
                        ? "1 free region included"
                        : `up to ${effectiveMaxRegions} regions`}
                  </label>
                  <span className="text-xs font-medium text-slate-500">
                    {planRuleKind === "cityWide"
                      ? `${selectedRegions.length} regions (all)`
                      : `${selectedRegions.length}/${effectiveMaxRegions}`}
                  </span>
                </div>
                <p className="mb-3 text-xs text-slate-500">
                  {planRuleKind === "cityWide"
                    ? "All active regions in this city are included."
                    : effectiveMaxRegions === 1
                      ? "Pick 1 region you cover. Upgrade to reach more areas."
                      : `Pick up to ${effectiveMaxRegions} major regions you cover.`}
                </p>

                {/* Plan summary + upgrade card. Always rendered above the
                    chip grid so the provider sees their cap and the
                    upgrade path in one place. Upgrade buttons are
                    INTENTIONALLY disabled — Razorpay integration is
                    deferred; the rails (provider_plans table, webhook
                    handler, signature verify) exist in the codebase but
                    are off until checkout UI is wired in a later phase. */}
                {planLoaded ? (
                  <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                        Current plan:{" "}
                        <span className="text-emerald-900">
                          {planCode === "all_jodhpur"
                            ? "₹101 — Whole City"
                            : planCode === "regions_5"
                              ? "₹31 — Major Areas"
                              : "Free"}
                        </span>
                      </p>
                      <p className="text-[11px] font-medium text-emerald-900/80">
                        Selected:{" "}
                        <span className="font-bold">
                          {selectedRegions.length}
                        </span>
                        {planRuleKind === "fixed"
                          ? ` / ${effectiveMaxRegions}`
                          : " (all)"}{" "}
                        region{selectedRegions.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-emerald-900/80">
                      {planRuleKind === "cityWide"
                        ? "Get business from whole city — every active region included."
                        : effectiveMaxRegions === 1
                          ? "1 free region included — upgrade to reach more areas."
                          : "Get business from major areas — up to 5 regions."}
                    </p>
                    {/* Phase 1 of the payment stabilization: the live
                        upgrade flow lives on the provider dashboard
                        (ProviderPlanCard), not here. Keeping two
                        checkout entry points (here + dashboard) created
                        an inconsistency where the register page said
                        "Payment coming soon" while the dashboard's
                        Razorpay button was live. This card now informs
                        the provider where to manage the plan and links
                        there in edit mode; first-time registration
                        defers the link to post-save.
                        cityWide (all_jodhpur) still shows a status pill
                        because it has no upgrade above it. */}
                    {planRuleKind === "cityWide" ? (
                      <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-900">
                        <span aria-hidden="true">✓</span>
                        <span>Whole city coverage active</span>
                      </div>
                    ) : (
                      <div
                        data-testid="provider-register-plan-manage-hint"
                        className="mt-3 rounded-xl border border-emerald-300 bg-white p-3"
                      >
                        <p className="text-sm font-semibold text-[#1B5E20]">
                          {planCode === "free"
                            ? "Want to reach more regions?"
                            : "Want to expand to the whole city?"}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-slate-600">
                          You can manage or upgrade your plan from your
                          Provider Dashboard
                          {isEditMode ? "." : " after registration."}
                        </p>
                        {isEditMode ? (
                          <button
                            type="button"
                            onClick={() => router.push("/provider/dashboard")}
                            data-testid="provider-register-plan-manage-link"
                            className="mt-2 inline-flex items-center justify-center rounded-lg border border-[#003d20] px-3 py-1.5 text-xs font-semibold text-[#003d20] transition hover:bg-[#003d20] hover:text-white"
                          >
                            Go to Provider Dashboard →
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : null}
                {/* Over-plan warning. Renders when the provider has more
                    regions saved than their current plan allows — a
                    state that can occur after a plan downgrade (manual
                    or expiry collapsing a paid plan to free) or any
                    historical write that pre-dates region-cap
                    enforcement. We never auto-trim provider_areas; the
                    server-side cap on submit will block the save until
                    the provider reduces their selection. The banner is
                    gated on planLoaded so it doesn't flash during the
                    default-1 initial render. cityWide plans have no
                    fixed cap and skip this warning by design. */}
                {planLoaded &&
                planRuleKind === "fixed" &&
                selectedRegions.length > effectiveMaxRegions ? (
                  <div
                    data-testid="provider-register-over-plan-warning"
                    role="alert"
                    className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
                  >
                    <p className="font-semibold">
                      You currently have {selectedRegions.length} regions saved,
                      but your plan allows {effectiveMaxRegions}. Please reduce
                      to {effectiveMaxRegions} before saving changes.
                    </p>
                    <p className="mt-1 text-rose-700/90">
                      Existing leads in extra regions still work — but you
                      won&rsquo;t be able to save further edits until the
                      selection matches your plan.
                    </p>
                  </div>
                ) : null}
                {isLoadingRegions ? (
                  <p className="text-xs text-slate-500">Loading regions…</p>
                ) : null}
                {regionsError ? (
                  <p className="text-xs text-red-600">Error: {regionsError}</p>
                ) : null}
                {!isLoadingRegions && !regionsError && regionOptions.length === 0 ? (
                  <p className="text-xs text-slate-500">No regions available.</p>
                ) : null}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {regionOptions.map((region) => {
                    const isSelected = selectedRegions.includes(region.region_code);
                    const isAtMax =
                      planRuleKind === "fixed" &&
                      !isSelected &&
                      selectedRegions.length >= effectiveMaxRegions;
                    // cityWide: every region is auto-selected and the
                    // toggle is read-only (provider can't opt out of
                    // single regions within an all-city plan).
                    const isReadOnly = planRuleKind === "cityWide";
                    const areaPreview = region.areas.slice(0, 6).join(" · ");
                    const moreCount = Math.max(0, region.areas.length - 6);
                    const isExpanded = expandedRegions.has(region.region_code);
                    const fullAreasId = `provider-region-areas-full-${region.region_code}`;
                    return (
                      <div
                        key={region.region_code}
                        className={`rounded-2xl border p-4 shadow-sm transition ${
                          isSelected
                            ? "border-emerald-500 bg-emerald-50/70"
                            : "border-slate-200 bg-white"
                        } ${isAtMax ? "opacity-60" : ""}`}
                      >
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-xs font-bold text-slate-600">
                            {region.region_code}
                          </span>
                          <h3 className="text-sm font-semibold text-slate-900">
                            {region.region_name || "—"}
                          </h3>
                        </div>
                        <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                          {region.areas.length} area
                          {region.areas.length === 1 ? "" : "s"}
                        </p>
                        {moreCount === 0 ? (
                          // Short region — render the static inline list
                          // unchanged. No toggle needed.
                          <p className="mt-2 text-xs leading-relaxed text-slate-700">
                            {areaPreview}
                          </p>
                        ) : isExpanded ? (
                          // Expanded — render the FULL area list and a
                          // "Show less" toggle. Wrapped in a div that
                          // carries the id targeted by aria-controls so
                          // assistive tech can find the disclosed
                          // content. Selection state is untouched.
                          <>
                            <div
                              id={fullAreasId}
                              data-testid={fullAreasId}
                              className="mt-2 text-xs leading-relaxed text-slate-700"
                            >
                              {region.areas.join(" · ")}
                            </div>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleExpandedRegion(region.region_code);
                              }}
                              aria-expanded={true}
                              aria-controls={fullAreasId}
                              data-testid={`provider-region-areas-toggle-${region.region_code}`}
                              className="mt-1 inline-flex items-center text-xs font-semibold text-slate-500 underline-offset-2 hover:text-[#003d20] hover:underline focus:outline-none focus:text-[#003d20] focus:underline"
                            >
                              Show less
                            </button>
                          </>
                        ) : (
                          // Collapsed — first 6 areas inline + a
                          // clickable toggle revealing the +N more
                          // count. Behaves like a muted link so the
                          // card's visual weight stays on Pick Region.
                          <p className="mt-2 text-xs leading-relaxed text-slate-700">
                            {areaPreview}
                            {" · "}
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleExpandedRegion(region.region_code);
                              }}
                              aria-expanded={false}
                              aria-controls={fullAreasId}
                              data-testid={`provider-region-areas-toggle-${region.region_code}`}
                              className="inline-flex items-center text-xs font-semibold text-slate-400 underline-offset-2 hover:text-[#003d20] hover:underline focus:outline-none focus:text-[#003d20] focus:underline"
                            >
                              +{moreCount} more
                            </button>
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (!canAccessAreas) {
                              nudgeSelectCategory();
                              return;
                            }
                            if (isReadOnly) return;
                            setSelectedRegions((prev) => {
                              if (prev.includes(region.region_code)) {
                                return prev.filter(
                                  (rc) => rc !== region.region_code
                                );
                              }
                              if (prev.length >= effectiveMaxRegions) return prev;
                              return [...prev, region.region_code];
                            });
                          }}
                          disabled={isAtMax || isReadOnly || showSuccessCelebration}
                          className={`mt-3 inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-bold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                            isSelected
                              ? "bg-emerald-600 text-white hover:bg-emerald-700"
                              : "border border-[#003d20] text-[#003d20] hover:bg-[#003d20]/5"
                          }`}
                        >
                          {isSelected ? "Selected ✓" : "Pick Region"}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Custom locality — preserves the provider → queue →
                    admin approval lifecycle even in the region-based UI.
                    Typed strings flow into pendingNewAreas at submit
                    (registration) or get caught by /api/provider/update's
                    enqueue (edit). */}
                <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-700">
                    Missing your locality?
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Add a custom locality (optional). Admin will review and
                    map it to a region for future matching. Custom
                    localities don&apos;t count toward your{" "}
                    {planRuleKind === "cityWide"
                      ? "whole-city"
                      : `${MIN_REGIONS}–${effectiveMaxRegions}`}{" "}
                    region selection.
                  </p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      value={customLocalityInput}
                      onChange={(e) => setCustomLocalityInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const v = customLocalityInput.trim();
                          if (!v) return;
                          const key = v.toLowerCase();
                          if (
                            customLocalities.some(
                              (c) => c.toLowerCase() === key
                            )
                          )
                            return;
                          setCustomLocalities((prev) => [...prev, v]);
                          setCustomLocalityInput("");
                        }
                      }}
                      placeholder="e.g. Demo Colony"
                      disabled={!canAccessAreas || showSuccessCelebration}
                      className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200 disabled:cursor-not-allowed disabled:bg-slate-100"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const v = customLocalityInput.trim();
                        if (!v) return;
                        const key = v.toLowerCase();
                        if (
                          customLocalities.some((c) => c.toLowerCase() === key)
                        )
                          return;
                        setCustomLocalities((prev) => [...prev, v]);
                        setCustomLocalityInput("");
                      }}
                      disabled={
                        !customLocalityInput.trim() ||
                        !canAccessAreas ||
                        showSuccessCelebration
                      }
                      className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Add locality
                    </button>
                  </div>
                  {customLocalities.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {customLocalities.map((loc) => (
                        <span
                          key={loc}
                          className="inline-flex items-center gap-2 rounded-full border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800"
                        >
                          {loc}
                          <span className="rounded bg-sky-700 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                            REVIEW
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setCustomLocalities((prev) =>
                                prev.filter(
                                  (c) =>
                                    c.toLowerCase() !== loc.toLowerCase()
                                )
                              )
                            }
                            aria-label={`Remove ${loc}`}
                            className="text-sky-700 hover:text-sky-900"
                          >
                            x
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              {!isEditMode ? (
                <div
                  data-testid="kk-pledge-card"
                  className="rounded-2xl border border-[#003d20]/15 bg-gradient-to-br from-orange-50/60 to-green-50/40 p-4 shadow-sm"
                >
                  <div className="flex items-center gap-2">
                    <span aria-hidden="true" className="text-base">🤝</span>
                    <p className="text-sm font-bold text-[#003d20]">
                      Provider Responsibility Pledge
                    </p>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    A quick read so we&apos;re on the same page.
                  </p>
                  <div className="mt-3 max-h-40 overflow-y-auto rounded-xl border border-white/60 bg-white p-3 text-xs leading-5 text-slate-600">
                    {PROVIDER_PLEDGE_TEXT.split(/\n\n+/).map((paragraph, idx) => (
                      <p
                        key={idx}
                        className={`mb-2 last:mb-0 ${
                          idx === 0 ? "font-semibold text-slate-700" : ""
                        }`}
                      >
                        {paragraph}
                      </p>
                    ))}
                  </div>
                  <label className="mt-3 flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={pledgeAccepted}
                      onChange={(e) => {
                        setPledgeAccepted(e.target.checked);
                        if (e.target.checked) setPledgeError(null);
                      }}
                      data-testid="kk-pledge-checkbox"
                      className="mt-0.5 h-4 w-4 cursor-pointer accent-[#003d20]"
                    />
                    <span className="text-xs font-semibold text-slate-800">
                      I have read and accept the Provider Responsibility Pledge.
                    </span>
                  </label>
                  <p
                    data-testid="kk-pledge-trust-line"
                    className="ml-6 mt-1 text-[11px] text-slate-500"
                  >
                    This helps keep Kaun Karega safe and trustworthy for everyone.
                  </p>
                  {pledgeError ? (
                    <p
                      data-testid="kk-pledge-error"
                      className="ml-6 mt-2 text-xs font-medium text-red-600"
                    >
                      {pledgeError}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {submitError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{submitError}</div>
              ) : null}

                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-white" />
                    Submitting...
                  </>
                  ) : (
                    isEditMode ? "Save Changes" : "Submit Application"
                  )}
                </button>
              </div>
          </section>

          <aside className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Summary</h2>
            <div className="mt-4 space-y-4 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Name</p>
                <p className="mt-1 font-medium text-slate-900">{name.trim() || "-"}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Phone</p>
                <p className="mt-1 font-medium text-slate-900">{phone || "-"}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Service Categories</p>
                {selectedCategories.length > 0 ? (
                  <p className="mt-1 text-slate-700">{selectedCategories.join(", ")}</p>
                ) : (
                  <p className="mt-1 text-slate-700">-</p>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Areas</p>
                <p className="mt-1 text-slate-700">
                  {selectedAreas.length > 0
                    ? selectedAreas.map((area) =>
                        customAreaKeys.includes(areaKey(area)) ? `${area} (pending review)` : area
                      ).join(", ")
                    : "-"}
                </p>
              </div>
            </div>

            {success ? (
            <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-4">
              <p className="text-sm font-semibold text-green-800">
                  {success.message ||
                    (submittedRequiresApproval
                      ? "Application submitted successfully. Your new category request is pending admin approval."
                      : "Registration successful. Your profile has been verified successfully.")}
              </p>
              <p className="mt-2 text-sm text-green-900">
                ProviderID: <span className="font-bold">{success.providerId || "Will be assigned soon"}</span>
              </p>
              {success.requestedNewCategories?.length ? (
                <p className="mt-2 text-xs text-green-700">
                  Pending categories: {success.requestedNewCategories.join(", ")}
                </p>
              ) : null}
              {success.requestedNewAreas?.length ? (
                <p className="mt-2 text-xs text-green-700">
                  Pending area review: {success.requestedNewAreas.join(", ")}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-green-700">
                Selected: {selectedCategories.length} categories, {selectedAreas.length} areas
              </p>
            </div>
          ) : null}
          </aside>
        </div>
      </div>
      {celebrate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="relative p-6 text-center">
            <button
              type="button"
              onClick={() => setCelebrate(false)}
              className="absolute right-3 top-3 rounded-md px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close celebration"
            >
              X
            </button>
              <h2 className="text-2xl font-bold tracking-wide text-[#0F5132] drop-shadow-sm md:text-3xl">
                🎉 Congratulations!
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-gray-600">
                You are the first service provider to register in this category on Kaun Karega.
                <br />
                Our team will review and approve it shortly.
                <br />
                Thank you for helping us grow 🚀
              </p>
            </div>
          </div>
        </div>
      ) : null}
      <InAppToastStack toasts={toasts} onDismiss={dismissToast} />
      {showSuccessCelebration ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 px-4">
          <div className="w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-6 text-center shadow-2xl">
            <h2 className="text-2xl font-bold tracking-wide text-emerald-700 md:text-3xl">
              Congratulations!
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-700">
              {submittedRequiresApproval
                ? "Your application has been submitted successfully and is pending admin approval."
                : "You are now a registered and verified service provider on Kaun Karega."}
            </p>
            <p className="mt-3 text-sm font-semibold text-slate-900">
              ProviderID: {successProviderId || "PR-xxxx"}
            </p>
          </div>
        </div>
      ) : null}
      {showEditSuccessModal ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 px-4">
          <div className="w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-6 text-center shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-7 w-7"
                aria-hidden="true"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h2 className="mt-4 text-2xl font-bold tracking-wide text-emerald-700 md:text-3xl">
              Changes Saved Successfully
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-700">
              Your services and areas have been updated.
            </p>
            {selectedCategories.some((category) =>
              customCategoryKeys.includes(categoryKey(category))
            ) ? (
              <p className="mt-3 text-xs text-slate-500">
                New service requests will be reviewed by admin.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      <style jsx global>{`
        @keyframes kk-shake {
          0%,
          100% {
            transform: translateX(0);
          }
          15% {
            transform: translateX(-8px);
          }
          30% {
            transform: translateX(6px);
          }
          45% {
            transform: translateX(-4px);
          }
          60% {
            transform: translateX(6px);
          }
          75% {
            transform: translateX(-4px);
          }
          90% {
            transform: translateX(4px);
          }
        }
        .kk-shake {
          animation: kk-shake 0.55s ease-in-out;
        }
      `}</style>
    </main>
  );
}

export default function ProviderRegisterPage() {
  return (
    <Suspense fallback={null}>
      <ProviderRegisterPageInner />
    </Suspense>
  );
}
