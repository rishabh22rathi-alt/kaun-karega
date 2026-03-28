import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";

function getAppsScriptUrl() {
  const scriptUrlRaw =
    process.env.APPS_SCRIPT_URL || process.env.NEXT_PUBLIC_APPS_SCRIPT_URL || "";
  return scriptUrlRaw.trim().replace(/\/$/, "");
}

export async function POST(request: Request) {
  const routeStartMs = Date.now();

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const taskId =
      typeof body?.taskId === "string" ? body.taskId.trim() : "";

    if (!taskId) {
      return NextResponse.json({ ok: false, error: "TaskID required" }, { status: 400 });
    }

    const session = getAuthSession({
      cookie: request.headers.get("cookie") ?? "",
    });
    if (!session) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const scriptUrl = getAppsScriptUrl();
    if (!scriptUrl) {
      throw new Error("Apps Script URL is not configured.");
    }

    const upstream = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        action: "process_task_notifications",
        taskId,
        userPhone: session.phone,
      }),
      cache: "no-store",
    });
    const upstreamDoneMs = Date.now();

    const text = await upstream.text();
    const textDoneMs = Date.now();

    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error("Apps Script returned non-JSON response.");
    }

    console.log("process-task-notifications route timing", {
      taskId,
      upstreamStatus: upstream.status,
      appsScriptFetchElapsedMs: upstreamDoneMs - routeStartMs,
      responseReadElapsedMs: textDoneMs - upstreamDoneMs,
      totalElapsedMs: textDoneMs - routeStartMs,
      skipped: Boolean(data?.skipped),
    });

    return NextResponse.json(
      {
        ok: upstream.ok && data?.ok !== false,
        taskId,
        displayId:
          typeof data?.displayId === "string" || typeof data?.displayId === "number"
            ? String(data.displayId).trim()
            : "",
        skipped: Boolean(data?.skipped),
        message: typeof data?.message === "string" ? data.message : "",
        matchedProviders:
          typeof data?.matchedProviders === "number" ? data.matchedProviders : undefined,
        attemptedSends:
          typeof data?.attemptedSends === "number" ? data.attemptedSends : undefined,
        failedSends:
          typeof data?.failedSends === "number" ? data.failedSends : undefined,
      },
      { status: upstream.ok ? 200 : 502 }
    );
  } catch (error) {
    console.error("process-task-notifications route failed", {
      totalElapsedMs: Date.now() - routeStartMs,
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Internal Server Error",
      },
      { status: 500 }
    );
  }
}
