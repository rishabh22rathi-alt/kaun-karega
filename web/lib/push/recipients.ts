import { adminSupabase } from "@/lib/supabase/admin";

export type ActorType = "user" | "provider" | "admin";

export type ActiveDeviceRow = {
  fcmToken: string;
  phone: string;
  providerId: string | null;
  actorType: ActorType;
};

// Phones in native_push_devices are stored in the canonical "91XXXXXXXXXX"
// form (taken from the verified session at registration time — see
// web/app/api/native-push/devices/route.ts).
function canonicalizePhone(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length > 10) return `91${digits.slice(-10)}`;
  return "";
}

export function normalizeTargetPhone(value: unknown): string {
  return canonicalizePhone(value);
}

function mapRow(row: {
  fcm_token: unknown;
  phone: unknown;
  provider_id: unknown;
  actor_type: unknown;
}): ActiveDeviceRow | null {
  const fcmToken = String(row.fcm_token ?? "").trim();
  // The registration route already validates >=20 chars; re-check here so a
  // corrupted row can never become an FCM call argument.
  if (fcmToken.length < 20) return null;
  const actorType = String(row.actor_type ?? "");
  if (actorType !== "user" && actorType !== "provider" && actorType !== "admin") {
    return null;
  }
  const providerIdRaw = row.provider_id == null ? null : String(row.provider_id).trim();
  return {
    fcmToken,
    phone: String(row.phone ?? ""),
    providerId: providerIdRaw && providerIdRaw.length > 0 ? providerIdRaw : null,
    actorType,
  };
}

export async function getActiveTokensForPhone(
  phone: string
): Promise<ActiveDeviceRow[]> {
  const canonical = canonicalizePhone(phone);
  if (!canonical) return [];
  const { data, error } = await adminSupabase
    .from("native_push_devices")
    .select("fcm_token, phone, provider_id, actor_type")
    .eq("phone", canonical)
    .eq("active", true);
  if (error) {
    console.error("[push/recipients] phone lookup failed", {
      code: error.code,
      message: error.message,
    });
    return [];
  }
  return (data ?? [])
    .map(mapRow)
    .filter((row): row is ActiveDeviceRow => row !== null);
}

// Phase B Step 7: every active admin WEB device (across all admins). Used
// by the admin business-alert fan-out so a paid-plan / payment-failed /
// invoice-PDF-failed event nudges admins on their PWA. Strictly
// actor_type='admin' AND platform='web' AND active=true — native/provider/
// user tokens are never targeted. Never throws: a Supabase error is logged
// and surfaces as [], which makes the caller's soft-fail trivial (req 10:
// "no admin web token → do nothing safely").
export async function getActiveAdminWebTokens(): Promise<ActiveDeviceRow[]> {
  const { data, error } = await adminSupabase
    .from("native_push_devices")
    .select("fcm_token, phone, provider_id, actor_type")
    .eq("active", true)
    .eq("actor_type", "admin")
    .eq("platform", "web");

  if (error) {
    console.error("[push/recipients] admin web token lookup failed", {
      code: error.code,
      message: error.message,
    });
    return [];
  }

  return (data ?? [])
    .map(mapRow)
    .filter((row): row is ActiveDeviceRow => row !== null);
}

// Resolve active provider-actor tokens by provider_id. Used by the
// matched-job push fan-out (Phase 4B) so we never accidentally target
// user/admin actor tokens that happen to share a phone with a provider.
// Never throws — Supabase errors are logged and surface as an empty list,
// which makes the caller's soft-fail trivial.
export async function getActiveTokensForProviderIds(
  providerIds: string[]
): Promise<ActiveDeviceRow[]> {
  const cleaned = Array.from(
    new Set(
      providerIds
        .map((id) => String(id ?? "").trim())
        .filter((id) => id.length > 0)
    )
  );
  if (cleaned.length === 0) return [];

  const { data, error } = await adminSupabase
    .from("native_push_devices")
    .select("fcm_token, phone, provider_id, actor_type")
    .eq("active", true)
    .eq("actor_type", "provider")
    .in("provider_id", cleaned);

  if (error) {
    console.error("[push/recipients] provider_id lookup failed", {
      code: error.code,
      message: error.message,
    });
    return [];
  }

  return (data ?? [])
    .map(mapRow)
    .filter((row): row is ActiveDeviceRow => row !== null);
}
