import { adminSupabase } from "@/lib/supabase/admin";

// Sandbox-only read-only diagnostics dashboard for the Area Intelligence
// tables. Does NOT touch live matching, provider registration, homepage
// search, /api/find-provider, /api/areas, resolver API, suggestion API,
// or existing area_aliases logic. No mutations — display only.
//
// Server Component: pulls directly from `adminSupabase` so RLS is bypassed
// and the service-role key never reaches the browser. Sits under the
// existing /admin/* route protection.

export const dynamic = "force-dynamic";

const MAX_ROWS = 5000;

type Region = {
  region_code: string;
  region_name: string | null;
  active: boolean | null;
};

type Area = {
  area_code: string;
  canonical_area: string | null;
  region_code: string | null;
  active: boolean | null;
};

type Alias = {
  alias_code: string;
  alias: string | null;
  canonical_area: string | null;
  region_code: string | null;
  active: boolean | null;
};

const GENERICS = [
  "belt",
  "corridor",
  "zone",
  "extension",
  "side",
  "growth",
  "outer",
  "connector",
];
const EN_DASH = "–";
const EM_DASH = "—";
const HYPHEN = "-";

// Dedup normalization: lowercase, strip spaces, strip hyphens. Catches the
// "Sardarpura" vs "Sardar Pura" vs "Sardar-pura" family without trying to
// be clever about typos or transliteration.
const dedupKey = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[\s\-–—]+/g, "");

const tokenize = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

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

