"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

const CATEGORY_OPTIONS = [
  "All Categories",
  "Employer",
  "Employee",
  "Property Seller",
  "Property Buyer",
  "Landlord",
  "Tenant",
  "Vehicle Seller",
  "Vehicle Buyer",
  "Other",
];

const AREA_OPTIONS = [
  "All Areas",
  "Sardarpura",
  "Shastri Nagar",
  "Ratanada",
  "Paota",
  "Basni",
  "Pal Road",
  "Chopasni Housing Board",
  "Mandore",
  "Soorsagar",
  "Kudi Bhagtasni",
];

type NeedApiItem = {
  NeedID?: string;
  Title?: string;
  Category?: string;
  Area?: string;
  Description?: string;
  PosterLabel?: string;
  CreatedAt?: string;
  CurrentStatus?: string;
};

type GetNeedsResponse = {
  ok?: boolean;
  status?: string;
  error?: string;
  message?: string;
  needs?: NeedApiItem[];
};

type NeedCardItem = {
  id: string;
  title: string;
  category: string;
  area: string;
  description: string;
  postedBy: string;
  timePosted: string;
  currentStatus: string;
};

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const CATEGORY_BADGE_STYLES: Record<string, string> = {
  Employer: "border-emerald-100 bg-emerald-50 text-emerald-700",
  Employee: "border-sky-100 bg-sky-50 text-sky-700",
  "Property Seller": "border-amber-100 bg-amber-50 text-amber-700",
  "Property Buyer": "border-orange-100 bg-orange-50 text-orange-700",
  Landlord: "border-violet-100 bg-violet-50 text-violet-700",
  Tenant: "border-fuchsia-100 bg-fuchsia-50 text-fuchsia-700",
  "Vehicle Seller": "border-rose-100 bg-rose-50 text-rose-700",
  "Vehicle Buyer": "border-cyan-100 bg-cyan-50 text-cyan-700",
  Other: "border-slate-200 bg-slate-100 text-slate-700",
};

function getBadgeClassName(category: string) {
  return (
    CATEGORY_BADGE_STYLES[category] ||
    "border-slate-200 bg-slate-100 text-slate-700"
  );
}

function formatPostedOn(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "Recently posted";

  const match = raw.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+\d{2}:\d{2}:\d{2})?$/
  );
  if (match) {
    const day = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const year = Number(match[3]);
    if (!day || monthIndex < 0 || monthIndex > 11 || !year) return raw;

    return `${day} ${MONTH_LABELS[monthIndex]} ${year}`;
  }

  const parsed = new Date(raw);
  const parsedTime = parsed.getTime();
  if (Number.isNaN(parsedTime)) return raw;

  const day = parsed.getDate();
  const monthIndex = parsed.getMonth();
  const year = parsed.getFullYear();
  if (!day || monthIndex < 0 || monthIndex > 11 || !year) return raw;

  return `${day} ${MONTH_LABELS[monthIndex]} ${year}`;
}

function formatStatusLabel(status: string) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "open") return "Active";
  if (normalized === "completed") return "Completed";
  if (normalized === "closed") return "Closed";
  if (normalized === "expired") return "Expired";
  return status || "Active";
}

function mapNeedToCard(need: NeedApiItem): NeedCardItem {
  return {
    id: String(need.NeedID || ""),
    title: String(need.Title || "").trim() || "Untitled need",
    category: String(need.Category || "").trim() || "Other",
    area: String(need.Area || "").trim() || "Area not specified",
    description: String(need.Description || "").trim(),
    postedBy: String(need.PosterLabel || "").trim() || "Anonymous",
    timePosted: String(need.CreatedAt || "").trim() || "Recently posted",
    currentStatus: String(need.CurrentStatus || "").trim(),
  };
}

async function fetchNeedsData(category?: string, area?: string) {
  const payload: Record<string, string> = {
    action: "get_needs",
  };

  if (category && category !== "All Categories") {
    payload.Category = category;
  }

  if (area && area !== "All Areas") {
    payload.Area = area;
  }

  const response = await fetch("/api/kk", {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as GetNeedsResponse;
  if (!response.ok || data?.ok !== true) {
    throw new Error(data?.error || data?.message || "Failed to load needs.");
  }

  return Array.isArray(data?.needs) ? data.needs.map(mapNeedToCard) : [];
}

// Parse description into structured key-value rows where possible.
// Lines formatted as "Label: value" become separate rows; anything else is
// treated as a single "Details" row.
function parseDescriptionRows(raw: string): { label: string; value: string }[] {
  if (!raw) return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0 && colonIdx < line.length - 1) {
        return {
          label: line.slice(0, colonIdx).trim(),
          value: line.slice(colonIdx + 1).trim(),
        };
      }
      return { label: "Details", value: line };
    });
}

