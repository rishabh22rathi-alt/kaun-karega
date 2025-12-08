import { NextRequest, NextResponse } from "next/server";
import {
  phoneExistsInProviders,
  phoneExistsInReceivers,
} from "@/lib/googleSheets";
import { normalizePhone } from "@/lib/utils/phone";

export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get("phone") || "";
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone) {
    return NextResponse.json(
      { error: "Invalid phone number" },
      { status: 400 }
    );
  }

  try {
    const [isProvider, isReceiver] = await Promise.all([
      phoneExistsInProviders(normalizedPhone),
      phoneExistsInReceivers(normalizedPhone),
    ]);

    if (isProvider) {
      return NextResponse.json({ status: "provider" });
    }

    if (isReceiver) {
      return NextResponse.json({ status: "receiver" });
    }

    return NextResponse.json({ status: "new" });
  } catch (error) {
    console.error("check-user-status error:", error);
    return NextResponse.json(
      { error: "Failed to check user status" },
      { status: 500 }
    );
  }
}
