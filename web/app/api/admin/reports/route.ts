import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/admin/reports?type=...&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Unified admin report endpoint. Powers the Reports tab + the PDF
// export in /admin/dashboard. Read-only — no mutations.
//
// Supported `type`:
//   kaam_demand              — category/area/region demand
//   provider_leads           — per-provider leads / responses
//   system_health            — current operational issues snapshot
//   monthly_business_summary — management overview
//
// All categories / areas / regions / providers in the response come
// from real Supabase rows. Nothing is hardcoded.

type ReportType =
  | "kaam_demand"
  | "provider_leads"
  | "system_health"
  | "monthly_business_summary";

type SummaryEntry = { label: string; value: string | number };

type ReportSection = {
  title: string;
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
};

type ReportPayload = {
  success: true;
  type: ReportType;
  title: string;
  from: string;
  to: string;
  generatedAt: string;
  summary: SummaryEntry[];
  sections: ReportSection[];
  notes: string[];
};

function isReportType(value: string | null): value is ReportType {
  return (
    value === "kaam_demand" ||
    value === "provider_leads" ||
    value === "system_health" ||
    value === "monthly_business_summary"
  );
}

function parseDateOnly(value: string | null): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function isoStartOfDay(date: string): string {
  return `${date}T00:00:00.000Z`;
}

function isoEndOfDay(date: string): string {
  return `${date}T23:59:59.999Z`;
}

function strOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function normalizeAreaKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function defaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const firstOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(
      2,
      "0"
    )}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return { from: fmt(firstOfMonth), to: fmt(now) };
}

// ─── KAAM DEMAND ────────────────────────────────────────────────────
async function buildKaamDemand(
  fromIso: string,
  toIso: string
): Promise<{ summary: SummaryEntry[]; sections: ReportSection[]; notes: string[] }> {
  const [tasksRes, regionAreasRes, regionAliasesRes, regionsRes, pcrRes] =
    await Promise.all([
      adminSupabase
        .from("tasks")
        .select("category, area, status")
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .limit(50000),
      adminSupabase
        .from("service_region_areas")
        .select("canonical_area, region_code, active")
        .eq("active", true),
      adminSupabase
        .from("service_region_area_aliases")
        .select("alias, canonical_area, region_code, active")
        .eq("active", true),
      adminSupabase
        .from("service_regions")
        .select("region_code, region_name, active")
        .eq("active", true),
      adminSupabase
        .from("pending_category_requests")
        .select("id, requested_category")
        .gte("created_at", fromIso)
        .lte("created_at", toIso),
    ]);

  const regionNameByCode = new Map<string, string>();
  for (const row of (regionsRes.data ?? []) as Array<{
    region_code: string | null;
    region_name: string | null;
  }>) {
    const code = String(row.region_code ?? "").trim();
    const name = strOrNull(row.region_name);
    if (code && name) regionNameByCode.set(code, name);
  }
  const areaResolver = new Map<
    string,
    { canonicalArea: string; region: string }
  >();
  for (const row of (regionAreasRes.data ?? []) as Array<{
    canonical_area: string | null;
    region_code: string | null;
  }>) {
    const canonical = strOrNull(row.canonical_area);
    if (!canonical) continue;
    const code = String(row.region_code ?? "").trim();
    areaResolver.set(normalizeAreaKey(canonical), {
      canonicalArea: canonical,
      region: code ? regionNameByCode.get(code) ?? "Unmapped" : "Unmapped",
    });
  }
  for (const row of (regionAliasesRes.data ?? []) as Array<{
    alias: string | null;
    canonical_area: string | null;
    region_code: string | null;
  }>) {
    const alias = strOrNull(row.alias);
    const canonical = strOrNull(row.canonical_area);
    if (!alias || !canonical) continue;
    const code = String(row.region_code ?? "").trim();
    areaResolver.set(normalizeAreaKey(alias), {
      canonicalArea: canonical,
      region: code ? regionNameByCode.get(code) ?? "Unmapped" : "Unmapped",
    });
  }

  const tasks = (tasksRes.data ?? []) as Array<{
    category: string | null;
    area: string | null;
    status: string | null;
  }>;

  let totalKaam = 0;
  let noProviderMatchedCount = 0;
  const categoryCounts = new Map<string, number>();
  const areaCounts = new Map<
    string,
    { area: string; region: string; count: number }
  >();
  const regionCounts = new Map<string, number>();
  for (const task of tasks) {
    totalKaam += 1;
    if ((task.status ?? "").trim().toLowerCase() === "no_providers_matched") {
      noProviderMatchedCount += 1;
    }
    const cat = strOrNull(task.category);
    if (cat) categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
    const rawArea = strOrNull(task.area);
    if (rawArea) {
      const resolved = areaResolver.get(normalizeAreaKey(rawArea)) ?? {
        canonicalArea: rawArea,
        region: "Unmapped",
      };
      const k = normalizeAreaKey(resolved.canonicalArea);
      const existing = areaCounts.get(k);
      if (existing) existing.count += 1;
      else
        areaCounts.set(k, {
          area: resolved.canonicalArea,
          region: resolved.region,
          count: 1,
        });
      regionCounts.set(
        resolved.region,
        (regionCounts.get(resolved.region) ?? 0) + 1
      );
    }
  }

  const categoryRows = Array.from(categoryCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({
      category,
      count,
      share:
        totalKaam > 0 ? `${Math.round((count / totalKaam) * 1000) / 10}%` : "—",
    }));
  const areaRows = Array.from(areaCounts.values())
    .sort((a, b) => b.count - a.count)
    .map((row) => ({ area: row.area, region: row.region, count: row.count }));
  const regionRows = Array.from(regionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([region, count]) => ({ region, count }));

  const newCategoryRequestsCount = (pcrRes.data ?? []).length;

  return {
    summary: [
      { label: "Total Kaam", value: totalKaam },
      { label: "Top Category", value: categoryRows[0]?.category ?? "—" },
      { label: "Top Area", value: areaRows[0]?.area ?? "—" },
      { label: "Top Region", value: regionRows[0]?.region ?? "—" },
      { label: "No Provider Matched", value: noProviderMatchedCount },
      { label: "New Category Requests", value: newCategoryRequestsCount },
    ],
    sections: [
      {
        title: "Category Demand",
        columns: ["Category", "Count", "Share"],
        rows: categoryRows.map((r) => ({
          Category: r.category,
          Count: r.count,
          Share: r.share,
        })),
      },
      {
        title: "Area Demand",
        columns: ["Area", "Region", "Count"],
        rows: areaRows.map((r) => ({
          Area: r.area,
          Region: r.region,
          Count: r.count,
        })),
      },
      {
        title: "Region Demand",
        columns: ["Region", "Count"],
        rows: regionRows.map((r) => ({ Region: r.region, Count: r.count })),
      },
    ],
    notes: [],
  };
}

