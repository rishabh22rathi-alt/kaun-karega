const APPS_SCRIPT_URL =
  process.env.APPS_SCRIPT_URL || process.env.NEXT_PUBLIC_APPS_SCRIPT_URL || "";

async function postToAppsScript(payload: Record<string, unknown>) {
  if (!APPS_SCRIPT_URL) {
    throw new Error("Apps Script URL is not configured");
  }

  const response = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(
      typeof data === "object" && data && "error" in data
        ? String((data as { error?: unknown }).error || "Apps Script request failed")
        : "Apps Script request failed"
    );
  }

  return data as {
    ok?: boolean;
    stats?: {
      totalProviders?: number;
      verifiedProviders?: number;
      pendingAdminApprovals?: number;
      pendingCategoryRequests?: number;
    };
    providers?: unknown[];
    categoryApplications?: unknown[];
    error?: string;
  };
}

export async function GET() {
  try {
    const data = await postToAppsScript({ action: "get_admin_dashboard_stats" });
    return Response.json(data);
  } catch (error) {
    console.error("Admin stats error:", error);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

export async function POST() {
  return GET();
}
