// Recipient paging helper for admin announcement broadcasts (Phase 7B).
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

import { adminSupabase } from "@/lib/supabase/admin";

export type AnnouncementAudience = "all" | "users" | "providers" | "admins";

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
      return ["provider"];
    case "admins":
      return ["admin"];
    case "all":
    default:
      return ["user", "provider", "admin"];
  }
}

// Count active devices for an audience. Used by /preview-recipients and
// by the worker on its first tick to seed total_recipients.
export async function countRecipients(
  audience: AnnouncementAudience
): Promise<{ ok: true; total: number } | { ok: false; error: string }> {
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
export async function listRecipientsPage(
  audience: AnnouncementAudience,
  offset: number,
  limit: number
): Promise<
  | { ok: true; devices: RecipientDevice[] }
  | { ok: false; error: string }
> {
  if (limit <= 0) return { ok: true, devices: [] };
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