// ─── PROVIDER LEADS ─────────────────────────────────────────────────
async function buildProviderLeads(
  fromIso: string,
  toIso: string
): Promise<{ summary: SummaryEntry[]; sections: ReportSection[]; notes: string[] }> {
  const [providersRes, matchesRes, notifsRes] = await Promise.all([
    adminSupabase
      .from("providers")
      .select("provider_id, full_name, phone, status, verified")
      .limit(2000),
    adminSupabase
      .from("provider_task_matches")
      .select("task_id, provider_id, match_status, created_at")
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .limit(50000),
    adminSupabase
      .from("notification_logs")
      .select("task_id, provider_id, status, created_at")
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .limit(50000),
  ]);

  const providersById = new Map<
    string,
    { name: string; phone: string; status: string; verified: string }
  >();
  for (const row of (providersRes.data ?? []) as Array<{
    provider_id: string | null;
    full_name: string | null;
    phone: string | null;
    status: string | null;
    verified: string | null;
  }>) {
    const id = strOrNull(row.provider_id);
    if (!id) continue;
    providersById.set(id, {
      name: String(row.full_name ?? "").trim() || "—",
      phone: String(row.phone ?? "").trim() || "—",
      status: String(row.status ?? "").trim(),
      verified: String(row.verified ?? "").trim(),
    });
  }

  const matchedByProvider = new Map<string, number>();
  const respondedByProvider = new Map<string, number>();
  for (const row of (matchesRes.data ?? []) as Array<{
    provider_id: string | null;
    match_status: string | null;
  }>) {
    const id = strOrNull(row.provider_id);
    if (!id) continue;
    matchedByProvider.set(id, (matchedByProvider.get(id) ?? 0) + 1);
    if ((row.match_status ?? "").trim().toLowerCase() === "responded") {
      respondedByProvider.set(id, (respondedByProvider.get(id) ?? 0) + 1);
    }
  }
  const notifiedByProvider = new Map<string, number>();
  for (const row of (notifsRes.data ?? []) as Array<{
    provider_id: string | null;
    status: string | null;
  }>) {
    const id = strOrNull(row.provider_id);
    if (!id) continue;
    if ((row.status ?? "").trim().toLowerCase() === "accepted") {
      notifiedByProvider.set(id, (notifiedByProvider.get(id) ?? 0) + 1);
    }
  }

  const rows = Array.from(providersById.entries())
    .map(([id, p]) => {
      const matched = matchedByProvider.get(id) ?? 0;
      const notified = notifiedByProvider.get(id) ?? 0;
      const responded = respondedByProvider.get(id) ?? 0;
      const rate =
        notified > 0
          ? `${Math.round((responded / notified) * 100)}%`
          : "—";
      return {
        ProviderID: id,
        Name: p.name,
        Phone: p.phone,
        Verified: p.verified,
        Matched: matched,
        Notified: notified,
        Responded: responded,
        ResponseRate: rate,
      };
    })
    .filter((row) => row.Matched > 0 || row.Notified > 0 || row.Responded > 0)
    .sort((a, b) => b.Matched - a.Matched);

  const totalMatched = rows.reduce((sum, r) => sum + r.Matched, 0);
  const totalNotified = rows.reduce((sum, r) => sum + r.Notified, 0);
  const totalResponded = rows.reduce((sum, r) => sum + r.Responded, 0);

  return {
    summary: [
      { label: "Active Providers (in window)", value: rows.length },
      { label: "Total Matches", value: totalMatched },
      { label: "Total Notifications", value: totalNotified },
      { label: "Total Responses", value: totalResponded },
    ],
    sections: [
      {
        title: "Provider Leads",
        columns: [
          "ProviderID",
          "Name",
          "Phone",
          "Verified",
          "Matched",
          "Notified",
          "Responded",
          "ResponseRate",
        ],
        rows,
      },
    ],
    notes: [],
  };
}

