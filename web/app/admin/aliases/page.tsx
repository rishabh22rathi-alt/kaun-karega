"use client";

import { useCallback, useEffect, useState } from "react";

type PendingAlias = {
  alias: string;
  canonicalCategory: string;
  active: boolean;
  aliasType: string | null;
  createdAt: string | null;
  submittedByProviderId: string | null;
  submittedByName: string | null;
  submittedByPhone: string | null;
};

type AdminAliasesResponse = {
  ok?: boolean;
  aliases?: PendingAlias[];
  error?: string;
};

function fmt(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("en-IN");
}

export default function AdminAliasesPage() {
  const [rows, setRows] = useState<PendingAlias[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingAlias, setActingAlias] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejectReasonByAlias, setRejectReasonByAlias] = useState<
    Record<string, string>
  >({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/aliases?status=pending", {
        cache: "no-store",
      });
      const data = (await res.json()) as AdminAliasesResponse;
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Failed to load pending aliases.");
        setRows([]);
      } else {
        setRows(data.aliases || []);
      }
    } catch {
      setError("Network error while loading pending aliases.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (alias: string, action: "approve" | "reject") => {
    setActingAlias(alias);
    setActionError(null);
    try {
      const reason =
        action === "reject"
          ? (rejectReasonByAlias[alias] || "").trim()
          : undefined;
      const res = await fetch("/api/admin/aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, alias, reason }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data?.ok) {
        setActionError(`${action.toUpperCase()} failed: ${data?.error || "unknown"}`);
        return;
      }
      // Optimistic remove from the list.
      setRows((prev) => prev.filter((r) => r.alias !== alias));
      setRejectReasonByAlias((prev) => {
        const next = { ...prev };
        delete next[alias];
        return next;
      });
    } catch {
      setActionError(`${action.toUpperCase()} failed: network error`);
    } finally {
      setActingAlias(null);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              Pending Alias Review
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Provider-submitted work terms awaiting approval. Approving
              flips <code>category_aliases.active</code> to true; rejecting
              deletes the row. Both actions notify the submitting provider.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
        {actionError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {actionError}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {loading && rows.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-slate-500">
              Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-slate-500">
              No pending aliases.
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Alias</th>
                  <th className="px-4 py-3 font-semibold">Canonical</th>
                  <th className="px-4 py-3 font-semibold">Submitted by</th>
                  <th className="px-4 py-3 font-semibold">Created</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const isActing = actingAlias === row.alias;
                  return (
                    <tr key={row.alias} className="align-top">
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {row.alias}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {row.canonicalCategory}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {row.submittedByName || row.submittedByProviderId || "—"}
                        {row.submittedByPhone ? (
                          <div className="text-xs text-slate-500">
                            {row.submittedByPhone}
                          </div>
                        ) : null}
                        {!row.submittedByProviderId ? (
                          <div className="text-[10px] text-amber-700">
                            legacy row · no submitter recorded
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {fmt(row.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                          <button
                            type="button"
                            onClick={() => void act(row.alias, "approve")}
                            disabled={isActing}
                            className="inline-flex shrink-0 items-center justify-center rounded-lg bg-[#003d20] px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#002a16] disabled:opacity-60"
                          >
                            {isActing ? "…" : "Approve"}
                          </button>
                          <div className="flex flex-col gap-1">
                            <input
                              type="text"
                              value={rejectReasonByAlias[row.alias] || ""}
                              onChange={(event) =>
                                setRejectReasonByAlias((prev) => ({
                                  ...prev,
                                  [row.alias]: event.target.value,
                                }))
                              }
                              placeholder="Reject reason (optional)"
                              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 placeholder:text-slate-400 focus:border-rose-300 focus:outline-none focus:ring-2 focus:ring-rose-200"
                              disabled={isActing}
                            />
                            <button
                              type="button"
                              onClick={() => void act(row.alias, "reject")}
                              disabled={isActing}
                              className="inline-flex shrink-0 items-center justify-center rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-bold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-xs text-slate-500">
          Auth note: this page assumes admin access via existing /admin/*
          route protection. Per-request admin gating on the API endpoint is a
          follow-up.
        </p>
      </div>
    </main>
  );
}
