import { adminSupabase } from "../supabase/admin";
import { addAreaAliasToSupabase } from "./adminAreaMappings";

// ---------------------------------------------------------------------------
// Normalization — same rules as adminAreaMappings.ts / GAS normalizeAreaName_
// ---------------------------------------------------------------------------

function normalizeAreaName(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toAreaKey(value: string): string {
  return normalizeAreaName(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function makeReviewId(): string {
  return `ARQ-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UnmappedAreaReview = {
  ReviewID: string;
  RawArea: string;
  Status: string;
  Occurrences: number;
  SourceType: string;
  SourceRef: string;
  FirstSeenAt: string;
  LastSeenAt: string;
  ResolvedCanonicalArea: string;
};

type ReviewRow = {
  review_id: string;
  raw_area: string;
  normalized_key: string;
  status: string;
  occurrences: number;
  source_type: string;
  source_ref: string;
  first_seen_at: string;
  last_seen_at: string;
  resolved_canonical_area: string;
  resolved_at: string | null;
};

export type UnmappedAreasResult =
  | { ok: true; status: "success"; reviews: UnmappedAreaReview[] }
  | { ok: false; status: "error"; error: string };

export type UnmappedAreaMutateResult =
  | ({ ok: true; status: "success"; reviewId: string } & Record<string, unknown>)
  | { ok: false; status: "error"; error: string };

function mapReviewRow(row: ReviewRow): UnmappedAreaReview {
  return {
    ReviewID: row.review_id,
    RawArea: row.raw_area,
    Status: row.status || "pending",
    Occurrences: Number(row.occurrences) || 0,
    SourceType: row.source_type || "",
    SourceRef: row.source_ref || "",
    FirstSeenAt: row.first_seen_at || "",
    LastSeenAt: row.last_seen_at || "",
    ResolvedCanonicalArea: row.resolved_canonical_area || "",
  };
}

// ---------------------------------------------------------------------------
// Queue a single unmapped area during provider registration
// Mirrors GAS queueAreaReviewItem_()
// ---------------------------------------------------------------------------

export async function queueUnmappedAreaForReview(params: {
  rawArea: string;
  sourceType: string;
  sourceRef: string;
}): Promise<void> {
  try {
    const normalized = normalizeAreaName(params.rawArea);
    if (!normalized) return;
    const key = toAreaKey(normalized);
    if (!key) return;

    const nowIso = new Date().toISOString();

    // Check if a pending row with the same normalized key already exists
    const { data: existing } = await adminSupabase
      .from("area_review_queue")
      .select("review_id, occurrences")
      .eq("normalized_key", key)
      .eq("status", "pending")
      .maybeSingle();

    if (existing) {
      await adminSupabase
        .from("area_review_queue")
        .update({
          occurrences: (existing.occurrences || 0) + 1,
          last_seen_at: nowIso,
          raw_area: normalized,
        })
        .eq("review_id", existing.review_id);
    } else {
      await adminSupabase.from("area_review_queue").insert({
        review_id: makeReviewId(),
        raw_area: normalized,
        normalized_key: key,
        status: "pending",
        occurrences: 1,
        source_type: params.sourceType,
        source_ref: params.sourceRef,
        first_seen_at: nowIso,
        last_seen_at: nowIso,
        resolved_canonical_area: "",
        resolved_at: null,
      });
    }
  } catch {
    // Non-fatal: queuing failure must not break provider registration
  }
}

// ---------------------------------------------------------------------------
// READ — admin_get_unmapped_areas
// ---------------------------------------------------------------------------

export async function getUnmappedAreasFromSupabase(): Promise<UnmappedAreasResult> {
  try {
    const { data, error } = await adminSupabase
      .from("area_review_queue")
      .select("*")
      .eq("status", "pending")
      .order("last_seen_at", { ascending: false });

    if (error) {
      return { ok: false, status: "error", error: error.message };
    }

    return {
      ok: true,
      status: "success",
      reviews: ((data ?? []) as ReviewRow[]).map(mapReviewRow),
    };
  } catch (err) {
    return {
      ok: false,
      status: "error",
      error: err instanceof Error ? err.message : "Failed to load unmapped areas",
    };
  }
}

// ---------------------------------------------------------------------------
// Shared helper — mark a review as resolved
// Mirrors GAS markAreaReviewResolved_()
// ---------------------------------------------------------------------------

async function markReviewResolved(
  reviewId: string,
  resolvedCanonicalArea: string
): Promise<{ ok: boolean; error?: string }> {
  const nowIso = new Date().toISOString();

  const { data: existing } = await adminSupabase
    .from("area_review_queue")
    .select("review_id")
    .eq("review_id", reviewId)
    .maybeSingle();

  if (!existing) {
    return { ok: false, error: "Review item not found" };
  }

  const { error } = await adminSupabase
    .from("area_review_queue")
    .update({
      status: "resolved",
      resolved_at: nowIso,
      last_seen_at: nowIso,
      resolved_canonical_area: normalizeAreaName(resolvedCanonicalArea),
    })
    .eq("review_id", reviewId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// WRITE — admin_map_unmapped_area
// Maps rawArea as an alias to canonicalArea, then marks review resolved
// ---------------------------------------------------------------------------

export async function mapUnmappedAreaInSupabase(params: {
  reviewId: string;
  rawArea: string;
  canonicalArea: string;
}): Promise<UnmappedAreaMutateResult> {
  try {
    const reviewId = params.reviewId.trim();
    const rawArea = normalizeAreaName(params.rawArea);
    const canonicalArea = normalizeAreaName(params.canonicalArea);

    if (!reviewId || !rawArea || !canonicalArea) {
      return {
        ok: false,
        status: "error",
        error: "ReviewID, RawArea, and CanonicalArea required",
      };
    }

    const aliasResult = await addAreaAliasToSupabase({ aliasName: rawArea, canonicalArea });
    if (!aliasResult.ok) {
      return { ok: false, status: "error", error: aliasResult.error };
    }

    const resolveResult = await markReviewResolved(reviewId, aliasResult.alias.CanonicalArea);
    if (!resolveResult.ok) {
      return { ok: false, status: "error", error: resolveResult.error ?? "Failed to resolve review" };
    }

    return {
      ok: true,
      status: "success",
      reviewId,
      alias: aliasResult.alias,
    };
  } catch (err) {
    return {
      ok: false,
      status: "error",
      error: err instanceof Error ? err.message : "Failed to map unmapped area",
    };
  }
}

// ---------------------------------------------------------------------------
// WRITE — admin_create_area_from_unmapped
// Creates rawArea as a new canonical area (and optionally aliases it if
// canonicalArea differs from rawArea), then marks review resolved
// ---------------------------------------------------------------------------

export async function createAreaFromUnmappedInSupabase(params: {
  reviewId: string;
  rawArea: string;
  canonicalArea?: string;
}): Promise<UnmappedAreaMutateResult> {
  try {
    const reviewId = params.reviewId.trim();
    const rawArea = normalizeAreaName(params.rawArea);
    const canonicalArea = normalizeAreaName(params.canonicalArea || rawArea);

    if (!reviewId || !rawArea || !canonicalArea) {
      return { ok: false, status: "error", error: "ReviewID and RawArea required" };
    }

    const nowIso = new Date().toISOString();

    // Ensure canonical area exists (create or activate)
    const { error: upsertError } = await adminSupabase.from("areas").upsert(
      { area_name: canonicalArea, active: true, updated_at: nowIso },
      { onConflict: "area_name" }
    );
    if (upsertError) {
      return { ok: false, status: "error", error: upsertError.message };
    }

    // If rawArea differs from canonical, alias rawArea → canonical
    const rawKey = toAreaKey(rawArea);
    const canonicalKey = toAreaKey(canonicalArea);
    if (rawKey !== canonicalKey) {
      const aliasResult = await addAreaAliasToSupabase({ aliasName: rawArea, canonicalArea });
      if (!aliasResult.ok) {
        return { ok: false, status: "error", error: aliasResult.error };
      }
    }

    const resolveResult = await markReviewResolved(reviewId, canonicalArea);
    if (!resolveResult.ok) {
      return { ok: false, status: "error", error: resolveResult.error ?? "Failed to resolve review" };
    }

    return {
      ok: true,
      status: "success",
      reviewId,
      area: { AreaName: canonicalArea, Active: "yes" },
    };
  } catch (err) {
    return {
      ok: false,
      status: "error",
      error: err instanceof Error ? err.message : "Failed to create area from unmapped",
    };
  }
}

// ---------------------------------------------------------------------------
// WRITE — admin_resolve_unmapped_area
// Marks review as resolved without creating any area or alias
// ---------------------------------------------------------------------------

export async function resolveUnmappedAreaInSupabase(params: {
  reviewId: string;
  resolvedCanonicalArea: string;
}): Promise<UnmappedAreaMutateResult> {
  try {
    const reviewId = params.reviewId.trim();
    if (!reviewId) {
      return { ok: false, status: "error", error: "ReviewID required" };
    }

    const resolveResult = await markReviewResolved(reviewId, params.resolvedCanonicalArea || "");
    if (!resolveResult.ok) {
      return { ok: false, status: "error", error: resolveResult.error ?? "Failed to resolve review" };
    }

    return { ok: true, status: "success", reviewId };
  } catch (err) {
    return {
      ok: false,
      status: "error",
      error: err instanceof Error ? err.message : "Failed to resolve unmapped area",
    };
  }
}
