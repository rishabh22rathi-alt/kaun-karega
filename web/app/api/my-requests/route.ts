import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function normalizePhone10(value: string): string {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

export async function GET(request: Request) {
  try {
    const session = getAuthSession({
      cookie: request.headers.get("cookie") ?? "",
    });

    if (!session?.phone) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const normalizedPhone = normalizePhone10(session.phone);
    const supabase = await createClient();
    const { data: tasks, error } = await supabase
      .from("tasks")
      .select("task_id, display_id, category, area, details, status, created_at")
      .eq("phone", normalizedPhone)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message || "Failed to load requests" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      requests: Array.isArray(tasks)
        ? tasks.map((task) => ({
            TaskID: String(task.task_id || "").trim(),
            DisplayID:
              typeof task.display_id === "string" || typeof task.display_id === "number"
                ? String(task.display_id).trim()
                : "",
            Category: String(task.category || "").trim(),
            Area: String(task.area || "").trim(),
            Details: String(task.details || "").trim(),
            Status: String(task.status || "").trim(),
            CreatedAt: String(task.created_at || "").trim(),
            MatchedProviders: 0,
            MatchedProviderDetails: [],
            RespondedProvider: "",
            RespondedProviderName: "",
          }))
        : [],
    });
  } catch (error: any) {
    console.error("My requests error:", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
