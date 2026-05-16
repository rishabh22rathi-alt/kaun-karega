import { NextResponse } from "next/server";
import { checkAdminByPhone } from "@/lib/adminAuth";
import { getAuthSession } from "@/lib/auth";
import { adminSupabase } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type ActorType = "user" | "provider" | "admin";

type DeviceRegistrationBody = {
  fcmToken?: unknown;
  platform?: unknown;
  appVersion?: unknown;
  deviceModel?: unknown;
  androidSdk?: unknown;
};

function normalizePhone10(value: unknown): string {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

function trimOptionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeAndroidSdk(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 1 || value > 10_000) return null;
  return value;
}

function validateFcmToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (token.length < 20 || token.length > 4096) return null;
  return token;
}

async function resolveActor(sessionPhone: string): Promise<{
  actorType: ActorType;
  providerId: string | null;
}> {
  const adminResult = await checkAdminByPhone(sessionPhone);
  if (adminResult.ok) {
    return { actorType: "admin", providerId: null };
  }

  const phone10 = normalizePhone10(sessionPhone);
  if (phone10.length !== 10) {
    return { actorType: "user", providerId: null };
  }

  const { data, error } = await adminSupabase
    .from("providers")
    .select("provider_id, phone")
    .or(`phone.eq.${phone10},phone.eq.91${phone10}`)
    .limit(5);

  if (error) {
    throw new Error(error.message || "Provider lookup failed");
  }

  const provider = (data || []).find(
    (row) =>
      typeof row.provider_id === "string" &&
      row.provider_id.trim().length > 0 &&
      normalizePhone10(row.phone) === phone10
  );

  if (!provider) {
    return { actorType: "user", providerId: null };
  }

  return {
    actorType: "provider",
    providerId: String(provider.provider_id || "").trim(),
  };
}

export async function POST(request: Request) {
  let body: DeviceRegistrationBody;
  try {
    body = (await request.json()) as DeviceRegistrationBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const fcmToken = validateFcmToken(body.fcmToken);
  if (!fcmToken) {
    return NextResponse.json({ ok: false, error: "Invalid FCM token" }, { status: 400 });
  }

  const session = await getAuthSession({
    cookie: request.headers.get("cookie") ?? "",
    validateVersion: true,
  });
  if (!session?.phone) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let actor: Awaited<ReturnType<typeof resolveActor>>;
  try {
    actor = await resolveActor(session.phone);
  } catch (error) {
    console.error("[native-push/devices] identity resolution failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ ok: false, error: "Identity resolution failed" }, { status: 500 });
  }

  const now = new Date().toISOString();
  const platform = body.platform === "android" ? "android" : "android";
  const appVersion = trimOptionalString(body.appVersion, 80);
  const deviceModel = trimOptionalString(body.deviceModel, 120);
  const androidSdk = normalizeAndroidSdk(body.androidSdk);

  const { error } = await adminSupabase.from("native_push_devices").upsert(
    {
      fcm_token: fcmToken,
      phone: session.phone,
      actor_type: actor.actorType,
      provider_id: actor.providerId,
      platform,
      app_version: appVersion,
      device_model: deviceModel,
      android_sdk: androidSdk,
      active: true,
      revoked_at: null,
      last_seen_at: now,
      updated_at: now,
    },
    { onConflict: "fcm_token" }
  );

  if (error) {
    console.error("[native-push/devices] upsert failed", {
      code: error.code,
      message: error.message,
    });
    return NextResponse.json({ ok: false, error: "Failed to register device" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    device: {
      actorType: actor.actorType,
      providerId: actor.providerId,
      platform,
      active: true,
    },
  });
}
