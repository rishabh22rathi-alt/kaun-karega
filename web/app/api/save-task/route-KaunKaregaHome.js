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

    const SHEET_URL =
      "https://script.google.com/macros/s/AKfycby3WrvppRyQkfjE8hr8AL05IEqTwqB0Vylyup4QVXTO4N8knWLVZlTUDzQJqctpWGI/exec";

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
  } catch (error) {
    console.error("Save task error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
