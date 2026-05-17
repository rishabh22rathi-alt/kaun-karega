import { NextResponse, type NextRequest } from "next/server";

import { getAuthSession } from "@/lib/auth";
import { getProviderByPhoneFromSupabase } from "@/lib/admin/adminProviderReads";
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

// Phase 3: provider-only preferences route. The shared catalogue in
// lib/notificationPreferences.ts is broader (it covers future user + admin
// surfaces too); this route narrows the per-actor scope to exactly the
// four toggles approved for provider rollout in this phase. To expand
// later, add the new event_type here AND ensure the shared catalogue
// lists "provider" in that event's `actors`.
const PROVIDER_ALLOWED_EVENTS = [
  "general",
  "job_match",
  "chat_message",
  "new_category",
] as const satisfies ReadonlyArray<NotificationEventType>;

type ProviderEventType = (typeof PROVIDER_ALLOWED_EVENTS)[number];

const PROVIDER_ALLOWED_SET: ReadonlySet<NotificationEventType> = new Set(
  PROVIDER_ALLOWED_EVENTS
);

type ResolvedProvider =
  | { ok: true; providerId: string; phone: string }
  | { ok: false; status: 401 | 404; code: string; message: string };

// Single source of truth for provider identity in this route. Same flow as
// /api/provider/dashboard-profile: signed kk_auth_session cookie → phone →
// providers row lookup. Never trusts a body-supplied provider_id.
async function resolveProvider(request: NextRequest): Promise<ResolvedProvider> {
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
      message: "Provider session missing. Please log in again.",
    };
  }
  const lookup = await getProviderByPhoneFromSupabase(session.phone);
  if (!lookup.ok || !lookup.provider.ProviderID) {
    return {
      ok: false,
      status: 404,
      code: "PROVIDER_NOT_FOUND",
      message: "No provider record is linked to this phone.",
    };
  }
  return {
    ok: true,
    providerId: String(lookup.provider.ProviderID).trim(),
    phone: session.phone,
  };
}

// Convert the helper's full snapshot to the provider-scoped response shape.
// 'general' is always forced true; other allowed keys default to enabled
// when absent. No internal fields (actor_key, actor_type) are exposed.
function buildProviderResponse(
  snapshot: PreferenceSnapshot
): Record<ProviderEventType, boolean> {
  const out = {} as Record<ProviderEventType, boolean>;
  for (const eventType of PROVIDER_ALLOWED_EVENTS) {
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
  const resolved = await resolveProvider(request);
  if (!resolved.ok) {
    return NextResponse.json(
      { ok: false, error: resolved.code, message: resolved.message },
      { status: resolved.status }
    );
  }

  const { snapshot } = await getPreferences("provider", resolved.providerId);
  return NextResponse.json({
    ok: true,
    preferences: buildProviderResponse(snapshot),
  });
}

type PutBody = { updates?: unknown };

type ValidatedUpdate = {
  eventType: ProviderEventType;
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
  if (raw.length > PROVIDER_ALLOWED_EVENTS.length) {
    return { error: "too many updates in one request" };
  }

  const seen = new Set<ProviderEventType>();
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
    if (!PROVIDER_ALLOWED_SET.has(eventType)) {
      return { error: `eventType not allowed for providers: ${eventType}` };
    }
    if (typeof enabled !== "boolean") {
      return { error: `enabled must be boolean for eventType ${eventType}` };
    }
    if (eventType === "general" && enabled === false) {
      return { error: "general notifications cannot be disabled" };
    }
    const typedEventType = eventType as ProviderEventType;
    if (seen.has(typedEventType)) {
      return { error: `duplicate eventType in updates: ${eventType}` };
    }
    seen.add(typedEventType);
    out.push({ eventType: typedEventType, enabled });
  }
  return out;
}

export async function PUT(request: NextRequest) {
  const resolved = await resolveProvider(request);
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

  const result = await setPreferences(
    "provider",
    resolved.providerId,
    validated,
    {
      updatedBy: resolved.phone,
      updatedSource: "provider_dashboard",
    }
  );

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
    preferences: buildProviderResponse(result.snapshot),
  });
}
