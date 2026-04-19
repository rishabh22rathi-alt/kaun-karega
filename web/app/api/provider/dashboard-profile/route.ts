import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

  try {
    const supabase = await createClient();
    const { data: provider, error: providerError } = await supabase
      .from("providers")
      .select("*")
      .eq("phone", normalizedPhone)
      .maybeSingle();

    console.log("[provider/dashboard-profile] supabase provider response", {
      ok: !providerError,
      provider: provider
        ? {
            ProviderID: String(provider.provider_id || ""),
            Phone: String(provider.phone || ""),
          }
        : null,
      error: providerError?.message || null,
    });

    if (providerError) {
      return NextResponse.json(
        {
          ok: false,
          error: "PROVIDER_LOOKUP_REQUEST_FAILED",
          message: providerError.message || "Failed to load provider dashboard.",
        },
        { status: 500 }
      );
    }

    if (!provider) {
      return NextResponse.json(
        {
          ok: false,
          error: "PROVIDER_LOOKUP_FAILED",
          message: "Logged-in provider profile could not be found for this phone number.",
          debug: {
            normalizedPhone,
          },
        },
        { status: 404 }
      );
    }

    const matchedPhone = normalizePhone10(String(provider.phone || ""));
    if (matchedPhone !== normalizedPhone) {
      return NextResponse.json(
        {
          ok: false,
          error: "PROVIDER_PHONE_MISMATCH",
          message: "Provider lookup returned a mismatched phone number.",
          debug: {
            requestedPhone: normalizedPhone,
            matchedPhone,
            providerId: String(provider.provider_id || ""),
          },
        },
        { status: 409 }
      );
    }

    const { data: providerServices, error: servicesError } = await supabase
      .from("provider_services")
      .select("category")
      .eq("provider_id", provider.provider_id);

    if (servicesError) {
      return NextResponse.json(
        {
          ok: false,
          error: "PROVIDER_SERVICES_LOOKUP_FAILED",
          message: servicesError.message || "Failed to load provider services.",
        },
        { status: 500 }
      );
    }

    const { data: providerAreas, error: areasError } = await supabase
      .from("provider_areas")
      .select("area")
      .eq("provider_id", provider.provider_id);

    if (areasError) {
      return NextResponse.json(
        {
          ok: false,
          error: "PROVIDER_AREAS_LOOKUP_FAILED",
          message: areasError.message || "Failed to load provider areas.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      provider: {
        ProviderID: String(provider.provider_id || ""),
        ProviderName: String(provider.full_name || ""),
        Phone: String(provider.phone || ""),
        Verified: String(provider.verified || ""),
        OtpVerified: "yes",
        OtpVerifiedAt: String(provider.created_at || ""),
        LastLoginAt: String(provider.created_at || ""),
        PendingApproval: String(provider.status || "").trim().toLowerCase() === "pending" ? "yes" : "no",
        Status: String(provider.status || ""),
        Services: Array.isArray(providerServices)
          ? providerServices.map((item) => ({
              Category: String(item.category || ""),
            }))
          : [],
        Areas: Array.isArray(providerAreas)
          ? providerAreas.map((item) => ({
              Area: String(item.area || ""),
            }))
          : [],
        AreaCoverage: null,
        Analytics: null,
      },
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
