import { NextRequest, NextResponse } from "next/server";
import {
  phoneExistsInReceivers,
  saveReceiverRegistration,
} from "@/lib/googleSheets";
import { normalizePhone } from "@/lib/utils/phone";

export async function POST(req: NextRequest) {
  try {
    const { name, phone, area } = await req.json();

    if (!name || !phone) {
      return NextResponse.json(
        { ok: false, error: "Name and phone are required" },
        { status: 400 }
      );
    }

    const normalizedPhone = normalizePhone(String(phone));
    if (!normalizedPhone) {
      return NextResponse.json(
        { ok: false, error: "Invalid phone number" },
        { status: 400 }
      );
    }

    const alreadyReceiver = await phoneExistsInReceivers(normalizedPhone);
    if (alreadyReceiver) {
      return NextResponse.json(
        { ok: true, status: "receiver" },
        { status: 200 }
      );
    }

    await saveReceiverRegistration({
      name: String(name).trim(),
      phone: normalizedPhone,
      area: typeof area === "string" ? area.trim() : "",
    });

    return NextResponse.json({ ok: true, status: "receiver" });
  } catch (error) {
    console.error("receiver registration error:", error);
    return NextResponse.json(
      { ok: false, error: "Unable to register receiver" },
      { status: 500 }
    );
  }
}
