"use client";

import { useEffect, useState, type ReactElement } from "react";

// Category-wise Kaam Allocation donut card.
//
// Reads:   GET /api/admin/kaam  (uses the categoryKaam slice only)
// Mutates: none.
//
// This card lives inside the Report Generation tab (web/components/admin/
// ReportsTab.tsx). It used to be rendered inside KaamTab's analytics
// block; it was moved here so the dashboard's Kaam section stays focused
// on the lifecycle table and the report tab gains the share-by-category
// view alongside its generated reports.

type CategoryKaamPoint = {
  category: string;
  count: number;
  percentage: number;
};

type LoadResponse = {
  success?: boolean;
  categoryKaam?: CategoryKaamPoint[];
  error?: string;
};

const DONUT_SLICE_COLORS = [
  "#003d20", // Kaun Karega green
  "#f97316", // orange
  "#0ea5e9", // cyan
  "#6366f1", // indigo
  "#22c55e", // green
  "#eab308", // yellow
  "#ec4899", // pink
  "#64748b", // slate
];

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number
): string {
  // Donut math — angles are in radians, clockwise from -π/2 (12 o'clock).
  const startX = cx + r * Math.cos(startAngle);
  const startY = cy + r * Math.sin(startAngle);
  const endX = cx + r * Math.cos(endAngle);
  const endY = cy + r * Math.sin(endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${startX} ${startY} A ${r} ${r} 0 ${largeArc} 1 ${endX} ${endY}`;
}

export default function CategoryKaamAllocationCard(): ReactElement {
  const [categoryKaam, setCategoryKaam] = useState<CategoryKaamPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/admin/kaam", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as LoadResponse;
        if (cancelled) return;
        if (!res.ok || !json?.success) {
          setError(
            json?.error || `Failed to load category data (${res.status})`
          );
          setCategoryKaam([]);
          return;
        }
        setCategoryKaam(
          Array.isArray(json.categoryKaam) ? json.categoryKaam : []
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Network error");
        setCategoryKaam([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Donut geometry.
  const donutSize = 160;
  const donutCx = donutSize / 2;
  const donutCy = donutSize / 2;
  const donutR = 64;
  const donutStrokeWidth = 24;
  const donutTotal = categoryKaam.reduce((sum, c) => sum + c.count, 0);
  // Pre-compute each slice's [start, end] cumulatively before mapping
  // to path strings — avoids the let-reassign-during-render warning.
  const sliceAngles: Array<{ start: number; end: number }> = [];
  categoryKaam.forEach((slice, i) => {
    const prevEnd = i === 0 ? -Math.PI / 2 : sliceAngles[i - 1].end;
    const fraction = donutTotal > 0 ? slice.count / donutTotal : 0;
    sliceAngles.push({
      start: prevEnd,
      end: prevEnd + fraction * Math.PI * 2,
    });
  });
  const donutSlices = categoryKaam.map((slice, i) => ({
    d: describeArc(
      donutCx,
      donutCy,
      donutR,
      sliceAngles[i].start,
      sliceAngles[i].end
    ),
    color: DONUT_SLICE_COLORS[i % DONUT_SLICE_COLORS.length],
    slice,
  }));

  return (
    <section
      data-testid="kaam-category-chart"
      className="rounded-xl border border-slate-200 bg-white p-4"
    >
      <h3 className="text-sm font-semibold text-slate-900">
        Category-wise Kaam Allocation
      </h3>
      <p className="mt-0.5 text-xs text-slate-500">
        Share by total Kaam volume.
      </p>
      {loading ? (
        <p
          data-testid="kaam-category-chart-loading"
          className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500"
        >
          Loading category allocation…
        </p>
      ) : error ? (
        <p
          data-testid="kaam-category-chart-error"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {error}
        </p>
      ) : categoryKaam.length === 0 ? (
        <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
          No category data yet.
        </p>
      ) : (
        <div className="mt-4 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <svg
            width={donutSize}
            height={donutSize}
            viewBox={`0 0 ${donutSize} ${donutSize}`}
            role="img"
            aria-label="Category-wise Kaam donut chart"
            className="shrink-0"
          >
            <circle
              cx={donutCx}
              cy={donutCy}
              r={donutR}
              fill="none"
              stroke="#e2e8f0"
              strokeWidth={donutStrokeWidth}
            />
            {donutSlices.map((s, i) => (
              <path
                key={`${s.slice.category}-${i}`}
                d={s.d}
                stroke={s.color}
                strokeWidth={donutStrokeWidth}
                fill="none"
                strokeLinecap="butt"
              />
            ))}
            <text
              x={donutCx}
              y={donutCy - 4}
              textAnchor="middle"
              className="fill-slate-900 text-[15px] font-bold"
            >
              {donutTotal}
            </text>
            <text
              x={donutCx}
              y={donutCy + 12}
              textAnchor="middle"
              className="fill-slate-500 text-[10px] uppercase tracking-wide"
            >
              total
            </text>
          </svg>
          <ul className="min-w-0 flex-1 space-y-1.5">
            {categoryKaam.map((c, i) => (
              <li
                key={c.category}
                className="flex items-center gap-2 text-xs text-slate-700"
                data-testid={`kaam-category-legend-${c.category}`}
              >
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      DONUT_SLICE_COLORS[i % DONUT_SLICE_COLORS.length],
                  }}
                />
                <span className="min-w-0 flex-1 truncate font-medium text-slate-900">
                  {c.category}
                </span>
                <span className="tabular-nums text-slate-600">
                  {c.count} · {c.percentage}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