// ─── SYSTEM HEALTH ──────────────────────────────────────────────────
async function buildSystemHealth(
  fromIso: string,
  toIso: string
): Promise<{ summary: SummaryEntry[]; sections: ReportSection[]; notes: string[] }> {
  const [
    failedNotifsRes,
    noMatchTasksRes,
    pendingCategoryRes,
    areaReviewRes,
    issueReportsRes,
  ] = await Promise.all([
    adminSupabase
      .from("notification_logs")
      .select("task_id, provider_id, status, error_message, created_at")
      .in("status", ["error", "failed"])
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .limit(500),
    adminSupabase
      .from("tasks")
      .select("task_id, category, area, status, created_at")
      .eq("status", "no_providers_matched")
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .limit(500),
    adminSupabase
      .from("pending_category_requests")
      .select("id, requested_category, created_at, status")
      .eq("status", "pending"),
    adminSupabase
      .from("area_review_queue")
      .select("review_id, raw_area, occurrences, last_seen_at")
      .eq("status", "pending"),
    adminSupabase
      .from("issue_reports")
      .select("id, issue_type, status, created_at")
      .eq("status", "open"),
  ]);

  const failedNotifs = (failedNotifsRes.data ?? []) as Array<{
    task_id: string | null;
    provider_id: string | null;
    status: string | null;
    error_message: string | null;
    created_at: string | null;
  }>;
  const noMatchTasks = (noMatchTasksRes.data ?? []) as Array<{
    task_id: string | null;
    category: string | null;
    area: string | null;
    created_at: string | null;
  }>;
  const pendingCategories = (pendingCategoryRes.data ?? []) as Array<{
    id: string | null;
    requested_category: string | null;
  }>;
  const areaReviews = (areaReviewRes.data ?? []) as Array<{
    review_id: string | null;
    raw_area: string | null;
    occurrences: number | null;
  }>;
  const issueReports = (issueReportsRes.data ?? []) as Array<{
    id: string | null;
    issue_type: string | null;
  }>;

  return {
    summary: [
      { label: "WhatsApp Failures", value: failedNotifs.length },
      { label: "No Providers Matched", value: noMatchTasks.length },
      {
        label: "Pending Category Reviews",
        value: pendingCategories.length,
      },
      { label: "Unresolved Areas", value: areaReviews.length },
      { label: "Open Issue Reports", value: issueReports.length },
    ],
    sections: [
      {
        title: "WhatsApp Failures",
        columns: ["Task", "Provider", "Status", "Error"],
        rows: failedNotifs.map((n) => ({
          Task: strOrNull(n.task_id) ?? "—",
          Provider: strOrNull(n.provider_id) ?? "—",
          Status: strOrNull(n.status) ?? "—",
          Error:
            (strOrNull(n.error_message) ?? "—").slice(0, 120) || "—",
        })),
      },
      {
        title: "No Providers Matched",
        columns: ["Task", "Category", "Area"],
        rows: noMatchTasks.map((t) => ({
          Task: strOrNull(t.task_id) ?? "—",
          Category: strOrNull(t.category) ?? "—",
          Area: strOrNull(t.area) ?? "—",
        })),
      },
      {
        title: "Pending Category Reviews",
        columns: ["RequestID", "Category"],
        rows: pendingCategories.map((p) => ({
          RequestID: strOrNull(p.id) ?? "—",
          Category: strOrNull(p.requested_category) ?? "—",
        })),
      },
      {
        title: "Unresolved Areas",
        columns: ["ReviewID", "Raw Area", "Occurrences"],
        rows: areaReviews.map((a) => ({
          ReviewID: strOrNull(a.review_id) ?? "—",
          "Raw Area": strOrNull(a.raw_area) ?? "—",
          Occurrences: Number(a.occurrences ?? 0),
        })),
      },
      {
        title: "Open Issue Reports",
        columns: ["IssueID", "Issue Type"],
        rows: issueReports.map((i) => ({
          IssueID: strOrNull(i.id) ?? "—",
          "Issue Type": strOrNull(i.issue_type) ?? "—",
        })),
      },
    ],
    notes: [],
  };
}

