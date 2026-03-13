import { NextResponse } from "next/server";

export async function POST(request: Request) {
  let payload: unknown = null;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  console.log("WhatsApp webhook payload", payload);

  return NextResponse.json({ status: "ok" });
}
