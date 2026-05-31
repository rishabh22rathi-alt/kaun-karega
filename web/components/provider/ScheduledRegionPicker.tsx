"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Phase 2: future-region picker for the scheduled-paid-lower flow.
 *
 * Shown after the provider clicks a paid plan whose rank is BELOW the
 * current active plan (e.g. on ₹101 picking ₹31). The provider must
 * choose exactly `requiredCount` regions BEFORE we move to the
 * payment-terms modal — the regions become the active set when the
 * scheduled plan activates later (Phase 3).
 *
 * Data source: GET /api/area-intelligence/regions[?city=...]. Same
 * endpoint the register page already calls. Fetched on mount with no
 * caching layer — region catalogs are small (~25 rows for Jodhpur)
 * and the picker is short-lived.
 *
 * The component intentionally does NOT pre-fill the provider's current
 * regions. The future set is chosen explicitly so a provider switching
 * from "all Jodhpur" to "5 regions" doesn't accidentally inherit an
 * over-cap selection.
 *
 * Lifecycle: the parent conditionally mounts this component when the
 * provider is in the picking-regions phase. Selection state is local
 * and resets naturally on remount, so we don't need an `open` prop or
 * a reset effect.
 *
 * No edit-after-payment in Phase 2. Phase 3 will add a "change my
 * scheduled regions" surface; for now the choice is final at order
 * time and locked once the payment is captured.
 */

export type ScheduledRegionPickerProps = {
  requiredCount: number;
  // Optional city code (e.g. "JOD"). Forwarded to the regions endpoint
  // as ?city=. If omitted, the server falls back to its default city.
  cityCode?: string | null;
  // Friendly label for the plan being scheduled (e.g. "₹31 plan").
  // Shown in the title so the provider knows what they're picking for.
  targetPlanLabel: string;
  // Phase A: optional GST-inclusive charge summary (e.g.
  // "Total payable ₹36.58 (incl. 18% GST)"). Shown in the footer so the
  // scheduled-paid-lower flow surfaces what Razorpay will charge before
  // the provider commits region choices. The PaymentTermsModal (next
  // step) repeats the full base/GST/total breakdown.
  chargeSummaryLabel?: string;
  onCancel: () => void;
  // Called with the final, deduplicated, exactly-requiredCount-long
  // list of region_codes. Parent should advance to the terms modal.
  onConfirm: (regionCodes: string[]) => void;
};

type RegionApiRow = {
  region_code?: unknown;
  region_name?: unknown;
  areas?: unknown;
};

type RegionOption = {
  code: string;
  name: string;
  areas: string[];
};

type FetchState =
  | { kind: "loading" }
  | { kind: "ready"; regions: RegionOption[] }
  | { kind: "error"; message: string };

function parseRegionsResponse(payload: unknown): RegionOption[] {
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as { regions?: unknown };
  if (!Array.isArray(obj.regions)) return [];
  const out: RegionOption[] = [];
  for (const raw of obj.regions as RegionApiRow[]) {
    const code = String(raw?.region_code ?? "").trim();
    if (!code) continue;
    const name = String(raw?.region_name ?? "").trim() || code;
    const areas: string[] = [];
    if (Array.isArray(raw?.areas)) {
      for (const a of raw.areas as unknown[]) {
        const s = String(a ?? "").trim();
        if (s) areas.push(s);
      }
    }
    out.push({ code, name, areas });
  }
  return out;
}

