"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Provider,
  ProviderStatus,
  getAllProviders,
} from "@/lib/api/providers";

const statusFilters: Array<ProviderStatus | "All"> = [
  "All",
  "Active",
  "Pending",
  "Blocked",
];

export default function AdminProviderListPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ProviderStatus | "All">("All");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const data = await getAllProviders();
        if (!mounted) return;
        setProviders(data);
      } catch (err) {
        console.error("Failed to load providers", err);
        if (mounted) setError("Unable to load providers right now.");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  // Client-side filtering on name/phone/category/area and status
  const filteredProviders = useMemo(() => {
    const term = search.toLowerCase();
    return providers.filter((provider) => {
      const matchesTerm =
        provider.name.toLowerCase().includes(term) ||
        provider.phone.toLowerCase().includes(term) ||
        provider.categories.some((c) => c.toLowerCase().includes(term)) ||
        provider.areas.some((area) => area.toLowerCase().includes(term));
      const matchesStatus = status === "All" || provider.status === status;
      return matchesTerm && matchesStatus;
    });
  }, [providers, search, status]);

  const stats = useMemo(() => {
    const total = providers.length;
    const active = providers.filter((p) => p.status === "Active").length;
    const pending = providers.filter((p) => p.status === "Pending").length;
    const blocked = providers.filter((p) => p.status === "Blocked").length;
    return { total, active, pending, blocked };
  }, [providers]);

  const statusBadge: Record<ProviderStatus, string> = {
    Active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    Pending: "bg-amber-50 text-amber-700 border-amber-200",
    Blocked: "bg-rose-50 text-rose-700 border-rose-200",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Provider Management
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">
            Service Providers
          </h1>
        </div>
        <button className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800">
          Add Provider
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {[
          { label: "Total", value: stats.total, accent: "bg-slate-900 text-white" },
          { label: "Active", value: stats.active, accent: "bg-emerald-50 text-emerald-700" },
          { label: "Pending", value: stats.pending, accent: "bg-amber-50 text-amber-700" },
          { label: "Blocked", value: stats.blocked, accent: "bg-rose-50 text-rose-700" },
        ].map((card) => (
          <div
            key={card.label}
            className={`rounded-2xl border border-slate-200 px-4 py-4 shadow-sm ${card.accent}`}
          >
            <p className="text-sm text-slate-600">{card.label}</p>
            <p className="text-2xl font-semibold">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex-1">
          <label className="text-xs font-medium text-slate-600">Search</label>
          <div className="mt-1 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm focus-within:ring-2 focus-within:ring-slate-900">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, phone, category, or area"
              className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
          </div>
        </div>
        <div className="w-full lg:w-56">
          <label className="text-xs font-medium text-slate-600">
            Status Filter
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ProviderStatus | "All")}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          >
            {statusFilters.map((option) => (
              <option key={option} value={option}>
                {option === "All" ? "All Providers" : option}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Providers table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Name / ID</th>
                <th className="px-4 py-3 font-semibold">Phone</th>
                <th className="px-4 py-3 font-semibold">Categories</th>
                <th className="px-4 py-3 font-semibold">Areas</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Tasks / Responses</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-800">
              {loading && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-6 text-center text-sm text-slate-500"
                  >
                    Loading providers...
                  </td>
                </tr>
              )}
              {!loading && error && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-6 text-center text-sm text-red-600"
                  >
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && filteredProviders.map((provider) => (
                <tr key={provider.id} className="transition-colors hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900">{provider.name}</p>
                    <p className="text-xs text-slate-500">{provider.id}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{provider.phone}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {provider.categories.map((category) => (
                        <span
                          key={category}
                          className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
                        >
                          {category}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {provider.areas.map((area) => (
                        <span
                          key={area}
                          className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"
                        >
                          {area}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
                        statusBadge[provider.status as ProviderStatus] ||
                        "bg-slate-100 text-slate-700 border-slate-200"
                      }`}
                    >
                      {provider.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {(provider.totalTasks ?? 0)} tasks / {(provider.totalResponses ?? 0)} responses
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:bg-slate-100">
                        View
                      </button>
                      <button className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800">
                        More
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && !error && filteredProviders.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-6 text-center text-sm text-slate-500"
                  >
                    No providers match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
