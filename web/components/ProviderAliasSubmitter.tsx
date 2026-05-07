"use client";

import { useEffect, useState } from "react";

type Props = {
  providerId: string;
  canonicalCategory: string;
};

type ApiSuggestion = {
  label: string;
  canonical: string;
  type: "canonical" | "alias";
  aliasType?: string;
};

type ApiCategoriesResponse = {
  ok?: boolean;
  suggestions?: ApiSuggestion[];
};

type SubmittedCustom = {
  alias: string;
  status: "pending" | "error";
  error?: string;
};

function humanizeAliasError(code: string): string {
  switch (code) {
    case "ALIAS_ALREADY_EXISTS":
      return "Already live or pending";
    case "ALIAS_COLLIDES_WITH_CANONICAL":
      return "Matches existing category";
    case "PROVIDER_DOES_NOT_OFFER_CATEGORY":
      return "Not your category";
    case "ALIAS_TOO_LONG":
      return "Too long";
    case "MISSING_FIELDS":
      return "Empty term";
    case "PROVIDER_NOT_FOUND":
    case "CANONICAL_CATEGORY_NOT_FOUND":
      return "Profile not loaded";
    default:
      return "Submit failed";
  }
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Provider work-terms / aliases panel. Two distinct, non-overlapping flows:
 *
 *   1. LIVE CHIPS  — already approved (active=true, alias_type='work_tag') in
 *      category_aliases for the provider's canonical. Tapping AUTO-SAVES the
 *      chip to provider_work_terms via /api/provider/work-terms (POST/DELETE).
 *      No admin review. No /api/provider/aliases call.
 *
 *   2. CUSTOM TYPED — never seen before. Goes to /api/provider/aliases as
 *      active=false (pending admin review). When approved by an admin, it
 *      becomes a live chip on the next page load and the provider can tap
 *      it to save it as a work term.
 *
 * The provider's saved work terms are loaded on mount and pre-mark the
 * matching chips as selected. Each chip toggle is an optimistic UI update
 * with an HTTP call in the background.
 */
export default function ProviderAliasSubmitter({
  providerId,
  canonicalCategory,
}: Props) {
  // Live chips from Supabase.
  const [approvedAliases, setApprovedAliases] = useState<string[]>([]);
  const [aliasesError, setAliasesError] = useState<string | null>(null);

  // Provider's saved work-term selections (server truth, optimistic UI).
  const [savedTerms, setSavedTerms] = useState<string[]>([]);
  const [pendingChip, setPendingChip] = useState<Set<string>>(new Set());
  const [savedTermsError, setSavedTermsError] = useState<string | null>(null);

  // Custom typed alias submission (separate flow).
  const [customValue, setCustomValue] = useState("");
  const [customSubmitting, setCustomSubmitting] = useState(false);
  const [submittedCustoms, setSubmittedCustoms] = useState<SubmittedCustom[]>(
    []
  );

  const trimmedCustom = customValue.trim();
  const customIsValid =
    trimmedCustom.length > 0 && trimmedCustom.length <= 80;

  // Load: live chips + provider's saved work terms in parallel.
  useEffect(() => {
    if (!canonicalCategory) return;
    let ignore = false;

    const loadAll = async () => {
      try {
        const [aliasesRes, savedRes] = await Promise.all([
          fetch("/api/categories?include=aliases", { cache: "no-store" }),
          fetch("/api/provider/work-terms", { cache: "no-store" }),
        ]);
        if (ignore) return;

        // Live chips
        const aliasesData = (await aliasesRes
          .json()
          .catch(() => null)) as ApiCategoriesResponse | null;
        if (!aliasesRes.ok || !aliasesData?.ok) {
          setAliasesError("Could not load suggestions.");
          setApprovedAliases([]);
        } else {
          const matched = (aliasesData.suggestions || [])
            .filter((s) => s.type === "alias" && s.aliasType === "work_tag")
            .filter(
              (s) =>
                norm(String(s.canonical || "")) === norm(canonicalCategory)
            )
            .map((s) => String(s.label || ""))
            .filter((label) => label.length > 0);
          setApprovedAliases(matched);
          setAliasesError(null);
        }

        // Saved provider work terms
        const savedData = (await savedRes
          .json()
          .catch(() => null)) as
          | { ok?: boolean; items?: Array<{ alias: string }> }
          | null;
        if (!savedRes.ok || !savedData?.ok) {
          setSavedTermsError("Could not load your saved work terms.");
          setSavedTerms([]);
        } else {
          setSavedTerms(
            (savedData.items || []).map((row) => String(row.alias || ""))
          );
          setSavedTermsError(null);
        }
      } catch {
        if (ignore) return;
        setAliasesError("Could not load suggestions.");
        setSavedTermsError("Could not load your saved work terms.");
      }
    };

    void loadAll();
    return () => {
      ignore = true;
    };
  }, [canonicalCategory]);

  const isSavedTerm = (label: string) =>
    savedTerms.some((s) => norm(s) === norm(label));

  const isPendingChip = (label: string) =>
    Array.from(pendingChip).some((s) => norm(s) === norm(label));

  // Auto-save / auto-remove on chip tap.
  const toggleLiveChip = async (label: string) => {
    const wasSelected = isSavedTerm(label);
    if (isPendingChip(label) || !providerId || !canonicalCategory) return;

    // Optimistic UI flip
    setPendingChip((prev) => new Set(prev).add(label));
    setSavedTerms((prev) =>
      wasSelected
        ? prev.filter((s) => norm(s) !== norm(label))
        : [...prev, label]
    );

    try {
      const res = wasSelected
        ? await fetch(
            `/api/provider/work-terms?alias=${encodeURIComponent(label)}`,
            { method: "DELETE" }
          )
        : await fetch("/api/provider/work-terms", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              alias: label,
              canonicalCategory,
            }),
          });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!res.ok || !data?.ok) {
        // Surface the server-side error code so future failures are
        // diagnosable from the UI alone.
        const code = String(data?.error || `HTTP_${res.status}`);
        throw new Error(code);
      }
    } catch (err) {
      // Revert optimistic update on failure.
      setSavedTerms((prev) =>
        wasSelected
          ? [...prev, label]
          : prev.filter((s) => norm(s) !== norm(label))
      );
      const code = err instanceof Error ? err.message : "save_failed";
      setSavedTermsError(`Could not save that change (${code}). Please try again.`);
    } finally {
      setPendingChip((prev) => {
        const next = new Set(prev);
        next.delete(label);
        return next;
      });
    }
  };

  const submitCustom = async () => {
    if (!customIsValid || customSubmitting) return;
    if (!providerId || !canonicalCategory) return;

    setCustomSubmitting(true);
    try {
      const res = await fetch("/api/provider/aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          alias: trimmedCustom,
          canonicalCategory,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        setSubmittedCustoms((prev) => [
          {
            alias: trimmedCustom,
            status: "error",
            error: humanizeAliasError(String(data?.error || "")),
          },
          ...prev,
        ]);
        return;
      }
      setSubmittedCustoms((prev) => [
        { alias: trimmedCustom, status: "pending" },
        ...prev,
      ]);
      setCustomValue("");
    } catch {
      setSubmittedCustoms((prev) => [
        {
          alias: trimmedCustom,
          status: "error",
          error: "Network error",
        },
        ...prev,
      ]);
    } finally {
      setCustomSubmitting(false);
    }
  };

  const showChipsSection = approvedAliases.length > 0;

  return (
    <div className="mt-5 rounded-2xl border border-orange-200 bg-orange-50/60 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#003d20]">
        Work terms under{" "}
        <span className="font-bold">{canonicalCategory}</span>
      </p>
      <p className="mt-1 text-xs leading-5 text-slate-600">
        Live terms are already approved. Custom terms are reviewed before
        going live.
      </p>

      {showChipsSection ? (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Live work terms (tap to save as yours)
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {approvedAliases.map((label) => {
              const isSelected = isSavedTerm(label);
              const pending = isPendingChip(label);
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => void toggleLiveChip(label)}
                  aria-pressed={isSelected}
                  disabled={pending}
                  className={
                    isSelected
                      ? "inline-flex items-center gap-1 rounded-full border border-[#003d20] bg-[#003d20] px-3 py-1 text-xs font-semibold text-white shadow-sm transition disabled:opacity-60"
                      : "inline-flex items-center gap-1 rounded-full border border-orange-300 bg-white px-3 py-1 text-xs font-semibold text-[#003d20] transition hover:border-orange-400 hover:bg-orange-50 disabled:opacity-60"
                  }
                  title={
                    isSelected
                      ? "Saved as your work term — tap to remove"
                      : "Tap to save as your work term"
                  }
                >
                  {isSelected ? <span aria-hidden="true">✓</span> : null}
                  {label}
                </button>
              );
            })}
          </div>
          {savedTermsError ? (
            <p className="mt-2 text-xs text-rose-600">{savedTermsError}</p>
          ) : null}
        </div>
      ) : aliasesError ? (
        <p className="mt-3 text-xs text-rose-600">{aliasesError}</p>
      ) : null}

      <div className="mt-4 border-t border-orange-200/60 pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Add a new work term (admin review)
        </p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <input
            type="text"
            value={customValue}
            onChange={(event) => setCustomValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submitCustom();
              }
            }}
            placeholder="Add your own work term"
            maxLength={80}
            aria-label="Add custom work term"
            disabled={customSubmitting}
            className="flex-1 rounded-xl border border-orange-200 bg-white px-3 py-2 text-sm text-[#003d20] placeholder:text-slate-400 focus:border-[#f97316] focus:outline-none focus:ring-2 focus:ring-[#f97316]/20 disabled:bg-slate-50 disabled:text-slate-500"
          />
          <button
            type="button"
            onClick={() => void submitCustom()}
            disabled={!customIsValid || customSubmitting}
            className="inline-flex shrink-0 items-center justify-center rounded-xl bg-[#003d20] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#002a16] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[#003d20] disabled:hover:shadow-sm"
          >
            {customSubmitting ? "Submitting…" : "Submit for review"}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          Up to 80 characters. New terms stay pending until an admin
          approves them.
        </p>
      </div>

      {submittedCustoms.length > 0 ? (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Submitted in this session
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {submittedCustoms.map((item, idx) => {
              const styles =
                item.status === "pending"
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-rose-200 bg-rose-50 text-rose-700";
              const trailing =
                item.status === "pending"
                  ? "Pending admin approval"
                  : item.error || "Failed";
              return (
                <span
                  key={`${item.alias}-${idx}`}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${styles}`}
                  title={
                    item.status === "error"
                      ? `Error: ${item.error}`
                      : "Pending admin approval"
                  }
                >
                  {item.alias}
                  <span className="text-[10px] font-medium">· {trailing}</span>
                </span>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
