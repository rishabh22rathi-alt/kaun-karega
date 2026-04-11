import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

function normalizePhone10(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  const phone10 = digits.length > 10 ? digits.slice(-10) : digits;
  return phone10.length === 10 ? phone10 : "";
}

function maskPhone(phone10: string): string {
  if (!phone10) return "-";
  return `******${phone10.slice(-4)}`;
}

export async function GET(request: NextRequest) {
  const cookieHeader = request.headers.get("cookie") || "";
  const cookieNames = request.cookies.getAll().map((cookie) => cookie.name);
  const session = getAuthSession({ cookie: cookieHeader });
  const rawSessionPhone = String(session?.phone || "");
  const normalizedPhone = normalizePhone10(rawSessionPhone);

  console.log("[provider/dashboard-profile] auth debug", {
    cookieNames,
    session: session
      ? {
          phoneMasked: maskPhone(normalizedPhone),
          verified: session.verified,
          createdAt: session.createdAt,
        }
      : null,
    rawSessionPhone,
    normalizedPhone,
  });

  if (!session || !normalizedPhone) {
    return NextResponse.json(
      {
        ok: false,
        error: "UNAUTHORIZED_PROVIDER_SESSION",
        message: "Provider session missing or invalid. Please log in again.",
      },
      { status: 401 }
    );
  }

  if (!APPS_SCRIPT_URL) {
    return NextResponse.json(
      {
        ok: false,
        error: "APPS_SCRIPT_URL_MISSING",
        message: "Provider dashboard backend is not configured.",
      },
      { status: 500 }
    );
  }

  const upstreamUrl = new URL(APPS_SCRIPT_URL);
  upstreamUrl.searchParams.set("action", "get_provider_by_phone");
  upstreamUrl.searchParams.set("phone", normalizedPhone);

  console.log("[provider/dashboard-profile] upstream request", {
    action: "get_provider_by_phone",
    payload: {
      phone: normalizedPhone,
    },
  });

  try {
    const upstream = await fetch(upstreamUrl.toString(), {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json, text/plain, */*",
      },
    });

    const text = await upstream.text();
    let data: any = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_PROVIDER_RESPONSE",
          message: "Provider backend returned invalid JSON.",
        },
        { status: 502 }
      );
    }

    console.log("[provider/dashboard-profile] upstream response", {
      ok: upstream.ok,
      status: upstream.status,
      provider:
        data?.provider && typeof data.provider === "object"
          ? {
              ProviderID: String(data.provider.ProviderID || ""),
              Phone: String(data.provider.Phone || ""),
            }
          : null,
      error: data?.error || null,
    });

    if (!upstream.ok || data?.ok !== true || !data?.provider) {
      return NextResponse.json(
        {
          ok: false,
          error: data?.error || "PROVIDER_LOOKUP_FAILED",
          message: "Logged-in provider profile could not be found for this phone number.",
          debug: {
            normalizedPhone,
          },
        },
        { status: 404 }
      );
    }

    const matchedPhone = normalizePhone10(String(data.provider.Phone || ""));
    if (matchedPhone !== normalizedPhone) {
      return NextResponse.json(
        {
          ok: false,
          error: "PROVIDER_PHONE_MISMATCH",
          message: "Provider lookup returned a mismatched phone number.",
          debug: {
            requestedPhone: normalizedPhone,
            matchedPhone,
            providerId: String(data.provider.ProviderID || ""),
          },
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      ok: true,
      provider: data.provider,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "PROVIDER_LOOKUP_REQUEST_FAILED",
        message: error?.message || "Failed to load provider dashboard.",
      },
      { status: 500 }
    );
  }
}
