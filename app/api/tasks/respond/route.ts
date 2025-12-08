import { NextResponse } from "next/server";
import { buildAppsScriptUrl } from "@/lib/api/client";

async function forwardProviderResponse(taskId: string, providerId: string) {
  const url = buildAppsScriptUrl("tasks/providerRespond", {
    taskId,
    providerId,
  });
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Provider response failed (${res.status}): ${text}`);
  }
  return true;
}

export async function GET(req: Request) {
  const search = new URL(req.url).searchParams;
  const taskId = search.get("taskId") || "";
  const providerId = search.get("providerId") || "";

  if (!taskId || !providerId) {
    return NextResponse.json(
      { success: false, message: "taskId and providerId are required" },
      { status: 400 }
    );
  }

  try {
    await forwardProviderResponse(taskId, providerId);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json(
      { success: false, message },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const { taskId, providerId } = await req.json();
    if (!taskId || !providerId) {
      return NextResponse.json(
        { success: false, message: "taskId and providerId are required" },
        { status: 400 }
      );
    }

    await forwardProviderResponse(taskId, providerId);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json(
      { success: false, message },
      { status: 500 }
    );
  }
}
