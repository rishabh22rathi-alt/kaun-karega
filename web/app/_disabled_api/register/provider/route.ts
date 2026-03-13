import { NextResponse } from "next/server";
import {
  phoneExistsInProviders,
  saveProviderRegistration,
} from "@/lib/googleSheets";
import { normalizePhone } from "@/lib/utils/phone";

export async function POST(req: Request) {
  try {
    const { name, phone, category, area } = await req.json();

    if (
      !name ||
      !phone ||
      typeof category !== "string" ||
      category.trim().length === 0 ||
      typeof area !== "string" ||
      area.trim().length === 0
    ) {
      return NextResponse.json(
        { ok: false, error: "All fields are required" },
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

    const alreadyProvider = await phoneExistsInProviders(normalizedPhone);
    if (alreadyProvider) {
      return NextResponse.json(
        { ok: true, status: "provider" },
        { status: 200 }
      );
    }

    await saveProviderRegistration({
      name: String(name).trim(),
      phone: normalizedPhone,
      category: category.trim(),
      area: area.trim(),
    });

    return NextResponse.json({ ok: true, status: "provider" });
  } catch (error) {
    console.error("provider registration error:", error);
    return NextResponse.json(
      { ok: false, error: "Unable to register provider" },
      { status: 500 }
    );
  }
}
