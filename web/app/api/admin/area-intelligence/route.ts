import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase/admin";
import { requireAdminSession } from "@/lib/adminAuth";

// Sandbox admin editor for the Area Intelligence tables.
// Does NOT touch live matching, provider registration, homepage search,
// /api/find-provider, /api/areas, or the existing areas / area_aliases
// logic. Auth: requireAdminSession on every entry point (same pattern as
// /api/admin/aliases). No DELETE — soft-deactivate via active=false.

export const runtime = "nodejs";

const MAX_ROWS = 5000;

type Json = Record<string, unknown>;

const isString = (v: unknown): v is string => typeof v === "string";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

// Trim helper. Empty string → "" (caller can decide to coerce to null).
const trim = (v: unknown): string => (isString(v) ? v.trim() : "");

// notes: "" → null on write (don't store empty strings as junk).
const notesValue = (v: unknown): string | null => {
  if (v === undefined) return undefined as unknown as null; // sentinel: no change
  if (v === null) return null;
  const t = trim(v);
  return t.length === 0 ? null : t;
};

async function readJson(request: Request): Promise<Json | null> {
  try {
    return (await request.json()) as Json;
  } catch {
    return null;
  }
}

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "Unauthorized" },
    { status: 401 }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GET
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) return unauthorized();

  const [regions, areas, aliases] = await Promise.all([
    adminSupabase
      .from("service_regions")
      .select("region_code, region_name, active, notes")
      .order("region_code", { ascending: true })
      .limit(MAX_ROWS),
    adminSupabase
      .from("service_region_areas")
      .select("area_code, canonical_area, region_code, active, notes")
      .order("region_code", { ascending: true })
      .order("canonical_area", { ascending: true })
      .limit(MAX_ROWS),
    adminSupabase
      .from("service_region_area_aliases")
      .select("alias_code, alias, canonical_area, region_code, active, notes")
      .order("region_code", { ascending: true })
      .order("alias", { ascending: true })
      .limit(MAX_ROWS),
  ]);

  if (regions.error || areas.error || aliases.error) {
    const err = regions.error || areas.error || aliases.error;
    console.error("[admin/area-intelligence GET] db error", err);
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", detail: err?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    regions: regions.data ?? [],
    areas: areas.data ?? [],
    aliases: aliases.data ?? [],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH — update one area or one alias
// ─────────────────────────────────────────────────────────────────────────────

export async function PATCH(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) return unauthorized();

  const body = await readJson(request);
  if (!body) {
    return NextResponse.json(
      { ok: false, error: "INVALID_JSON_BODY" },
      { status: 400 }
    );
  }

  const target = String(body.target ?? "").toLowerCase();
  if (target !== "area" && target !== "alias" && target !== "region") {
    return NextResponse.json(
      { ok: false, error: "INVALID_TARGET" },
      { status: 400 }
    );
  }

  if (target === "region") return await patchRegion(body);
  if (target === "area") return await patchArea(body);
  return await patchAlias(body);
}

async function patchRegion(body: Json) {
  const region_code = trim(body.region_code);
  if (!region_code) {
    return NextResponse.json(
      { ok: false, error: "REGION_CODE_REQUIRED" },
      { status: 400 }
    );
  }

  const { data: existing, error: lookupErr } = await adminSupabase
    .from("service_regions")
    .select("region_code, region_name, active, notes")
    .eq("region_code", region_code)
    .maybeSingle();
  if (lookupErr) {
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", detail: lookupErr.message },
      { status: 500 }
    );
  }
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "REGION_NOT_FOUND" },
      { status: 404 }
    );
  }

  const update: Json = {};

  // region_code is immutable. Silently ignore if the caller includes it in
  // the patch body — UI typically echoes the row back; surfacing an error
  // here would be hostile.

  if (body.region_name !== undefined) {
    const v = trim(body.region_name);
    if (!v) {
      return NextResponse.json(
        { ok: false, error: "REGION_NAME_EMPTY" },
        { status: 400 }
      );
    }
    update.region_name = v;
  }

  if (body.active !== undefined) {
    if (!isBool(body.active)) {
      return NextResponse.json(
        { ok: false, error: "ACTIVE_MUST_BE_BOOLEAN" },
        { status: 400 }
      );
    }
    update.active = body.active;
  }

  if (body.notes !== undefined) {
    update.notes = notesValue(body.notes);
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true, region: existing, changed: false });
  }

  const { data: updated, error: updErr } = await adminSupabase
    .from("service_regions")
    .update(update)
    .eq("region_code", region_code)
    .select("region_code, region_name, active, notes")
    .maybeSingle();
  if (updErr) {
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", detail: updErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, region: updated, changed: true });
}

