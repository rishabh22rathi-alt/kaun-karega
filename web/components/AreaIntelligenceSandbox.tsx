"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Sandbox-only experimental homepage component. Talks to:
//   GET /api/area-intelligence/suggest
//   GET /api/area-intelligence/resolve
// Does NOT replace the existing homepage area flow, does NOT touch live
// matching, /api/find-provider, /api/areas, provider registration, or any
// other production path. No writes. No UI it doesn't own.
//
// This component is meant to be mounted behind a hardcoded flag in
// app/page.tsx so it never appears publicly by default.

type Suggestion = {
  type: "alias" | "canonical_area" | "region";
  label: string;
  canonical_area: string | null;
  region_code: string;
  region_name: string;
};

type SuggestResponse = {
  ok?: boolean;
  query?: string;
  suggestions?: Suggestion[];
  error?: string;
};

type ResolveResponse =
  | {
      ok: true;
      input: string;
      match_type: "alias" | "canonical_area" | "region";
      alias?: string;
      canonical_area?: string | null;
      region_code: string;
      region_name: string | null;
    }
  | {
      ok: false;
      input: string;
      error: string;
    };

const SUGGEST_DEBOUNCE_MS = 150;

export default function AreaIntelligenceSandbox() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggLoading, setSuggLoading] = useState(false);
  const [suggError, setSuggError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [resolved, setResolved] = useState<ResolveResponse | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const skipQueryRef = useRef<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const runResolve = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setResolving(true);
    setResolveError(null);
    setResolved(null);
    try {
      const res = await fetch(
        `/api/area-intelligence/resolve?query=${encodeURIComponent(trimmed)}`,
        { cache: "no-store" }
      );
      const data = (await res.json()) as ResolveResponse;
      setResolved(data);
    } catch (err: any) {
      setResolveError(err?.message || "Network error");
    } finally {
      setResolving(false);
    }
  }, []);

  // Suggestion fetch — debounced + AbortController to drop stale results.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setSuggError(null);
      setSuggLoading(false);
      return;
    }
    if (skipQueryRef.current === trimmed) return;

    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setSuggLoading(true);
      setSuggError(null);
      try {
        const res = await fetch(
          `/api/area-intelligence/suggest?query=${encodeURIComponent(trimmed)}`,
          { cache: "no-store", signal: ctrl.signal }
        );
        const data = (await res.json()) as SuggestResponse;
        if (ctrl.signal.aborted) return;
        if (!res.ok || !data?.ok) {
          setSuggestions([]);
          setSuggError(data?.error || `HTTP ${res.status}`);
          return;
        }
        setSuggestions(data.suggestions ?? []);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        setSuggError(err?.message || "Network error");
        setSuggestions([]);
      } finally {
        if (!ctrl.signal.aborted) setSuggLoading(false);
      }
    }, SUGGEST_DEBOUNCE_MS);

    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [query]);

  // Close dropdown on outside click.
  useEffect(() => {
    if (!isOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [isOpen]);

  const pickSuggestion = (s: Suggestion) => {
    skipQueryRef.current = s.label;
    setQuery(s.label);
    setIsOpen(false);
    setSuggestions([]);
    void runResolve(s.label);
  };

  const showDropdown =
    isOpen &&
    query.trim().length >= 2 &&
    (suggLoading || suggError !== null || suggestions.length > 0);

  return (
    <div className="mx-auto w-full max-w-xl rounded-2xl border border-amber-300 bg-amber-50/40 p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-amber-200 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-900">
          Sandbox / Experimental
        </span>
        <span className="text-xs text-amber-800">
          Area Intelligence preview — not wired to provider matching.
        </span>
      </div>

      <label
        htmlFor="ai-sandbox-input"
        className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
      >
        Area / locality
      </label>
      <div ref={wrapRef} className="relative mt-1">
        <input
          id="ai-sandbox-input"
          type="text"
          value={query}
          onChange={(e) => {
            skipQueryRef.current = null;
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            if (query.trim().length >= 2) setIsOpen(true);
          }}
          placeholder="Start typing (e.g. bha, hc, sardarpura)…"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200"
          autoComplete="off"
        />
        {showDropdown ? (
          <Dropdown
            suggestions={suggestions}
            loading={suggLoading}
            error={suggError}
            onPick={pickSuggestion}
          />
        ) : null}
      </div>

      {resolving ? (
        <div className="mt-3 text-xs text-slate-500">Resolving…</div>
      ) : null}
      {resolveError ? (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {resolveError}
        </div>
      ) : null}
      {resolved ? <ResolvedCard result={resolved} /> : null}
    </div>
  );
}

function Dropdown({
  suggestions,
  loading,
  error,
  onPick,
}: {
  suggestions: Suggestion[];
  loading: boolean;
  error: string | null;
  onPick: (s: Suggestion) => void;
}) {
  return (
    <div
      role="listbox"
      className="absolute left-0 right-0 top-full z-10 mt-1 max-h-80 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg"
    >
      {loading ? (
        <div className="px-3 py-2 text-xs text-slate-500">Searching…</div>
      ) : error ? (
        <div className="px-3 py-2 text-xs text-rose-700">{error}</div>
      ) : suggestions.length === 0 ? (
        <div className="px-3 py-2 text-xs text-slate-500">No suggestions.</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {suggestions.map((s, i) => (
            <li key={`${s.type}-${s.region_code}-${s.label}-${i}`}>
              <button
                type="button"
                role="option"
                onClick={() => onPick(s)}
                className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">
                    {s.label}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-500">
                    {s.region_name || s.region_code}
                    {s.canonical_area && s.canonical_area !== s.label ? (
                      <span>
                        {" "}
                        · canonical:{" "}
                        <span className="text-slate-700">
                          {s.canonical_area}
                        </span>
                      </span>
                    ) : null}
                  </div>
                </div>
                <TypeBadge type={s.type} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TypeBadge({ type }: { type: Suggestion["type"] }) {
  const tone =
    type === "alias"
      ? "bg-sky-100 text-sky-800"
      : type === "canonical_area"
        ? "bg-emerald-100 text-emerald-800"
        : "bg-violet-100 text-violet-800";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}
    >
      {type}
    </span>
  );
}

function ResolvedCard({ result }: { result: ResolveResponse }) {
  if (!result.ok) {
    return (
      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <div className="font-semibold">No match found</div>
        <div className="mt-0.5 text-amber-800">
          Input:{" "}
          <code className="rounded bg-white/60 px-1 py-0.5">
            {result.input || "(empty)"}
          </code>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold text-emerald-800">
          Match found
        </div>
        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
          {result.match_type}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
        {result.alias ? (
          <>
            <dt className="font-semibold uppercase tracking-wide text-slate-500">
              alias
            </dt>
            <dd className="text-slate-800">{result.alias}</dd>
          </>
        ) : null}
        {result.canonical_area ? (
          <>
            <dt className="font-semibold uppercase tracking-wide text-slate-500">
              canonical_area
            </dt>
            <dd className="text-slate-800">{result.canonical_area}</dd>
          </>
        ) : null}
        <dt className="font-semibold uppercase tracking-wide text-slate-500">
          region
        </dt>
        <dd className="text-slate-800">
          {result.region_code}
          {result.region_name ? ` — ${result.region_name}` : ""}
        </dd>
      </dl>
    </div>
  );
}
