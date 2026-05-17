// Recipient paging helper for admin announcement broadcasts (Phase 7B/C).
//
// Reads only active rows from native_push_devices. Pagination is
// cursor-stable (ORDER BY id) so a broadcast that spans several worker
// ticks resumes correctly even if new devices register during the
// broadcast — newly added rows land at the tail and are picked up on
// the next paginated query.
//
// Returns minimal fields: fcm_token (for FCM call), phone (for log
// recipient column), provider_id (for log recipient column on
// provider-actor rows), actor_type (for defense-in-depth assertions).
// fcm_token_tail is NOT pre-computed here — the worker uses the
// existing tokenTail helper at log-write time.
//
// Phase 7C adds two audiences:
//   • provider_category — two-step: resolve provider_ids via
//     provider_services join, then page through their active
//     provider devices.
//   • providers_all     — single-audience path (actor_type='provider'),
//     same shape as the existing 'providers' reserved value.
//
// Worker still hard-blocks both new audiences in Phase 7C Steps 1-5;
// these helpers are wired but unused on the send path. They are
// already used by the preview surface.

import { adminSupabase } from "@/lib/supabase/admin";

export type AnnouncementAudience =
  | "all"
  | "users"
  | "providers"
  | "admins"
  | "provider_category"
  | "providers_all";

export type RecipientDevice = {
  fcmToken: string;
  phone: string;
  providerId: string | null;
  actorType: "user" | "provider" | "admin";
};

type RawDeviceRow = {
  fcm_token: unknown;
  phone: unknown;
  provider_id: unknown;
  actor_type: unknown;
};

function mapRow(row: RawDeviceRow): RecipientDevice | null {
  const fcmToken = String(row.fcm_token ?? "").trim();
  if (fcmToken.length < 20) return null;
  const actorType = String(row.actor_type ?? "");
  if (
    actorType !== "user" &&
    actorType !== "provider" &&
    actorType !== "admin"
  ) {
    return null;
  }
  const providerIdRaw =
    row.provider_id == null ? null : String(row.provider_id).trim();
  return {
    fcmToken,
    phone: String(row.phone ?? ""),
    providerId:
      providerIdRaw && providerIdRaw.length > 0 ? providerIdRaw : null,
    actorType,
  };
}

function audienceToActorTypes(
  audience: AnnouncementAudience
): ReadonlyArray<"user" | "provider" | "admin"> {
  switch (audience) {
    case "users":
      return ["user"];
    case "providers":
    case "providers_all":
    case "provider_category":
      return ["provider"];
    case "admins":
      return ["admin"];
    case "all":
    default:
      return ["user", "provider", "admin"];
  }
}

// Resolve the set of provider_ids that offer the given canonical
// category. Used by both countRecipients and listRecipientsPage when
// audience='provider_category'. Case-insensitive via .ilike, matching
// the matched-job push flow's normalization at process-task-
// notifications/route.ts:180-185.
async function getProviderIdsForCategory(
  targetCategory: string
): Promise<{ ok: true; providerIds: string[] } | { ok: false; error: string }> {
  const trimmed = targetCategory.trim();
  if (!trimmed) return { ok: true, providerIds: [] };
  const { data, error } = await adminSupabase
    .from("provider_services")
    .select("provider_id")
    .ilike("category", trimmed);
  if (error) {
    return { ok: false, error: error.message };
  }
  const ids = Array.from(
    new Set(
      (data ?? [])
        .map((row) =>
          String((row as { provider_id?: unknown }).provider_id ?? "").trim()
        )
        .filter((id) => id.length > 0)
    )
  );
  return { ok: true, providerIds: ids };
}

// Count active devices for an audience. Used by /preview-recipients and
// (when sending is unlocked) by the worker on its first tick to seed
// total_recipients.
//
// Phase 7C: targetCategory is required when audience='provider_category';
// ignored otherwise.
export async function countRecipients(
  audience: AnnouncementAudience,
  targetCategory?: string | null
): Promise<{ ok: true; total: number } | { ok: false; error: string }> {
  if (audience === "provider_category") {
    const cat = String(targetCategory ?? "").trim();
    if (!cat) {
      return {
        ok: false,
        error: "target_category required for audience='provider_category'",
      };
    }
    const resolved = await getProviderIdsForCategory(cat);
    if (!resolved.ok) return resolved;
    if (resolved.providerIds.length === 0) {
      return { ok: true, total: 0 };
    }
    const { count, error } = await adminSupabase
      .from("native_push_devices")
      .select("id", { count: "exact", head: true })
      .eq("active", true)
      .eq("actor_type", "provider")
      .in("provider_id", resolved.providerIds);
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true, total: Number(count ?? 0) };
  }

  const actorTypes = audienceToActorTypes(audience);
  let query = adminSupabase
    .from("native_push_devices")
    .select("id", { count: "exact", head: true })
    .eq("active", true);
  if (actorTypes.length === 1) {
    query = query.eq("actor_type", actorTypes[0]);
  } else {
    query = query.in("actor_type", actorTypes);
  }
  const { count, error } = await query;
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, total: Number(count ?? 0) };
}

// Page through active devices for an audience. ORDER BY id ASC gives
// a stable cursor; .range(offset, offset+limit-1) is inclusive on
// both ends in Supabase.
//
// Phase 7C: targetCategory is required when audience='provider_category';
// ignored otherwise. Worker still hard-blocks these new audiences in
// Steps 1-5; this helper is wired ahead of the unlock.
export async function listRecipientsPage(
  audience: AnnouncementAudience,
  offset: number,
  limit: number,
  targetCategory?: string | null
): Promise<
  | { ok: true; devices: RecipientDevice[] }
  | { ok: false; error: string }
> {
  if (limit <= 0) return { ok: true, devices: [] };

  if (audience === "provider_category") {
    const cat = String(targetCategory ?? "").trim();
    if (!cat) {
      return {
        ok: false,
        error: "target_category required for audience='provider_category'",
      };
    }
    const resolved = await getProviderIdsForCategory(cat);
    if (!resolved.ok) return resolved;
    if (resolved.providerIds.length === 0) {
      return { ok: true, devices: [] };
    }
    const { data, error } = await adminSupabase
      .from("native_push_devices")
      .select("fcm_token, phone, provider_id, actor_type")
      .eq("active", true)
      .eq("actor_type", "provider")
      .in("provider_id", resolved.providerIds)
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) {
      return { ok: false, error: error.message };
    }
    const devices = ((data ?? []) as RawDeviceRow[])
      .map(mapRow)
      .filter((row): row is RecipientDevice => row !== null);
    return { ok: true, devices };
  }

  const actorTypes = audienceToActorTypes(audience);
  let query = adminSupabase
    .from("native_push_devices")
    .select("fcm_token, phone, provider_id, actor_type")
    .eq("active", true)
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);

  if (actorTypes.length === 1) {
    query = query.eq("actor_type", actorTypes[0]);
  } else {
    query = query.in("actor_type", actorTypes);
  }

  const { data, error } = await query;
  if (error) {
    return { ok: false, error: error.message };
  }

  const devices = ((data ?? []) as RawDeviceRow[])
    .map(mapRow)
    .filter((row): row is RecipientDevice => row !== null);
  return { ok: true, devices };
}
