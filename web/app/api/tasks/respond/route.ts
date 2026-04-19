import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key);
}

async function handleRespond(taskId: string, providerId: string) {
  if (!taskId || !providerId) {
    return NextResponse.json(
      { success: false, message: "Missing taskId or providerId" },
      { status: 400 }
    );
  }

  const supabase = getServiceClient();

  // Confirm task exists
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

  // Confirm provider exists
  const { data: provider, error: providerError } = await supabase
    .from("providers")
    .select("provider_id")
    .eq("provider_id", providerId)
    .single();

  if (providerError || !provider) {
    return NextResponse.json(
      { success: false, message: "Provider not found" },
      { status: 404 }
    );
  }

  // Upsert provider_task_matches
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

  // Update task status
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
  try {
    const search = new URL(req.url).searchParams;
    const taskId = (search.get("taskId") || "").trim();
    const providerId = (search.get("providerId") || "").trim();
    return await handleRespond(taskId, providerId);
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
    return await handleRespond(taskId, providerId);
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err instanceof Error ? err.message : "Invalid request body" },
      { status: 500 }
    );
  }
}