// A single label + value row used inside the info table.
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 py-1">
      <span className="w-24 shrink-0 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-xs text-slate-700">{value}</span>
    </div>
  );
}

function NeedCard({ need }: { need: NeedCardItem }) {
  const detailRows = parseDescriptionRows(need.description);
  const statusLabel = formatStatusLabel(need.currentStatus);
  const postedOnLabel = formatPostedOn(need.timePosted);

  return (
    <article className="rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">
            {need.title}
          </h2>
          <span
            className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${getBadgeClassName(need.category)}`}
          >
            {need.category}
          </span>
        </div>
        <Link
          href={`/i-need/respond/${encodeURIComponent(need.id)}`}
          className="shrink-0 rounded-xl bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700"
        >
          Respond
        </Link>
      </div>

      <div className="divide-y divide-slate-100 px-4 py-1">
        <InfoRow label="Area" value={need.area} />
        <InfoRow label="Status" value={statusLabel} />
        {detailRows.map((row, i) => (
          <InfoRow key={i} label={row.label} value={row.value} />
        ))}
        <InfoRow label="Posted By" value={need.postedBy} />
        <InfoRow label="Posted On" value={postedOnLabel} />
      </div>
    </article>
  );
}

function EmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center shadow-sm">
      <h2 className="text-xl font-semibold text-slate-900">No needs found</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
        Try clearing your filters to browse more needs from nearby areas.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-5 inline-flex rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
      >
        Clear
      </button>
    </div>
  );
}

export default function INeedPage() {
  const searchParams = useSearchParams();
  const categoryFromUrl = searchParams.get("category") ?? "";

  const [selectedCategory, setSelectedCategory] = useState(
    categoryFromUrl || "All Categories"
  );
  const [selectedArea, setSelectedArea] = useState("All Areas");
  const [needs, setNeeds] = useState<NeedCardItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadNeeds(category = "All Categories", area = "All Areas") {
    setIsLoading(true);
    setError("");

    try {
      const nextNeeds = await fetchNeedsData(category, area);
      setNeeds(nextNeeds);
    } catch (err) {
      setNeeds([]);
      setError(err instanceof Error ? err.message : "Failed to load needs.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadNeeds(selectedCategory);
  }, [selectedCategory]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleApplyFilters() {
    void loadNeeds(selectedCategory, selectedArea);
  }

  function handleClearFilters() {
    setSelectedCategory("All Categories");
    setSelectedArea("All Areas");
    void loadNeeds("All Categories", "All Areas");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-slate-200 bg-white px-6 py-8 shadow-sm shadow-slate-200/60 sm:px-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                I NEED
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">
                Post your need or browse what people nearby are looking for
              </p>
            </div>

            <Link
              href="/i-need/post"
              className="inline-flex w-full items-center justify-center rounded-2xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-700 md:w-auto"
            >
              Post Your Need
            </Link>
          </div>
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60 sm:p-5">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] md:items-end">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Category
              </label>
              <select
                value={selectedCategory}
                onChange={(event) => setSelectedCategory(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              >
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Area
              </label>
              <input
                list="i-need-listing-area-options"
                value={selectedArea}
                onChange={(event) => setSelectedArea(event.target.value)}
                placeholder="Type or choose an area"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
              <datalist id="i-need-listing-area-options">
                {AREA_OPTIONS.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </div>

            <button
              type="button"
              onClick={handleApplyFilters}
              className="rounded-2xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-700"
            >
              Apply Filters
            </button>

            <button
              type="button"
              onClick={handleClearFilters}
              className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Clear
            </button>
          </div>
        </section>

        {error ? (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <section className="mt-6">
          {isLoading ? (
            <div className="rounded-3xl border border-slate-200 bg-white px-6 py-14 text-center shadow-sm">
              <p className="text-sm text-slate-500">Loading needs...</p>
            </div>
          ) : needs.length === 0 ? (
            <EmptyState onClear={handleClearFilters} />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {needs.map((need) => (
                <NeedCard key={need.id} need={need} />
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
