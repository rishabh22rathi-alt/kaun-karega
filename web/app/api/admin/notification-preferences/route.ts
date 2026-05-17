import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
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

// Phase 5A: admin self-preferences route. Same response shape as the
// provider and user routes so the generic NotificationPreferencesCard
// consumes all three without per-actor branches.
//
// Deliberately minimal: marketing, chat_message, task_update, and
// system are NOT in the allow-list because no admin push of those
// types is sent today. Surfacing those toggles before the pushes
// exist would create a settings → behavior mismatch. Add them here
// when those pushes ship.
const ADMIN_ALLOWED_EVENTS = [
  "general",
  "admin_alert",
  "new_category",
] as const satisfies ReadonlyArray<NotificationEventType>;

type AdminEventType = (typeof ADMIN_ALLOWED_EVENTS)[number];

const ADMIN_ALLOWED_SET: ReadonlySet<NotificationEventType> = new Set(
  ADMIN_ALLOWED_EVENTS
);

type ResolvedAdmin =
  | { ok: true; phone: string }
  | { ok: false; status: 401; code: string; message: string };

// requireAdminSession is the canonical admin gate — same helper used by
// /api/admin/notifications and every other /api/admin/* route. It bundles
// session-cookie verification, validateVersion (so a newer-device login
// kicks the old cookie), and a live admins-table lookup. Returns 401
// signal for both "no session" and "session is not an active admin".
async function resolveAdmin(request: Request): Promise<ResolvedAdmin> {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      message: "Admin session required.",
    };
  }
  return { ok: true, phone: String(auth.admin.phone || "").trim() };
}

// Convert the helper's full snapshot to the admin-scoped response shape.
// 'general' is always forced true; other allowed keys default to enabled
// when absent. No internal fields (actor_key, actor_type) are exposed.
function buildAdminResponse(
  snapshot: PreferenceSnapshot
): Record<AdminEventType, boolean> {
  const out = {} as Record<AdminEventType, boolean>;
  for (const eventType of ADMIN_ALLOWED_EVENTS) {
    if (eventType === "general") {
      out[eventType] = true;
      continue;
    }
    out[eventType] =
      eventType in snapshot ? snapshot[eventType] !== false : true;
  }
  return out;
}

export async function GET(request: Request) {
  const resolved = await resolveAdmin(request);
  if (!resolved.ok) {
    return NextResponse.json(
      { ok: false, error: resolved.code, message: resolved.message },
      { status: resolved.status }
    );
  }

  const { snapshot } = await getPreferences("admin", resolved.phone);
  return NextResponse.json({
    ok: true,
    preferences: buildAdminResponse(snapshot),
  });
}

type PutBody = { updates?: unknown };

type ValidatedUpdate = {
  eventType: AdminEventType;
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
  if (raw.length > ADMIN_ALLOWED_EVENTS.length) {
    return { error: "too many updates in one request" };
  }

  const seen = new Set<AdminEventType>();
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
    if (!ADMIN_ALLOWED_SET.has(eventType)) {
      return { error: `eventType not allowed for admins: ${eventType}` };
    }
    if (typeof enabled !== "boolean") {
      return { error: `enabled must be boolean for eventType ${eventType}` };
    }
    if (eventType === "general" && enabled === false) {
      return { error: "general notifications cannot be disabled" };
    }
    const typedEventType = eventType as AdminEventType;
    if (seen.has(typedEventType)) {
      return { error: `duplicate eventType in updates: ${eventType}` };
    }
    seen.add(typedEventType);
    out.push({ eventType: typedEventType, enabled });
  }
  return out;
}

export async function PUT(request: Request) {
  const resolved = await resolveAdmin(request);
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

  const result = await setPreferences("admin", resolved.phone, validated, {
    updatedBy: resolved.phone,
    updatedSource: "admin_dashboard",
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
    preferences: buildAdminResponse(result.snapshot),
  });
}