export default function ScheduledRegionPicker({
  requiredCount,
  cityCode,
  targetPlanLabel,
  chargeSummaryLabel,
  onCancel,
  onConfirm,
}: ScheduledRegionPickerProps) {
  const [fetchState, setFetchState] = useState<FetchState>({ kind: "loading" });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  // Fetch regions catalog on mount. Re-fetches on each open: the
  // catalog is tiny, and admins occasionally toggle regions, so a
  // fresh read is preferable to a stale cached one.
  useEffect(() => {
    let cancelled = false;
    const url = cityCode
      ? `/api/area-intelligence/regions?city=${encodeURIComponent(cityCode)}`
      : "/api/area-intelligence/regions";
    fetch(url, { credentials: "same-origin" })
      .then(async (res) => {
        const json: unknown = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !json || typeof json !== "object") {
          setFetchState({
            kind: "error",
            message: "Could not load regions. Please try again.",
          });
          return;
        }
        const regions = parseRegionsResponse(json);
        if (regions.length === 0) {
          setFetchState({
            kind: "error",
            message: "No regions are available for selection right now.",
          });
          return;
        }
        setFetchState({ kind: "ready", regions });
      })
      .catch(() => {
        if (cancelled) return;
        setFetchState({
          kind: "error",
          message: "Network error while loading regions.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [cityCode]);

  // Escape closes the picker (cancel).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  const toggle = useCallback(
    (code: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(code)) {
          next.delete(code);
          return next;
        }
        // Hard cap at requiredCount so the user can't pick 6 and then
        // be told "too many" — the only way to exceed is to deselect
        // first. Simpler UX than a non-blocking error toast.
        if (next.size >= requiredCount) return prev;
        next.add(code);
        return next;
      });
    },
    [requiredCount]
  );

  const selectedCount = selected.size;
  const isComplete = selectedCount === requiredCount;
  const remaining = Math.max(0, requiredCount - selectedCount);

  const handleConfirm = useCallback(() => {
    if (!isComplete) return;
    // Deterministic order (lex by code) so the array is reproducible
    // across attempts. The server doesn't depend on order today, but
    // future audits comparing two attempts benefit from determinism.
    const codes = Array.from(selected).sort();
    onConfirm(codes);
  }, [isComplete, selected, onConfirm]);

  const regions: RegionOption[] = useMemo(
    () => (fetchState.kind === "ready" ? fetchState.regions : []),
    [fetchState]
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose future regions"
      data-testid="scheduled-region-picker"
      className="fixed inset-0 z-[55] flex items-end justify-center bg-slate-900/60 px-3 pb-6 pt-10 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200">
        <header className="border-b border-slate-200 px-5 py-4">
          <p className="text-base font-semibold text-slate-900">
            Choose your future regions
          </p>
          <p
            className="mt-1 text-xs leading-relaxed text-slate-600"
            data-testid="scheduled-region-picker-subtitle"
          >
            Pick exactly {requiredCount} region{requiredCount === 1 ? "" : "s"}{" "}
            that your {targetPlanLabel} will cover when it starts. Your current
            plan keeps running until expiry — these regions take over after that.
          </p>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {fetchState.kind === "loading" ? (
            <p
              data-testid="scheduled-region-picker-loading"
              className="py-6 text-center text-sm text-slate-500"
            >
              Loading regions…
            </p>
          ) : fetchState.kind === "error" ? (
            <p
              role="alert"
              data-testid="scheduled-region-picker-error"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
            >
              {fetchState.message}
            </p>
          ) : (
            <ul
              data-testid="scheduled-region-picker-list"
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
            >
              {regions.map((region) => {
                const isSelected = selected.has(region.code);
                const disabled =
                  !isSelected && selectedCount >= requiredCount;
                return (
                  <li key={region.code}>
                    <button
                      type="button"
                      data-testid={`scheduled-region-option-${region.code}`}
                      data-selected={isSelected ? "true" : "false"}
                      onClick={() => toggle(region.code)}
                      disabled={disabled}
                      className={`flex w-full flex-col items-start gap-1 rounded-xl border px-3 py-2 text-left text-sm transition ${
                        isSelected
                          ? "border-[#003d20] bg-[#003d20]/5 text-[#003d20]"
                          : disabled
                            ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                            : "border-slate-200 bg-white text-slate-700 hover:border-[#003d20]/40 hover:bg-[#003d20]/5"
                      }`}
                    >
                      <span className="font-semibold">{region.name}</span>
                      {region.areas.length > 0 ? (
                        <span className="text-xs text-slate-500">
                          {region.areas.slice(0, 3).join(", ")}
                          {region.areas.length > 3
                            ? ` +${region.areas.length - 3} more`
                            : ""}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-0.5">
            <p
              data-testid="scheduled-region-picker-count"
              className="text-xs font-medium text-slate-600"
            >
              {selectedCount} / {requiredCount} selected
              {remaining > 0
                ? ` — pick ${remaining} more`
                : " — ready to continue"}
            </p>
            {chargeSummaryLabel ? (
              <p
                data-testid="scheduled-region-picker-charge"
                className="text-xs font-semibold text-[#003d20]"
              >
                {chargeSummaryLabel}
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              data-testid="scheduled-region-picker-cancel"
              onClick={onCancel}
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="scheduled-region-picker-continue"
              disabled={!isComplete}
              onClick={handleConfirm}
              className="inline-flex items-center justify-center rounded-xl bg-[#003d20] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#002a16] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Continue
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