async function patchArea(body: Json) {
  const area_code = trim(body.area_code);
  if (!area_code) {
    return NextResponse.json(
      { ok: false, error: "AREA_CODE_REQUIRED" },
      { status: 400 }
    );
  }

  // Load the existing row so we can detect what actually changes and run
  // the right safety checks.
  const { data: existing, error: lookupErr } = await adminSupabase
    .from("service_region_areas")
    .select("area_code, canonical_area, region_code, active, notes")
    .eq("area_code", area_code)
    .maybeSingle();
  if (lookupErr) {
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", detail: lookupErr.message },
      { status: 500 }
    );
  }
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "AREA_NOT_FOUND" },
      { status: 404 }
    );
  }

  const update: Json = {};

  if (body.canonical_area !== undefined) {
    const v = trim(body.canonical_area);
    if (!v) {
      return NextResponse.json(
        { ok: false, error: "CANONICAL_AREA_EMPTY" },
        { status: 400 }
      );
    }
    update.canonical_area = v;
  }

  if (body.region_code !== undefined) {
    const v = trim(body.region_code);
    if (!v) {
      return NextResponse.json(
        { ok: false, error: "REGION_CODE_EMPTY" },
        { status: 400 }
      );
    }
    const exists = await regionExists(v);
    if (!exists) {
      return NextResponse.json(
        { ok: false, error: "REGION_NOT_FOUND" },
        { status: 404 }
      );
    }
    update.region_code = v;
  }

  if (body.active !== undefined) {
    if (!isBool(body.active)) {
      return NextResponse.json(
        { ok: false, error: "ACTIVE_MUST_BE_BOOLEAN" },
        { status: 400 }
      );
    }
    update.active = body.active;
  }

  if (body.notes !== undefined) {
    update.notes = notesValue(body.notes);
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true, area: existing, changed: false });
  }

  // Safety: refuse to rename canonical_area or move region_code if any
  // alias rows still reference the old (canonical_area, region_code) pair.
  // Forces the admin to deal with the aliases first, which protects against
  // silent dangling-alias rows. Audit check 3 currently passes — keep it that way.
  const renaming =
    update.canonical_area !== undefined &&
    update.canonical_area !== existing.canonical_area;
  const moving =
    update.region_code !== undefined &&
    update.region_code !== existing.region_code;

  if (renaming || moving) {
    const { data: dependentAliases, error: depErr } = await adminSupabase
      .from("service_region_area_aliases")
      .select("alias_code, alias")
      .eq("canonical_area", existing.canonical_area)
      .eq("region_code", existing.region_code)
      .limit(50);
    if (depErr) {
      return NextResponse.json(
        { ok: false, error: "DB_ERROR", detail: depErr.message },
        { status: 500 }
      );
    }
    if (dependentAliases && dependentAliases.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "AREA_HAS_DEPENDENT_ALIASES",
          detail:
            "Reassign or deactivate the aliases below before renaming or moving this area.",
          aliases: dependentAliases,
        },
        { status: 409 }
      );
    }
  }

  const { data: updated, error: updErr } = await adminSupabase
    .from("service_region_areas")
    .update(update)
    .eq("area_code", area_code)
    .select("area_code, canonical_area, region_code, active, notes")
    .maybeSingle();
  if (updErr) {
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", detail: updErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, area: updated, changed: true });
}