export default async function AreaIntelligenceDiagnosticsPage() {
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

  const regionRows = (regions.data ?? []) as Region[];
  const areaRows = (areas.data ?? []) as Area[];
  const aliasRows = (aliases.data ?? []) as Alias[];

  // ── Summary counts ──
  const totals = {
    regions: regionRows.length,
    areas: areaRows.length,
    aliases: aliasRows.length,
    inactiveRegions: regionRows.filter((r) => r.active === false).length,
    inactiveAreas: areaRows.filter((a) => a.active === false).length,
    inactiveAliases: aliasRows.filter((a) => a.active === false).length,
  };

  // ── Per-region area/alias counts (basis for empty + low-density + distribution) ──
  type PerRegion = {
    region_code: string;
    region_name: string | null;
    active: boolean | null;
    areas: number;
    aliases: number;
  };
  const perRegion: PerRegion[] = regionRows
    .map((r) => ({
      region_code: r.region_code,
      region_name: r.region_name,
      active: r.active,
      areas: areaRows.filter((a) => a.region_code === r.region_code).length,
      aliases: aliasRows.filter((a) => a.region_code === r.region_code).length,
    }))
    .sort((a, b) => a.region_code.localeCompare(b.region_code));

  const emptyRegions = perRegion.filter(
    (r) => r.areas === 0 || r.aliases === 0
  );
  const lowDensityRegions = perRegion.filter(
    (r) => (r.areas < 5 || r.aliases < 5) && !(r.areas === 0 && r.aliases === 0)
  );

  // ── Duplicate-like canonical areas (across all regions; cross-region duplicates often legit, surface anyway) ──
  type DupAreaGroup = {
    key: string;
    rows: Area[];
  };
  const areaByKey = new Map<string, Area[]>();
  for (const a of areaRows) {
    const k = dedupKey(a.canonical_area);
    if (!k) continue;
    const arr = areaByKey.get(k) ?? [];
    arr.push(a);
    areaByKey.set(k, arr);
  }
  const duplicateAreaGroups: DupAreaGroup[] = Array.from(areaByKey.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({ key, rows }))
    .sort((a, b) => b.rows.length - a.rows.length);

  // ── Duplicate-like aliases ──
  type DupAliasGroup = {
    key: string;
    rows: Alias[];
  };
  const aliasByKey = new Map<string, Alias[]>();
  for (const a of aliasRows) {
    const k = dedupKey(a.alias);
    if (!k) continue;
    const arr = aliasByKey.get(k) ?? [];
    arr.push(a);
    aliasByKey.set(k, arr);
  }
  const duplicateAliasGroups: DupAliasGroup[] = Array.from(aliasByKey.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({ key, rows }))
    .sort((a, b) => b.rows.length - a.rows.length);

  // ── Generic / suspicious names ──
  type GenericHit = {
    type: "region" | "canonical_area" | "alias";
    value: string;
    region_code: string;
    hits: string[];
  };
  const generics: GenericHit[] = [];
  for (const r of regionRows) {
    const toks = tokenize(r.region_name);
    const hits = toks.filter((t) => GENERICS.includes(t));
    if (hits.length)
      generics.push({
        type: "region",
        value: r.region_name ?? "",
        region_code: r.region_code,
        hits,
      });
  }
  for (const a of areaRows) {
    const toks = tokenize(a.canonical_area);
    const hits = toks.filter((t) => GENERICS.includes(t));
    if (hits.length)
      generics.push({
        type: "canonical_area",
        value: a.canonical_area ?? "",
        region_code: a.region_code ?? "",
        hits,
      });
  }
  for (const a of aliasRows) {
    const toks = tokenize(a.alias);
    const hits = toks.filter((t) => GENERICS.includes(t));
    if (hits.length)
      generics.push({
        type: "alias",
        value: a.alias ?? "",
        region_code: a.region_code ?? "",
        hits,
      });
  }

  // ── Orphan diagnostics ──
  const regionCodeSet = new Set(regionRows.map((r) => r.region_code));
  const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
  const areaPairSet = new Set(
    areaRows.map((a) => `${norm(a.canonical_area)}||${a.region_code}`)
  );

  const orphanAliasesByPair = aliasRows.filter(
    (a) => !areaPairSet.has(`${norm(a.canonical_area)}||${a.region_code}`)
  );
  const areasMissingRegion = areaRows.filter(
    (a) => !regionCodeSet.has(a.region_code ?? "")
  );
  const aliasesMissingRegion = aliasRows.filter(
    (a) => !regionCodeSet.has(a.region_code ?? "")
  );

  // ── Dash character consistency ──
  const dashStats = {
    enDash: {
      regions: regionRows.filter((r) =>
        (r.region_name ?? "").includes(EN_DASH)
      ),
      areas: areaRows.filter((a) =>
        (a.canonical_area ?? "").includes(EN_DASH)
      ),
      aliases: aliasRows.filter((a) => (a.alias ?? "").includes(EN_DASH)),
    },
    emDash: {
      regions: regionRows.filter((r) =>
        (r.region_name ?? "").includes(EM_DASH)
      ),
      areas: areaRows.filter((a) =>
        (a.canonical_area ?? "").includes(EM_DASH)
      ),
      aliases: aliasRows.filter((a) => (a.alias ?? "").includes(EM_DASH)),
    },
    hyphen: {
      regions: regionRows.filter((r) =>
        (r.region_name ?? "").includes(HYPHEN)
      ),
      areas: areaRows.filter((a) =>
        (a.canonical_area ?? "").includes(HYPHEN)
      ),
      aliases: aliasRows.filter((a) => (a.alias ?? "").includes(HYPHEN)),
    },
  };

  return (
    <main className="min-w-0 space-y-8 px-4 py-8 sm:px-0">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Area Intelligence Diagnostics
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Read-only data-quality dashboard for{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-800">
            service_regions
          </code>
          ,{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-800">
            service_region_areas
          </code>
          ,{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-800">
            service_region_area_aliases
          </code>
          . No edits. No deletes. No live-flow impact.
        </p>
      </header>

      {errors.length > 0 ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <div className="font-semibold">Some tables failed to load:</div>
          <ul className="mt-1 list-disc pl-5">
            {errors.map((e) => (
              <li key={e.table}>
                <code>{e.table}</code>: {e.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 1. Summary */}
      <Section title="Summary">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Card label="Regions" value={totals.regions} />
          <Card label="Canonical Areas" value={totals.areas} />
          <Card label="Aliases" value={totals.aliases} />
          <Card
            label="Inactive Regions"
            value={totals.inactiveRegions}
            tone={totals.inactiveRegions > 0 ? "warn" : "ok"}
          />
          <Card
            label="Inactive Areas"
            value={totals.inactiveAreas}
            tone={totals.inactiveAreas > 0 ? "warn" : "ok"}
          />
          <Card
            label="Inactive Aliases"
            value={totals.inactiveAliases}
            tone={totals.inactiveAliases > 0 ? "warn" : "ok"}
          />
        </div>
      </Section>

      {/* 2. Empty regions */}
      <Section
        title={`Empty Regions (${emptyRegions.length})`}
        subtitle="Regions with 0 areas or 0 aliases."
      >
        <SimpleTable
          columns={["region_code", "region_name", "areas", "aliases"]}
          rows={emptyRegions.map((r) => [
            r.region_code,
            r.region_name ?? "—",
            <CountCell key="a" value={r.areas} bad={r.areas === 0} />,
            <CountCell key="b" value={r.aliases} bad={r.aliases === 0} />,
          ])}
          empty="No empty regions."
        />
      </Section>

      {/* 3. Low-density regions */}
      <Section
        title={`Low-Density Regions (${lowDensityRegions.length})`}
        subtitle="Regions with fewer than 5 areas or fewer than 5 aliases (excluding fully-empty regions shown above)."
      >
        <SimpleTable
          columns={["region_code", "region_name", "areas", "aliases"]}
          rows={lowDensityRegions.map((r) => [
            r.region_code,
            r.region_name ?? "—",
            <CountCell key="a" value={r.areas} bad={r.areas < 5} />,
            <CountCell key="b" value={r.aliases} bad={r.aliases < 5} />,
          ])}
          empty="No low-density regions."
        />
      </Section>

      {/* 4. Duplicate-like canonical areas */}
      <Section
        title={`Duplicate-Like Canonical Areas (${duplicateAreaGroups.length} groups)`}
        subtitle="Normalized via lowercase + strip spaces/hyphens. Cross-region matches included — same canonical seeded in multiple regions is often legitimate (e.g. Bhadwasiya in R-04 and R-05); flagged for review."
      >
        {duplicateAreaGroups.length === 0 ? (
          <EmptyState text="No duplicate-like canonical areas." />
        ) : (
          <div className="space-y-3">
            {duplicateAreaGroups.map((g) => (
              <DupGroup
                key={g.key}
                groupKey={g.key}
                rows={g.rows.map((r) => ({
                  primary: r.canonical_area ?? "—",
                  secondary: `${r.area_code} · ${r.region_code} · ${
                    r.active ? "active" : "inactive"
                  }`,
                }))}
              />
            ))}
          </div>
        )}
      </Section>

      {/* 5. Duplicate-like aliases */}
      <Section
        title={`Duplicate-Like Aliases (${duplicateAliasGroups.length} groups)`}
        subtitle="Same normalization as canonical areas. Cross-region duplicates included."
      >
        {duplicateAliasGroups.length === 0 ? (
          <EmptyState text="No duplicate-like aliases." />
        ) : (
          <div className="space-y-3">
            {duplicateAliasGroups.map((g) => (
              <DupGroup
                key={g.key}
                groupKey={g.key}
                rows={g.rows.map((r) => ({
                  primary: r.alias ?? "—",
                  secondary: `${r.alias_code} · ${r.canonical_area ?? "—"} · ${
                    r.region_code
                  } · ${r.active ? "active" : "inactive"}`,
                }))}
              />
            ))}
          </div>
        )}
      </Section>

      {/* 6. Generic / suspicious names */}
      <Section
        title={`Generic / Suspicious Names (${generics.length})`}
        subtitle={`Token match against: ${GENERICS.join(", ")}.`}
      >
        <SimpleTable
          columns={["type", "value", "region", "matched tokens"]}
          rows={generics.map((g) => [
            <span
              key="t"
              className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700"
            >
              {g.type}
            </span>,
            g.value,
            g.region_code,
            g.hits.join(", "),
          ])}
          empty="No generic-token hits."
        />
      </Section>

      {/* 7. Orphan diagnostics */}
      <Section
        title={`Orphan Diagnostics (${
          orphanAliasesByPair.length +
          areasMissingRegion.length +
          aliasesMissingRegion.length
        })`}
        subtitle="Referential-integrity checks that should always be zero."
      >
        <SubSection
          title={`Aliases with missing (canonical_area, region_code) pair — ${orphanAliasesByPair.length}`}
        >
          <SimpleTable
            columns={["alias_code", "alias", "canonical_area", "region_code"]}
            rows={orphanAliasesByPair.map((a) => [
              a.alias_code,
              a.alias ?? "—",
              a.canonical_area ?? "—",
              a.region_code ?? "—",
            ])}
            empty="None."
          />
        </SubSection>
        <SubSection
          title={`Areas referencing missing region — ${areasMissingRegion.length}`}
        >
          <SimpleTable
            columns={["area_code", "canonical_area", "region_code"]}
            rows={areasMissingRegion.map((a) => [
              a.area_code,
              a.canonical_area ?? "—",
              a.region_code ?? "—",
            ])}
            empty="None."
          />
        </SubSection>
        <SubSection
          title={`Aliases referencing missing region — ${aliasesMissingRegion.length}`}
        >
          <SimpleTable
            columns={["alias_code", "alias", "region_code"]}
            rows={aliasesMissingRegion.map((a) => [
              a.alias_code,
              a.alias ?? "—",
              a.region_code ?? "—",
            ])}
            empty="None."
          />
        </SubSection>
      </Section>

      {/* 8. Dash character consistency */}
      <Section
        title="Dash Character Consistency"
        subtitle={`Counts of rows containing en dash (U+2013 ${EN_DASH}), em dash (U+2014 ${EM_DASH}), and ASCII hyphen (-). Mixed usage is a search-time hazard — normalize before opening user-facing input.`}
      >
        <SimpleTable
          columns={["dash", "regions", "areas", "aliases"]}
          rows={[
            [
              `en dash (${EN_DASH})`,
              <CountCell
                key="er"
                value={dashStats.enDash.regions.length}
                bad={dashStats.enDash.regions.length > 0}
              />,
              <CountCell
                key="ea"
                value={dashStats.enDash.areas.length}
                bad={dashStats.enDash.areas.length > 0}
              />,
              <CountCell
                key="el"
                value={dashStats.enDash.aliases.length}
                bad={dashStats.enDash.aliases.length > 0}
              />,
            ],
            [
              `em dash (${EM_DASH})`,
              <CountCell
                key="mr"
                value={dashStats.emDash.regions.length}
                bad={dashStats.emDash.regions.length > 0}
              />,
              <CountCell
                key="ma"
                value={dashStats.emDash.areas.length}
                bad={dashStats.emDash.areas.length > 0}
              />,
              <CountCell
                key="ml"
                value={dashStats.emDash.aliases.length}
                bad={dashStats.emDash.aliases.length > 0}
              />,
            ],
            [
              "hyphen (-)",
              <CountCell key="hr" value={dashStats.hyphen.regions.length} />,
              <CountCell key="ha" value={dashStats.hyphen.areas.length} />,
              <CountCell key="hl" value={dashStats.hyphen.aliases.length} />,
            ],
          ]}
          empty=""
        />
        {dashStats.enDash.regions.length > 0 ? (
          <details className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <summary className="cursor-pointer font-semibold text-slate-600">
              Region names with en dash ({dashStats.enDash.regions.length})
            </summary>
            <ul className="mt-2 list-disc pl-5 text-slate-700">
              {dashStats.enDash.regions.map((r) => (
                <li key={r.region_code}>
                  <code>{r.region_code}</code> · {r.region_name}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Section>

      {/* 9. Region distribution */}
      <Section
        title="Region Distribution"
        subtitle="Full breakdown — useful for spotting density skews."
      >
        <SimpleTable
          columns={["region_code", "region_name", "area count", "alias count"]}
          rows={perRegion.map((r) => [
            <span key="c" className="font-mono text-xs">
              {r.region_code}
            </span>,
            <>
              {r.region_name ?? "—"}
              {!r.active ? (
                <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  inactive
                </span>
              ) : null}
            </>,
            <CountCell key="a" value={r.areas} bad={r.areas === 0} />,
            <CountCell key="b" value={r.aliases} bad={r.aliases === 0} />,
          ])}
          empty="No regions."
        />
      </Section>
    </main>
  );
}

// ─── small UI helpers ─────────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
        ) : null}
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}

function SubSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
        {title}
      </div>
      {children}
    </div>
  );
}

function Card({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn";
}) {
  const bg =
    tone === "warn"
      ? "bg-amber-50 border-amber-200"
      : "bg-white border-slate-200";
  const num =
    tone === "warn" ? "text-amber-800" : "text-slate-900";
  return (
    <div className={`rounded-xl border ${bg} px-3 py-3 shadow-sm`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold ${num}`}>{value}</div>
    </div>
  );
}

function CountCell({ value, bad }: { value: number; bad?: boolean }) {
  if (bad) {
    return (
      <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
        {value}
      </span>
    );
  }
  return <span className="text-sm text-slate-800">{value}</span>;
}

function SimpleTable({
  columns,
  rows,
  empty,
}: {
  columns: string[];
  rows: React.ReactNode[][];
  empty: string;
}) {
  if (rows.length === 0) {
    return empty ? <EmptyState text={empty} /> : null;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-white text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {columns.map((c) => (
              <th key={c} className="px-3 py-2 font-semibold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((cells, i) => (
            <tr key={i} className="align-top">
              {cells.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-slate-800">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-3 text-center text-xs text-slate-500">
      {text}
    </div>
  );
}

function DupGroup({
  groupKey,
  rows,
}: {
  groupKey: string;
  rows: { primary: string; secondary: string }[];
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        normalized: <code className="font-mono">{groupKey}</code>
        <span className="ml-2 text-slate-400">· {rows.length} rows</span>
      </div>
      <ul className="mt-1 space-y-0.5 text-sm">
        {rows.map((r, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-2">
            <span className="font-semibold text-slate-800">{r.primary}</span>
            <span className="text-[11px] text-slate-500">{r.secondary}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
