import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const body = await req.json();

    const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
    const taskTitle = typeof body?.taskTitle === "string" ? body.taskTitle.trim() : "";
    const taskDescription =
      typeof body?.taskDescription === "string" ? body.taskDescription.trim() : "";
    const location = typeof body?.location === "string" ? body.location.trim() : "";
    const budget = body?.budget;

    if (!phone || !taskTitle || !location) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    const SHEET_URL = process.env.APPS_SCRIPT_URL;

    if (!SHEET_URL) {
      return NextResponse.json(
        { success: false, error: "APPS_SCRIPT_URL not configured" },
        { status: 500 }
      );
    }

    const response = await fetch(SHEET_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "save_task",
        phone,
        taskTitle,
        taskDescription,
        location,
        budget: budget || "",
      }),
    });

    const result = await response.text();
    console.log("Google Sheet Response:", result);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Save task error:", err);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
