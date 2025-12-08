import { NextRequest, NextResponse } from "next/server";
import { appsScriptPost } from "@/lib/api/client";

export async function POST(req: NextRequest) {
  try {
    const { category, area, phone, details, urgency } = await req.json();

    if (!category || !area || !phone || !details || !urgency) {
      return NextResponse.json(
        { success: false, message: "Missing required fields" },
        { status: 400 }
      );
    }

    const taskId = crypto.randomUUID();

    const result = await appsScriptPost<{ success?: boolean; error?: string }>(
      "tasks/distribute",
      {
        taskId,
        category,
        area,
        phone,
        details,
        urgency,
        createdAt: new Date().toISOString(),
      },
      { admin: true }
    );

    if (!result?.success) {
      throw new Error(result?.error || "Task could not be distributed");
    }

    return NextResponse.json({ success: true, taskId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json(
      { success: false, message },
      { status: 500 }
    );
  }
}