async function patchAlias(body: Json) {
  const alias_code = trim(body.alias_code);
  if (!alias_code) {
    return NextResponse.json(
      { ok: false, error: "ALIAS_CODE_REQUIRED" },
      { status: 400 }
    );
  }

  const { data: existing, error: lookupErr } = await adminSupabase
    .from("service_region_area_aliases")
    .select("alias_code, alias, canonical_area, region_code, active, notes")
    .eq("alias_code", alias_code)
    .maybeSingle();
  if (lookupErr) {
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", detail: lookupErr.message },
      { status: 500 }
    );
  }
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "ALIAS_NOT_FOUND" },
      { status: 404 }
    );
  }

  const update: Json = {};

  if (body.alias !== undefined) {
    const v = trim(body.alias);
    if (!v) {
      return NextResponse.json(
        { ok: false, error: "ALIAS_EMPTY" },
        { status: 400 }
      );
    }
    update.alias = v;
  }

  if (body.canonical_area !== undefined) {
    const v = trim(body.canonical_area);
    if (!v) {
      return NextResponse.json(
        { ok: false, error: "CANONICAL_AREA_EMPTY" },
        { status: 400 }
      );
    }
    update.canonical_area = v;
  }

  if (body.region_code !== undefined) {
    const v = trim(body.region_code);
    if (!v) {
      return NextResponse.json(
        { ok: false, error: "REGION_CODE_EMPTY" },
        { status: 400 }
      );
    }
    const exists = await regionExists(v);
    if (!exists) {
      return NextResponse.json(
        { ok: false, error: "REGION_NOT_FOUND" },
        { status: 404 }
      );
    }
    update.region_code = v;
  }

  if (body.active !== undefined) {
    if (!isBool(body.active)) {
      return NextResponse.json(
        { ok: false, error: "ACTIVE_MUST_BE_BOOLEAN" },
        { status: 400 }
      );
    }
    update.active = body.active;
  }

  if (body.notes !== undefined) {
    update.notes = notesValue(body.notes);
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true, alias: existing, changed: false });
  }

  // If (canonical_area, region_code) changed, the resulting pair must exist
  // in service_region_areas — same invariant that audit check 3 enforces.
  const nextCanonical =
    update.canonical_area !== undefined
      ? (update.canonical_area as string)
      : existing.canonical_area;
  const nextRegion =
    update.region_code !== undefined
      ? (update.region_code as string)
      : existing.region_code;

  const pairChanged =
    nextCanonical !== existing.canonical_area ||
    nextRegion !== existing.region_code;

  if (pairChanged) {
    const exists = await areaPairExists(nextCanonical, nextRegion);
    if (!exists) {
      return NextResponse.json(
        {
          ok: false,
          error: "AREA_PAIR_NOT_FOUND",
          detail: `No canonical area "${nextCanonical}" exists under region ${nextRegion}.`,
        },
        { status: 409 }
      );
    }
  }

  // If the alias text changed, defend the per-region uniqueness invariant.
  if (update.alias !== undefined) {
    const dup = await aliasExistsInRegion(
      update.alias as string,
      nextRegion,
      alias_code
    );
    if (dup) {
      return NextResponse.json(
        {
          ok: false,
          error: "DUPLICATE_ALIAS_IN_REGION",
          detail: `Alias "${update.alias}" already exists in region ${nextRegion}.`,
        },
        { status: 409 }
      );
    }
  }

  const { data: updated, error: updErr } = await adminSupabase
    .from("service_region_area_aliases")
    .update(update)
    .eq("alias_code", alias_code)
    .select("alias_code, alias, canonical_area, region_code, active, notes")
    .maybeSingle();
  if (updErr) {
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", detail: updErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, alias: updated, changed: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — create a new alias
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) return unauthorized();

  const body = await readJson(request);
  if (!body) {
    return NextResponse.json(
      { ok: false, error: "INVALID_JSON_BODY" },
      { status: 400 }
    );
  }

  // `target` defaults to "alias" to preserve the original POST contract
  // (the editor's existing Create-Alias form does not send a target field).
  // New region / area creation explicitly sets target.
  const target = String(body.target ?? "alias").toLowerCase();
  if (target !== "alias" && target !== "area" && target !== "region") {
    return NextResponse.json(
      { ok: false, error: "INVALID_TARGET" },
      { status: 400 }
    );
  }
  if (target === "region") return await postRegion(body);
  if (target === "area") return await postArea(body);
  // fall through to alias create below

  const alias_code = trim(body.alias_code);
  const alias = trim(body.alias);
  const canonical_area = trim(body.canonical_area);
  const region_code = trim(body.region_code);
  const activeRaw = body.active;
  const active = activeRaw === undefined ? true : Boolean(activeRaw);
  const notes = notesValue(body.notes);

  if (!alias_code || !alias || !canonical_area || !region_code) {
    return NextResponse.json(
      {
        ok: false,
        error: "REQUIRED_FIELDS_MISSING",
        required: ["alias_code", "alias", "canonical_area", "region_code"],
      },
      { status: 400 }
    );
  }

  // alias_code must be unique.
  const { data: codeDup, error: codeDupErr } = await adminSupabase
    .from("service_region_area_aliases")
    .select("alias_code")
    .eq("alias_code", alias_code)
    .maybeSingle();
  if (codeDupErr) {
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", detail: codeDupErr.message },
      { status: 500 }
    );
  }
  if (codeDup) {
    return NextResponse.json(
      { ok: false, error: "DUPLICATE_ALIAS_CODE" },
      { status: 409 }
    );
  }

  // Region must exist.
  const regOk = await regionExists(region_code);
  if (!regOk) {
    return NextResponse.json(
      { ok: false, error: "REGION_NOT_FOUND" },
      { status: 404 }
    );
  }

  // (canonical_area, region_code) must exist in service_region_areas.
  const pairOk = await areaPairExists(canonical_area, region_code);
  if (!pairOk) {
    return NextResponse.json(
      {
        ok: false,
        error: "AREA_PAIR_NOT_FOUND",
        detail: `No canonical area "${canonical_area}" exists under region ${region_code}.`,
      },
      { status: 409 }
    );
  }

  // Per-region alias uniqueness (case-insensitive).
  const dup = await aliasExistsInRegion(alias, region_code, null);
  if (dup) {
    return NextResponse.json(
      {
        ok: false,
        error: "DUPLICATE_ALIAS_IN_REGION",
        detail: `Alias "${alias}" already exists in region ${region_code}.`,
      },
      { status: 409 }
    );
  }

  const { data: inserted, error: insertErr } = await adminSupabase
    .from("service_region_area_aliases")
    .insert({
      alias_code,
      alias,
      canonical_area,
      region_code,
      active,
      notes,
    })
    .select("alias_code, alias, canonical_area, region_code, active, notes")
    .maybeSingle();

  if (insertErr) {
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", detail: insertErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, alias: inserted });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST region / area
// ─────────────────────────────────────────────────────────────────────────────

async function postRegion(body: Json) {
  const region_code = trim(body.region_code);
  const region_name = trim(body.region_name);
  const activeRaw = body.active;
  const active = activeRaw === undefined ? true : Boolean(activeRaw);
  const notes = notesValue(body.notes);

  if (!region_code || !region_name) {
    return NextResponse.json(
      {
        ok: false,
        error: "REQUIRED_FIELDS_MISSING",
        required: ["region_code", "region_name"],
      },
      { status: 400 }
    );
  }

  const { data: codeDup, error: codeDupErr } = await adminSupabase
    .from("service_regions")
    .select("region_code")
    .eq("region_code", region_code)
    .maybeSingle();
  if (codeDupErr) {
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", detail: codeDupErr.message },
      { status: 500 }
    );
  }
  if (codeDup) {
    return NextResponse.json(
      { ok: false, error: "DUPLICATE_REGION_CODE" },
      { status: 409 }
    );
  }

  const { data: inserted, error: insertErr } = await adminSupabase
    .from("service_regions")
    .insert({ region_code, region_name, active, notes })
    .select("region_code, region_name, active, notes")
    .maybeSingle();
  if (insertErr) {
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", detail: insertErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, region: inserted });
}

async function postArea(body: Json) {
  const area_code = trim(body.area_code);
  const canonical_area = trim(body.canonical_area);
  const region_code = trim(body.region_code);
  const activeRaw = body.active;
  const active = activeRaw === undefined ? true : Boolean(activeRaw);
  const notes = notesValue(body.notes);

  if (!area_code || !canonical_area || !region_code) {
    return NextResponse.json(
      {
        ok: false,
        error: "REQUIRED_FIELDS_MISSING",
        required: ["area_code", "canonical_area", "region_code"],
      },
      { status: 400 }
    );
  }

  // area_code unique
  const { data: codeDup, error: codeDupErr } = await adminSupabase
    .from("service_region_areas")
    .select("area_code")
    .eq("area_code", area_code)
    .maybeSingle();
  if (codeDupErr) {
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", detail: codeDupErr.message },
      { status: 500 }
    );
  }
  if (codeDup) {
    return NextResponse.json(
      { ok: false, error: "DUPLICATE_AREA_CODE" },
      { status: 409 }
    );
  }

  // region must exist
  const regOk = await regionExists(region_code);
  if (!regOk) {
    return NextResponse.json(
      { ok: false, error: "REGION_NOT_FOUND" },
      { status: 404 }
    );
  }

  // No duplicate (canonical_area, region_code) — case-insensitive.
  // Mirrors the resolver's normalize-on-input contract: two areas with the
  // same name in the same region would resolve ambiguously.
  const { data: pairDup, error: pairDupErr } = await adminSupabase
    .from("service_region_areas")
    .select("area_code")
    .ilike("canonical_area", canonical_area)
    .eq("region_code", region_code)
    .limit(1);
  if (pairDupErr) {
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", detail: pairDupErr.message },
      { status: 500 }
    );
  }
  if (pairDup && pairDup.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "DUPLICATE_AREA_IN_REGION",
        detail: `Canonical area "${canonical_area}" already exists in region ${region_code}.`,
      },
      { status: 409 }
    );
  }

  const { data: inserted, error: insertErr } = await adminSupabase
    .from("service_region_areas")
    .insert({ area_code, canonical_area, region_code, active, notes })
    .select("area_code, canonical_area, region_code, active, notes")
    .maybeSingle();
  if (insertErr) {
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", detail: insertErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, area: inserted });
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

async function regionExists(region_code: string): Promise<boolean> {
  const { data } = await adminSupabase
    .from("service_regions")
    .select("region_code")
    .eq("region_code", region_code)
    .maybeSingle();
  return Boolean(data);
}

async function areaPairExists(
  canonical_area: string,
  region_code: string
): Promise<boolean> {
  const { data } = await adminSupabase
    .from("service_region_areas")
    .select("area_code")
    .ilike("canonical_area", canonical_area)
    .eq("region_code", region_code)
    .limit(1);
  return Boolean(data && data.length > 0);
}

async function aliasExistsInRegion(
  alias: string,
  region_code: string,
  excludeAliasCode: string | null
): Promise<boolean> {
  let q = adminSupabase
    .from("service_region_area_aliases")
    .select("alias_code")
    .ilike("alias", alias)
    .eq("region_code", region_code);
  if (excludeAliasCode) q = q.neq("alias_code", excludeAliasCode);
  const { data } = await q.limit(1);
  return Boolean(data && data.length > 0);
}
