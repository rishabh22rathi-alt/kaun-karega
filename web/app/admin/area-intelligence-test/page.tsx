"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Sandbox-only admin tester for /api/area-intelligence/resolve and
// /api/area-intelligence/suggest. Read-only: no DB writes, no live flow
// integration. Lives under the existing /admin/* route-protected layout
// so no extra gating needed.

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

const SUGGEST_DEBOUNCE_MS = 150;

export default function AreaIntelligenceTestPage() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [result, setResult] = useState<ResolveResponse | null>(null);

  // Suggestion state
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggLoading, setSuggLoading] = useState(false);
  const [suggError, setSuggError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  // Suppresses the suggestion fetch for the single value the user just
  // picked from the dropdown — without this, clicking a suggestion would
  // immediately re-open the dropdown for the same string.
  const skipQueryRef = useRef<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const runResolve = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setLoading(true);
    setNetworkError(null);
    setResult(null);
    try {
      const res = await fetch(
        `/api/area-intelligence/resolve?query=${encodeURIComponent(trimmed)}`,
        { cache: "no-store" }
      );
      const data = (await res.json()) as ResolveResponse;
      setResult(data);
    } catch (err: any) {
      setNetworkError(err?.message || "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setIsOpen(false);
    void runResolve(query);
  };

  const pickSuggestion = (s: Suggestion) => {
    skipQueryRef.current = s.label;
    setQuery(s.label);
    setIsOpen(false);
    setSuggestions([]);
    void runResolve(s.label);
  };

  // Suggestion fetch: debounced, AbortController-guarded so a fast typist
  // doesn't see stale results win the race.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setSuggError(null);
      setSuggLoading(false);
      return;
    }
    if (skipQueryRef.current === trimmed) {
      // One-shot skip for the value the user just picked.
      return;
    }

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

  // Close dropdown when clicking outside the input/dropdown wrapper.
  useEffect(() => {
    if (!isOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [isOpen]);

  const showDropdown =
    isOpen &&
    query.trim().length >= 2 &&
    (suggLoading || suggError !== null || suggestions.length > 0);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Area Intelligence Test
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Sandbox tester for{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-800">
              /api/area-intelligence/resolve
            </code>
            . Suggestions come from{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-800">
              /api/area-intelligence/suggest
            </code>
            . Read-only — does not affect live matching or any other flow.
          </p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <label
            htmlFor="ai-query"
            className="block text-sm font-semibold text-slate-700"
          >
            Area / alias query
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <div ref={wrapRef} className="relative flex-1">
              <input
                id="ai-query"
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
                placeholder="e.g. HC Road, Sardarpura, Jaljog-Residency Belt"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                disabled={loading}
                autoComplete="off"
              />
              {showDropdown ? (
                <SuggestionDropdown
                  suggestions={suggestions}
                  loading={suggLoading}
                  error={suggError}
                  onPick={pickSuggestion}
                />
              ) : null}
            </div>
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="inline-flex shrink-0 items-center justify-center rounded-lg bg-[#003d20] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#002a16] disabled:opacity-60"
            >
              {loading ? "Resolving…" : "Resolve Area"}
            </button>
          </div>
        </form>

        {networkError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {networkError}
          </div>
        ) : null}

        {result ? <ResultCard result={result} /> : null}
      </div>
    </main>
  );
}

function SuggestionDropdown({
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
                        <span className="text-slate-700">{s.canonical_area}</span>
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

function ResultCard({ result }: { result: ResolveResponse }) {
  if (!result.ok) {
    return (
      <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-amber-900">
              No match found
            </div>
            <div className="mt-0.5 text-xs text-amber-800">
              Input:{" "}
              <code className="rounded bg-white/60 px-1 py-0.5">
                {result.input || "(empty)"}
              </code>
            </div>
          </div>
        </div>
        {result.error ? (
          <div className="text-xs text-amber-800">{result.error}</div>
        ) : null}
        <RawJson result={result} />
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-emerald-800">
            Match found
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            Input:{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5">
              {result.input}
            </code>
          </div>
        </div>
        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-800">
          {result.match_type}
        </span>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
        <Field label="match_type" value={result.match_type} />
        {result.alias ? <Field label="alias" value={result.alias} /> : null}
        {result.canonical_area ? (
          <Field label="canonical_area" value={result.canonical_area} />
        ) : null}
        <Field label="region_code" value={result.region_code} />
        <Field label="region_name" value={result.region_name ?? "—"} />
      </dl>

      <RawJson result={result} />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="text-slate-800">{value}</dd>
    </>
  );
}

function RawJson({ result }: { result: ResolveResponse }) {
  return (
    <details className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
      <summary className="cursor-pointer font-semibold text-slate-600">
        Raw JSON
      </summary>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-slate-700">
        {JSON.stringify(result, null, 2)}
      </pre>
    </details>
  );
}
