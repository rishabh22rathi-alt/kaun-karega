import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { getProviderByPhoneFromSupabase } from "@/lib/admin/adminProviderReads";
import { submitIssueReportToSupabase } from "@/lib/admin/adminIssueReports";

async function getReporterRoleAndName(phone: string) {
  try {
    const result = await getProviderByPhoneFromSupabase(phone);
    if (result.ok) {
      return {
        reporterRole: "provider",
        reporterName: String(result.provider.ProviderName || result.provider.Name || "").trim(),
      };
    }
  } catch {
    // Fall back to basic user role for MVP.
  }

  return { reporterRole: "user", reporterName: "" };
}

export async function POST(request: Request) {
  try {
    const session = await getAuthSession({
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

    const { reporterRole, reporterName } = await getReporterRoleAndName(session.phone);

    const result = await submitIssueReportToSupabase({
      reporterPhone: session.phone,
      reporterRole,
      reporterName,
      issueType,
      issuePage,
      description,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    }

    return NextResponse.json({ ok: true, issueId: result.issueId });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
