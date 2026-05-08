import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthSession } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Provider response endpoint.
 *
 * Auth model (A4 fix):
 *   - Caller MUST present a valid signed `kk_auth_session` cookie. The
 *     session phone is the only trusted identity signal.
 *   - The provider id used for every mutation is resolved from the session
 *     phone via the `providers` table — `body.providerId` / `?providerId`
 *     is accepted for backward compatibility of the payload shape but is
 *     ONLY cross-checked against the session-resolved id. A mismatch
 *     returns 403; the body value is never used to widen access.
 *   - The provider must already be matched to the task in
 *     `provider_task_matches` — i.e. the matching pipeline put them there.
 *     A registered provider who was not matched to this task cannot
 *     "respond" to it.
 *
 * GET is kept for backward compatibility with legacy WhatsApp deep-links
 * that may have used a GET URL. State mutation still happens, but the
 * exact same session + ownership checks gate it. New callers should use
 * POST.
 */

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key);
}

function normalizePhone10(value: unknown): string {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

type ProviderAuth =
  | { ok: true; providerId: string; sessionPhone: string }
  | { ok: false; status: 401 | 403 | 500; message: string };

/**
 * Resolve the calling provider strictly from the verified session cookie.
 * Returns 401 when no signed session, 403 when the session phone does not
 * map to a registered provider, 500 on transient lookup failure.
 */
async function resolveProviderFromSession(req: Request): Promise<ProviderAuth> {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const session = await getAuthSession({ cookie: cookieHeader });
  const sessionPhone = normalizePhone10(session?.phone);
  if (!session || sessionPhone.length !== 10) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }

  const supabase = getServiceClient();
  const { data: providerRows, error } = await supabase
    .from("providers")
    .select("provider_id, phone")
    .or(`phone.eq.${sessionPhone},phone.eq.91${sessionPhone}`)
    .limit(5);

  if (error) {
    return {
      ok: false,
      status: 500,
      message: error.message || "Provider lookup failed",
    };
  }

  const provider = (providerRows || []).find(
    (row) => normalizePhone10(row.phone) === sessionPhone
  );
  const providerId = String(provider?.provider_id || "").trim();
  if (!provider || !providerId) {
    return {
      ok: false,
      status: 403,
      message: "Logged-in account is not a registered provider",
    };
  }

  return { ok: true, providerId, sessionPhone };
}

async function handleRespond(
  req: Request,
  taskId: string,
  claimedProviderId: string
) {
  if (!taskId) {
    return NextResponse.json(
      { success: false, message: "Missing taskId" },
      { status: 400 }
    );
  }

  // Step 1: bind caller to a real provider via the signed session cookie.
  const auth = await resolveProviderFromSession(req);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, message: auth.message },
      { status: auth.status }
    );
  }
  const providerId = auth.providerId;

  // Step 2: cross-check the body/query providerId against the session.
  // The session-resolved id is authoritative; the body value is treated as
  // a UI hint and only validated, never trusted to widen access.
  if (claimedProviderId && claimedProviderId !== providerId) {
    return NextResponse.json(
      {
        success: false,
        message: "providerId does not match logged-in provider",
      },
      { status: 403 }
    );
  }

  const supabase = getServiceClient();

  // Step 3: confirm the task exists (and load fields for the upsert).
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("task_id, category, area")
    .eq("task_id", taskId)
    .single();

  if (taskError || !task) {
    return NextResponse.json(
      { success: false, message: "Task not found" },
      { status: 404 }
    );
  }

  // Step 4: confirm the matching pipeline already paired this provider with
  // this task. Without an existing match row, any registered provider could
  // forge a "responded" entry against any task by guessing taskId.
  const { data: matchRow, error: matchError } = await supabase
    .from("provider_task_matches")
    .select("task_id, provider_id")
    .eq("task_id", taskId)
    .eq("provider_id", providerId)
    .maybeSingle();

  if (matchError) {
    return NextResponse.json(
      { success: false, message: matchError.message || "Failed to look up match" },
      { status: 500 }
    );
  }
  if (!matchRow) {
    return NextResponse.json(
      { success: false, message: "Provider is not matched to this task" },
      { status: 403 }
    );
  }

  // Step 5: upsert the response on the existing match row.
  const { error: upsertError } = await supabase
    .from("provider_task_matches")
    .upsert(
      {
        task_id: taskId,
        provider_id: providerId,
        category: task.category,
        area: task.area,
        match_status: "responded",
        notified: true,
      },
      { onConflict: "task_id,provider_id" }
    );

  if (upsertError) {
    return NextResponse.json(
      { success: false, message: upsertError.message || "Failed to record response" },
      { status: 500 }
    );
  }

  // Step 6: advance task status.
  const { error: updateError } = await supabase
    .from("tasks")
    .update({ status: "provider_responded" })
    .eq("task_id", taskId);

  if (updateError) {
    return NextResponse.json(
      { success: false, message: updateError.message || "Failed to update task status" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}

export async function GET(req: Request) {
  // Kept for backward compatibility with legacy WhatsApp deep-links. New
  // callers should use POST. Goes through the same session + ownership
  // gate as POST — anonymous GETs are rejected with 401.
  try {
    const search = new URL(req.url).searchParams;
    const taskId = (search.get("taskId") || "").trim();
    const providerId = (search.get("providerId") || "").trim();
    return await handleRespond(req, taskId, providerId);
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const taskId = (typeof body?.taskId === "string" ? body.taskId : "").trim();
    const providerId = (typeof body?.providerId === "string" ? body.providerId : "").trim();
    return await handleRespond(req, taskId, providerId);
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err instanceof Error ? err.message : "Invalid request body" },
      { status: 500 }
    );
  }
}
