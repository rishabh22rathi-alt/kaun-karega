import { NextResponse, type NextRequest } from "next/server";

import { getAuthSession } from "@/lib/auth";
import {
  getPreferences,
  isKnownEventType,
  setPreferences,
  type NotificationEventType,
  type PreferenceSnapshot,
} from "@/lib/notificationPreferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Phase 4A: user-only preferences route. Same shape as the provider
// route at /api/notification-preferences but actor is fixed to 'user'
// and the allow-list is the v1 user toggle set.
//
// Deliberately minimal: chat_message and need_post are NOT in the
// allow-list because no user-facing chat/need pushes are sent today.
// Surfacing those toggles before the pushes exist would create a
// settings → behavior mismatch. Add them here when those pushes ship.
const USER_ALLOWED_EVENTS = [
  "general",
  "task_update",
  "marketing",
] as const satisfies ReadonlyArray<NotificationEventType>;

type UserEventType = (typeof USER_ALLOWED_EVENTS)[number];

const USER_ALLOWED_SET: ReadonlySet<NotificationEventType> = new Set(
  USER_ALLOWED_EVENTS
);

type ResolvedUser =
  | { ok: true; phone: string }
  | { ok: false; status: 401; code: string; message: string };

// User is the universal logged-in actor. There is no "is this a user"
// check beyond a valid signed session — anyone with a session is a user
// for the purpose of notification preferences. The shared helper
// canonicalizes phone to "91XXXXXXXXXX" before storage so a session
// phone in any common form normalizes to the same actor_key.
async function resolveUser(request: NextRequest): Promise<ResolvedUser> {
  const cookieHeader = request.headers.get("cookie") || "";
  const session = await getAuthSession({
    cookie: cookieHeader,
    validateVersion: true,
  });
  if (!session?.phone) {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      message: "Session missing or expired. Please log in again.",
    };
  }
  return { ok: true, phone: session.phone };
}

// Convert the helper's full snapshot to the user-scoped response shape.
// 'general' is always forced true; other allowed keys default to enabled
// when absent. No internal fields (actor_key, actor_type) are exposed.
function buildUserResponse(
  snapshot: PreferenceSnapshot
): Record<UserEventType, boolean> {
  const out = {} as Record<UserEventType, boolean>;
  for (const eventType of USER_ALLOWED_EVENTS) {
    if (eventType === "general") {
      out[eventType] = true;
      continue;
    }
    out[eventType] =
      eventType in snapshot ? snapshot[eventType] !== false : true;
  }
  return out;
}

export async function GET(request: NextRequest) {
  const resolved = await resolveUser(request);
  if (!resolved.ok) {
    return NextResponse.json(
      { ok: false, error: resolved.code, message: resolved.message },
      { status: resolved.status }
    );
  }

  const { snapshot } = await getPreferences("user", resolved.phone);
  return NextResponse.json({
    ok: true,
    preferences: buildUserResponse(snapshot),
  });
}

type PutBody = { updates?: unknown };

type ValidatedUpdate = {
  eventType: UserEventType;
  enabled: boolean;
};

type ValidationError = { error: string };

function validateUpdates(raw: unknown): ValidatedUpdate[] | ValidationError {
  if (!Array.isArray(raw)) {
    return { error: "updates must be an array" };
  }
  if (raw.length === 0) {
    return { error: "updates must include at least one entry" };
  }
  if (raw.length > USER_ALLOWED_EVENTS.length) {
    return { error: "too many updates in one request" };
  }

  const seen = new Set<UserEventType>();
  const out: ValidatedUpdate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return { error: "update entries must be objects" };
    }
    const eventType = (item as { eventType?: unknown }).eventType;
    const enabled = (item as { enabled?: unknown }).enabled;

    if (typeof eventType !== "string" || !isKnownEventType(eventType)) {
      return { error: `unknown eventType: ${String(eventType)}` };
    }
    if (!USER_ALLOWED_SET.has(eventType)) {
      return { error: `eventType not allowed for users: ${eventType}` };
    }
    if (typeof enabled !== "boolean") {
      return { error: `enabled must be boolean for eventType ${eventType}` };
    }
    if (eventType === "general" && enabled === false) {
      return { error: "general notifications cannot be disabled" };
    }
    const typedEventType = eventType as UserEventType;
    if (seen.has(typedEventType)) {
      return { error: `duplicate eventType in updates: ${eventType}` };
    }
    seen.add(typedEventType);
    out.push({ eventType: typedEventType, enabled });
  }
  return out;
}

export async function PUT(request: NextRequest) {
  const resolved = await resolveUser(request);
  if (!resolved.ok) {
    return NextResponse.json(
      { ok: false, error: resolved.code, message: resolved.message },
      { status: resolved.status }
    );
  }

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "INVALID_JSON", message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const validated = validateUpdates(body.updates);
  if (!Array.isArray(validated)) {
    return NextResponse.json(
      { ok: false, error: "INVALID_UPDATE", message: validated.error },
      { status: 400 }
    );
  }

  const result = await setPreferences("user", resolved.phone, validated, {
    updatedBy: resolved.phone,
    updatedSource: "user_dashboard",
  });

  if (!result.ok) {
    // GENERAL_LOCKED / INVALID_EVENT / INVALID_ACTOR_KEY surface as 400;
    // DB_ERROR is the only 500. We never echo the underlying DB message
    // back to the client.
    const status =
      result.code === "GENERAL_LOCKED" ||
      result.code === "INVALID_EVENT" ||
      result.code === "INVALID_ACTOR_KEY"
        ? 400
        : 500;
    const message =
      status === 500
        ? "Could not save notification preferences."
        : result.error;
    return NextResponse.json(
      { ok: false, error: result.code, message },
      { status }
    );
  }

  return NextResponse.json({
    ok: true,
    preferences: buildUserResponse(result.snapshot),
  });
}
