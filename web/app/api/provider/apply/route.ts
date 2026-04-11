import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";

export const runtime = "nodejs";

function normalizeToTenDigits(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveAppsScriptUrl(): string {
  return (process.env.APPS_SCRIPT_URL || "").trim();
}

export async function POST(request: Request) {
  try {
    const session = getAuthSession({
      cookie: request.headers.get("cookie") ?? "",
    });
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized. Please verify OTP." },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => null);
    const fullName =
      typeof body?.fullName === "string" ? body.fullName.trim() : "";
    const phoneRaw = typeof body?.phone === "string" ? body.phone : "";
    const businessName =
      typeof body?.businessName === "string" ? body.businessName.trim() : "";
    const serviceCategories = normalizeStringArray(body?.serviceCategories);
    const serviceAreas = normalizeStringArray(body?.serviceAreas);
    const experienceYears =
      body?.experienceYears === undefined || body?.experienceYears === null
        ? ""
        : String(body.experienceYears).trim();
    const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
    const createdAt =
      typeof body?.createdAt === "string" && body.createdAt.trim()
        ? body.createdAt.trim()
        : new Date().toISOString();

    const phone = normalizeToTenDigits(phoneRaw);
    const sessionPhone = normalizeToTenDigits(session.phone);
    if (!sessionPhone) {
      return NextResponse.json(
        { error: "Unauthorized. Please verify OTP." },
        { status: 401 }
      );
    }
    if (!phone || phone !== sessionPhone) {
      return NextResponse.json(
        { error: "Phone mismatch." },
        { status: 403 }
      );
    }

    if (!fullName || !phone) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields" },
        { status: 400 }
      );
    }
    if (
      serviceCategories.length === 0 ||
      serviceCategories.length > 3
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Service categories must be 1-3 items",
        },
        { status: 400 }
      );
    }
    if (serviceAreas.length < 5 || serviceAreas.length > 10) {
      return NextResponse.json(
        { ok: false, error: "Service areas must be between 5 and 10" },
        { status: 400 }
      );
    }

    const scriptUrl = resolveAppsScriptUrl();
    if (!scriptUrl) {
      return NextResponse.json(
        { ok: false, error: "Missing Apps Script URL in environment" },
        { status: 500 }
      );
    }

    const payload = {
      action: "create_provider_application",
      fullName,
      phone,
      businessName,
      serviceCategories,
      serviceAreas,
      experienceYears,
      notes,
      createdAt,
      status: "pending",
      verified: "yes",
    };

    const response = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload),
    });
    const text = await response.text();

    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          error:
            parsed?.error ||
            `Apps Script error (${response.status}). create_provider_application may be missing.`,
          details: text,
        },
        { status: 502 }
      );
    }

    if (!parsed) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Apps Script returned non-JSON. create_provider_application may not be implemented yet.",
          details: text,
        },
        { status: 502 }
      );
    }

    if (parsed?.ok === false || parsed?.success === false) {
      return NextResponse.json(
        {
          ok: false,
          error:
            parsed?.error ||
            "create_provider_application failed in Apps Script",
          details: parsed,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, result: parsed });
  } catch (error: any) {
    console.error("[provider/apply] error", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to submit application" },
      { status: 500 }
    );
  }
}
