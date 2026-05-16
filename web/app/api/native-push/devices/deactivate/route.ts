import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { adminSupabase } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function validateFcmToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (token.length < 20 || token.length > 4096) return null;
  return token;
}

async function deactivate(request: Request) {
  let body: { fcmToken?: unknown };
  try {
    body = (await request.json()) as { fcmToken?: unknown };
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

  const now = new Date().toISOString();
  const { data, error } = await adminSupabase
    .from("native_push_devices")
    .update({
      active: false,
      revoked_at: now,
      updated_at: now,
    })
    .eq("fcm_token", fcmToken)
    .eq("phone", session.phone)
    .select("id");

  if (error) {
    console.error("[native-push/devices/deactivate] update failed", {
      code: error.code,
      message: error.message,
    });
    return NextResponse.json({ ok: false, error: "Failed to deactivate device" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    deactivatedCount: data?.length ?? 0,
  });
}

export async function POST(request: Request) {
  return deactivate(request);
}

export async function DELETE(request: Request) {
  return deactivate(request);
}