// ─── MONTHLY BUSINESS SUMMARY ───────────────────────────────────────
async function buildMonthlyBusinessSummary(
  fromIso: string,
  toIso: string
): Promise<{ summary: SummaryEntry[]; sections: ReportSection[]; notes: string[] }> {
  const [
    kaam,
    leads,
    health,
    profilesCountRes,
    providersCountRes,
    verifiedCountRes,
  ] = await Promise.all([
    buildKaamDemand(fromIso, toIso),
    buildProviderLeads(fromIso, toIso),
    buildSystemHealth(fromIso, toIso),
    adminSupabase
      .from("profiles")
      .select("phone", { count: "exact", head: true })
      .eq("role", "user"),
    adminSupabase
      .from("providers")
      .select("provider_id", { count: "exact", head: true }),
    adminSupabase
      .from("providers")
      .select("provider_id", { count: "exact", head: true })
      .eq("verified", "yes"),
  ]);

  const summaryByLabel = new Map(
    [
      ...kaam.summary,
      ...leads.summary,
      ...health.summary,
    ].map((s) => [s.label, s.value])
  );

  const summary: SummaryEntry[] = [
    {
      label: "Total Kaam",
      value: summaryByLabel.get("Total Kaam") ?? 0,
    },
    {
      label: "Top Category",
      value: summaryByLabel.get("Top Category") ?? "—",
    },
    {
      label: "Top Area",
      value: summaryByLabel.get("Top Area") ?? "—",
    },
    {
      label: "Top Region",
      value: summaryByLabel.get("Top Region") ?? "—",
    },
    {
      label: "Registered Users",
      value: Number(profilesCountRes.count ?? 0),
    },
    {
      label: "Total Providers",
      value: Number(providersCountRes.count ?? 0),
    },
    {
      label: "Verified Providers",
      value: Number(verifiedCountRes.count ?? 0),
    },
    {
      label: "WhatsApp Failures",
      value: summaryByLabel.get("WhatsApp Failures") ?? 0,
    },
    {
      label: "Pending Admin Actions",
      value:
        Number(summaryByLabel.get("Pending Category Reviews") ?? 0) +
        Number(summaryByLabel.get("Unresolved Areas") ?? 0) +
        Number(summaryByLabel.get("Open Issue Reports") ?? 0),
    },
  ];

  return {
    summary,
    sections: [
      kaam.sections[0],
      kaam.sections[1],
      leads.sections[0],
      health.sections[0],
    ].filter(Boolean) as ReportSection[],
    notes: [
      "All figures are computed live from Supabase. Categories, areas, and regions are sourced from actual rows — nothing hardcoded.",
    ],
  };
}

const TITLE_BY_TYPE: Record<ReportType, string> = {
  kaam_demand: "Kaam Demand Report",
  provider_leads: "Provider Leads Report",
  system_health: "System Health Report",
  monthly_business_summary: "Monthly Business Summary",
};

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  const typeParam = url.searchParams.get("type");
  const type: ReportType = isReportType(typeParam)
    ? typeParam
    : "monthly_business_summary";

  const defaults = defaultDateRange();
  const from = parseDateOnly(url.searchParams.get("from")) ?? defaults.from;
  const to = parseDateOnly(url.searchParams.get("to")) ?? defaults.to;
  const fromIso = isoStartOfDay(from);
  const toIso = isoEndOfDay(to);

  let payload: {
    summary: SummaryEntry[];
    sections: ReportSection[];
    notes: string[];
  };
  if (type === "kaam_demand") {
    payload = await buildKaamDemand(fromIso, toIso);
  } else if (type === "provider_leads") {
    payload = await buildProviderLeads(fromIso, toIso);
  } else if (type === "system_health") {
    payload = await buildSystemHealth(fromIso, toIso);
  } else {
    payload = await buildMonthlyBusinessSummary(fromIso, toIso);
  }

  const response: ReportPayload = {
    success: true,
    type,
    title: TITLE_BY_TYPE[type],
    from,
    to,
    generatedAt: new Date().toISOString(),
    summary: payload.summary,
    sections: payload.sections,
    notes: payload.notes,
  };
  return NextResponse.json(response);
}
