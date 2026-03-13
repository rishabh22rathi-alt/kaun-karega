import { NextResponse } from "next/server";
import { appsScriptPost } from "@/lib/api/client";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const category = typeof body?.category === "string" ? body.category.trim() : "";
    const area = typeof body?.area === "string" ? body.area.trim() : "";
    const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
    const details = typeof body?.details === "string" ? body.details.trim() : "";
    const urgency = typeof body?.urgency === "string" ? body.urgency.trim() : "";

    if (!category || !area || !phone || !urgency) {
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
