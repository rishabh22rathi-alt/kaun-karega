import { adminSupabase } from "@/lib/supabase/admin";

// Sandbox-only read-only inspection page for the Area Intelligence
// tables. Does NOT touch live matching, provider registration, homepage
// search, /api/find-provider, /api/areas, or the existing areas /
// area_aliases logic. No mutations — display only.
//
// Server Component: pulls directly from `adminSupabase` so RLS is
// bypassed and we never ship the service-role key to the browser.
// Search filters travel through URL params (`regionQ`, `areaQ`, `aliasQ`),
// so the page stays JS-free and matches the project's "simple admin page"
// style.

export const dynamic = "force-dynamic";

type SearchParams = {
  regionQ?: string;
  areaQ?: string;
  aliasQ?: string;
};

type RegionRow = {
  region_code: string | null;
  region_name: string | null;
  active: boolean | null;
};

type AreaRow = {
  area_code: string | null;
  canonical_area: string | null;
  region_code: string | null;
  active: boolean | null;
};

type AliasRow = {
  alias_code: string | null;
  alias: string | null;
  canonical_area: string | null;
  region_code: string | null;
  active: boolean | null;
};

// Hard ceiling so a runaway table can't blow the response.
const MAX_ROWS = 5000;

const norm = (value: unknown) =>
  String(value ?? "").trim().toLowerCase();

function rowMatches(value: unknown, query: string): boolean {
  if (!query) return true;
  return norm(value).includes(norm(query));
}

async function fetchAll() {
  const [regions, areas, aliases] = await Promise.all([
    adminSupabase
      .from("service_regions")
      .select("region_code, region_name, active")
      .order("region_code", { ascending: true })
      .limit(MAX_ROWS),
    adminSupabase
      .from("service_region_areas")
      .select("area_code, canonical_area, region_code, active")
      .order("region_code", { ascending: true })
      .order("canonical_area", { ascending: true })
      .limit(MAX_ROWS),
    adminSupabase
      .from("service_region_area_aliases")
      .select("alias_code, alias, canonical_area, region_code, active")
      .order("region_code", { ascending: true })
      .order("alias", { ascending: true })
      .limit(MAX_ROWS),
  ]);

  return { regions, areas, aliases };
}

export default async function AreaIntelligenceDataPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = (await searchParams) ?? {};
  const regionQ = (params.regionQ ?? "").trim();
  const areaQ = (params.areaQ ?? "").trim();
  const aliasQ = (params.aliasQ ?? "").trim();

  const { regions, areas, aliases } = await fetchAll();

  const errors = [
    regions.error
      ? { table: "service_regions", message: regions.error.message }
      : null,
    areas.error
      ? { table: "service_region_areas", message: areas.error.message }
      : null,
    aliases.error
      ? { table: "service_region_area_aliases", message: aliases.error.message }
      : null,
  ].filter(Boolean) as { table: string; message: string }[];

  const regionRows = (regions.data ?? []) as RegionRow[];
  const areaRows = (areas.data ?? []) as AreaRow[];
  const aliasRows = (aliases.data ?? []) as AliasRow[];

  const filteredRegions = regionRows.filter((r) =>
    rowMatches(r.region_name, regionQ)
  );
  const filteredAreas = areaRows.filter((r) =>
    rowMatches(r.canonical_area, areaQ)
  );
  const filteredAliases = aliasRows.filter((r) => rowMatches(r.alias, aliasQ));

  return (
    <main className="min-w-0 space-y-8 px-4 py-8 sm:px-0">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          Area Intelligence Data
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Read-only inspection of{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-800">
            service_regions
          </code>
          ,{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-800">
            service_region_areas
          </code>
          , and{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-800">
            service_region_area_aliases
          </code>
          . No mutations. Filters are applied client-side after fetch.
        </p>
      </div>

      {errors.length > 0 ? (
        <div className="space-y-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <div className="font-semibold">Some tables failed to load:</div>
          <ul className="list-disc pl-5">
            {errors.map((e) => (
              <li key={e.table}>
                <code>{e.table}</code>: {e.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form
        method="get"
        className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3"
      >
        <SearchInput
          name="regionQ"
          label="Search region name"
          value={regionQ}
        />
        <SearchInput
          name="areaQ"
          label="Search canonical area"
          value={areaQ}
        />
        <SearchInput name="aliasQ" label="Search alias" value={aliasQ} />
        <div className="flex items-center gap-2 sm:col-span-3">
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-lg bg-[#003d20] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#002a16]"
          >
            Apply filters
          </button>
          <a
            href="/admin/area-intelligence-data"
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            Reset
          </a>
        </div>
      </form>

      <Section
        title="Regions"
        total={regionRows.length}
        showing={filteredRegions.length}
        filtered={Boolean(regionQ)}
        columns={["region_code", "region_name", "active"]}
        emptyLabel={
          regions.error ? "Failed to load." : "No regions match the filter."
        }
        rows={filteredRegions.map((r) => [
          r.region_code ?? "—",
          r.region_name ?? "—",
          <ActiveCell key="a" value={r.active} />,
        ])}
      />

      <Section
        title="Canonical Areas"
        total={areaRows.length}
        showing={filteredAreas.length}
        filtered={Boolean(areaQ)}
        columns={["area_code", "canonical_area", "region_code", "active"]}
        emptyLabel={
          areas.error ? "Failed to load." : "No canonical areas match the filter."
        }
        rows={filteredAreas.map((r) => [
          r.area_code ?? "—",
          r.canonical_area ?? "—",
          r.region_code ?? "—",
          <ActiveCell key="a" value={r.active} />,
        ])}
      />

      <Section
        title="Aliases"
        total={aliasRows.length}
        showing={filteredAliases.length}
        filtered={Boolean(aliasQ)}
        columns={["alias_code", "alias", "canonical_area", "region_code", "active"]}
        emptyLabel={
          aliases.error ? "Failed to load." : "No aliases match the filter."
        }
        rows={filteredAliases.map((r) => [
          r.alias_code ?? "—",
          r.alias ?? "—",
          r.canonical_area ?? "—",
          r.region_code ?? "—",
          <ActiveCell key="a" value={r.active} />,
        ])}
      />
    </main>
  );
}

function SearchInput({
  name,
  label,
  value,
}: {
  name: string;
  label: string;
  value: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <input
        type="text"
        name={name}
        defaultValue={value}
        placeholder=""
        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200"
      />
    </label>
  );
}

function Section({
  title,
  total,
  showing,
  filtered,
  columns,
  rows,
  emptyLabel,
}: {
  title: string;
  total: number;
  showing: number;
  filtered: boolean;
  columns: string[];
  rows: React.ReactNode[][];
  emptyLabel: string;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          {title}
        </h2>
        <div className="text-xs text-slate-500">
          {filtered
            ? `Showing ${showing} of ${total}`
            : `${total} total`}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-slate-500">
          {emptyLabel}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-white text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {columns.map((c) => (
                  <th key={c} className="px-4 py-2 font-semibold">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((cells, i) => (
                <tr key={i} className="align-top">
                  {cells.map((cell, j) => (
                    <td key={j} className="px-4 py-2 text-slate-800">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ActiveCell({ value }: { value: boolean | null }) {
  if (value === true) {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
        true
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
        false
      </span>
    );
  }
  return <span className="text-xs text-slate-400">—</span>;
}
