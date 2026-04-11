import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";

type ProviderLookupResponse = {
  ok?: boolean;
  provider?: {
    ProviderName?: string;
    Name?: string;
  };
};

async function getReporterRoleAndName(baseUrl: string, phone: string) {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("action", "get_provider_by_phone");
    url.searchParams.set("phone", phone);

    const res = await fetch(url.toString(), {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json, text/plain, */*",
      },
    });

    if (!res.ok) {
      return { reporterRole: "user", reporterName: "" };
    }

    const data = (await res.json()) as ProviderLookupResponse;
    if (data?.ok && data.provider) {
      return {
        reporterRole: "provider",
        reporterName: String(data.provider.ProviderName || data.provider.Name || "").trim(),
      };
    }
  } catch {
    // Fall back to basic user role for MVP.
  }

  return { reporterRole: "user", reporterName: "" };
}

export async function POST(request: Request) {
  try {
    const session = getAuthSession({
      cookie: request.headers.get("cookie") ?? "",
    });

    if (!session?.phone) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const issueType = typeof body?.issueType === "string" ? body.issueType.trim() : "";
    const issuePage = typeof body?.issuePage === "string" ? body.issuePage.trim() : "";
    const description =
      typeof body?.description === "string" ? body.description.trim() : "";

    if (!issueType || !issuePage || description.length < 10) {
      return NextResponse.json(
        {
          ok: false,
          error: "Issue type, page, and a description of at least 10 characters are required.",
        },
        { status: 400 }
      );
    }

    const baseUrl = process.env.APPS_SCRIPT_URL;
    if (!baseUrl) {
      throw new Error("APPS_SCRIPT_URL is missing in environment variables");
    }

    const { reporterRole, reporterName } = await getReporterRoleAndName(baseUrl, session.phone);

    const upstream = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        action: "submit_issue_report",
        ReporterPhone: session.phone,
        ReporterRole: reporterRole,
        ReporterName: reporterName,
        IssueType: issueType,
        IssuePage: issuePage,
        Description: description,
      }),
    });

    const text = await upstream.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return NextResponse.json(
        { ok: false, error: "Apps Script returned non-JSON response." },
        { status: 500 }
      );
    }

    if (!upstream.ok || data?.ok !== true) {
      return NextResponse.json(
        {
          ok: false,
          error: String(data?.error || data?.message || "Failed to submit issue report"),
        },
        { status: upstream.ok ? 500 : upstream.status }
      );
    }

    return NextResponse.json({
      ok: true,
      issueId: String(data.issueId || "").trim(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
