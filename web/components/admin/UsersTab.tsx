"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, X } from "lucide-react";

// Users accordion for /admin/dashboard.
//
// Reads:   GET /api/admin/users
// Mutates: none — admin-only read surface, no mutations.
//
// Mirrors the open/close/loading/error UX of ProvidersTab / CategoryTab /
// AreaTab so the four cards feel like one component family.

type UserRow = {
  phone: string;
  name: string | null;
  created_at: string | null;
  totalRequests: number;
  latestRequestAt: string | null;
};

type LoadResponse = {
  success?: boolean;
  totalUsers?: number;
  users?: UserRow[];
  error?: string;
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return "—";
  try {
    return new Date(ts).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date(ts).toISOString();
  }
}

export default function UsersTab() {
  const [isOpen, setIsOpen] = useState(false);
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [totalUsers, setTotalUsers] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");

  // Normalize search input by stripping non-digits. Matching is then a
  // simple substring check against each user phone's last-10-digit form
  // (the canonical comparison key used by the backend / submit-request).
  const searchDigits = useMemo(
    () => searchInput.replace(/\D/g, "").slice(0, 15),
    [searchInput]
  );

  const filteredUsers = useMemo(() => {
    if (!users) return null;
    if (!searchDigits) return users;
    return users.filter((u) => {
      const phone10 = String(u.phone).replace(/\D/g, "").slice(-10);
      return phone10.includes(searchDigits);
    });
  }, [users, searchDigits]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    // Loading + error reset are intentionally synchronous so the spinner
    // appears before the fetch starts. Matches the lazy-load pattern used
    // by CategoryTab / AreaTab on accordion open.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    fetch("/api/admin/users", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as LoadResponse;
        if (cancelled) return;
        if (!res.ok || !json?.success) {
          setError(json?.error || `Failed to load users (${res.status})`);
          setUsers([]);
          setTotalUsers(0);
          return;
        }
        setUsers(Array.isArray(json.users) ? json.users : []);
        setTotalUsers(
          typeof json.totalUsers === "number" ? json.totalUsers : 0
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Network error");
        setUsers([]);
        setTotalUsers(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const summary =
    totalUsers !== null
      ? `${totalUsers} registered user${totalUsers === 1 ? "" : "s"}`
      : "Registered users and request activity";

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-controls="users-tab-body"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-slate-50"
      >
        <div className="min-w-0">
          <p className="text-base font-semibold text-slate-900">Users</p>
          <p className="mt-0.5 text-xs text-slate-500">{summary}</p>
        </div>
        <ChevronDown
          aria-hidden="true"
          className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${
            isOpen ? "rotate-180" : "rotate-0"
          }`}
        />
      </button>

      {isOpen && (
        <div id="users-tab-body" className="border-t border-slate-200 px-5 py-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">
              Registered Users:{" "}
              <span className="font-bold text-[#003d20]">
                {totalUsers !== null ? totalUsers : "—"}
              </span>
            </p>
            {users && users.length > 0 && searchDigits && filteredUsers && (
              <p className="text-xs text-slate-600">
                Showing {filteredUsers.length} of {users.length} users
              </p>
            )}
          </div>

          <div className="mb-4">
            <div className="relative">
              <input
                type="search"
                inputMode="numeric"
                autoComplete="off"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search phone number..."
                aria-label="Search users by phone number"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#003d20] focus:outline-none focus:ring-1 focus:ring-[#003d20]"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              Search by full or partial phone number.
            </p>
          </div>

          {error && (
            <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {loading && !users && (
            <p className="rounded-lg border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
              Loading users…
            </p>
          )}

          {!loading && users && users.length === 0 && !error && (
            <p className="rounded-lg border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
              No registered users found yet.
            </p>
          )}

          {users &&
            users.length > 0 &&
            filteredUsers &&
            filteredUsers.length === 0 && (
              <p className="rounded-lg border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
                No users found for this phone number.
              </p>
            )}

          {users && users.length > 0 && filteredUsers && filteredUsers.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Phone
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Name
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Requests Generated
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Latest Request
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredUsers.map((u) => (
                    <tr key={u.phone}>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-slate-900">
                        {u.phone}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">
                        {u.name && u.name.trim() ? u.name : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-slate-900">
                        {u.totalRequests}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">
                        {formatDate(u.latestRequestAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
