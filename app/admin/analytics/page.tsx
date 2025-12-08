"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AreaCategoryMatrixRow,
  LeadStatEntry,
  LeadStats,
  ProviderStat,
  getAreaCategoryMatrix,
  getLeadStats,
  getProviderStats,
} from "@/lib/api/analytics";
import { getTasksWithoutResponse, NoResponseTask } from "@/lib/api/tasks";

type Summary = {
  today: number;
  week: number;
  month: number;
  total: number;
};

function computeSummaries(daily: LeadStatEntry[]): Summary {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const startOfWeek = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  let today = 0;
  let week = 0;
  let month = 0;
  let total = 0;

  daily.forEach((entry) => {
    const dateStr = String(entry.date);
    const dateObj = new Date(dateStr);
    const count = entry.leadCount || 0;
    total += count;
    if (dateStr === todayStr) today += count;
    if (dateObj >= startOfWeek) week += count;
    if (dateObj.getMonth() === currentMonth && dateObj.getFullYear() === currentYear) {
      month += count;
    }
  });

  return { today, week, month, total };
}

function heatClass(leads: number) {
  if (leads > 20) return "bg-emerald-100 text-emerald-800";
  if (leads > 10) return "bg-yellow-100 text-yellow-800";
  return "bg-red-100 text-red-800";
}

export default function AdminAnalyticsPage() {
  const [leadStats, setLeadStats] = useState<LeadStats>({ daily: [], byArea: [], byCategory: [] });
  const [matrix, setMatrix] = useState<AreaCategoryMatrixRow[]>([]);
  const [providerStats, setProviderStats] = useState<ProviderStat[]>([]);
  const [noResponseTasks, setNoResponseTasks] = useState<NoResponseTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const [leadResp, matrixResp, provResp, tasksResp] = await Promise.all([
          getLeadStats(),
          getAreaCategoryMatrix(),
          getProviderStats(),
          getTasksWithoutResponse(),
        ]);
        setLeadStats(leadResp);
        setMatrix(matrixResp);
        setProviderStats(provResp);
        setNoResponseTasks(tasksResp);
      } catch (err) {
        console.error(err);
        setError("Unable to load analytics right now.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const summary = useMemo(() => computeSummaries(leadStats.daily || []), [leadStats.daily]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">Analytics</p>
        <h1 className="text-2xl font-semibold text-slate-900">Analytics Dashboard</h1>
        <p className="text-sm text-slate-600">
          Complete insights of Kaun Karega operations.
        </p>
      </div>

      {loading && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
          Loading analytics...
        </div>
      )}

      {!loading && error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 shadow-sm">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            {[
              { label: "Today", value: summary.today, className: "bg-slate-900 text-white" },
              { label: "This Week", value: summary.week, className: "bg-blue-50 text-blue-700" },
              { label: "This Month", value: summary.month, className: "bg-emerald-50 text-emerald-700" },
              { label: "All Time", value: summary.total, className: "bg-slate-100 text-slate-700" },
            ].map((card) => (
              <div
                key={card.label}
                className={`rounded-2xl border border-slate-200 px-4 py-4 shadow-sm ${card.className}`}
              >
                <p className="text-sm">{card.label}</p>
                <p className="text-2xl font-semibold">{card.value}</p>
              </div>
            ))}
          </div>

          {/* Leads by Area */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-lg font-semibold text-slate-900">Leads by Area</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Area</th>
                    <th className="px-4 py-3 font-semibold">Leads</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm text-slate-800">
                  {leadStats.byArea.map((row) => (
                    <tr key={row.area} className="hover:bg-slate-50">
                      <td className="px-4 py-3">{row.area || "-"}</td>
                      <td className="px-4 py-3">{row.totalLeads}</td>
                    </tr>
                  ))}
                  {leadStats.byArea.length === 0 && (
                    <tr>
                      <td colSpan={2} className="px-4 py-6 text-center text-sm text-slate-500">
                        No data yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Leads by Category */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-lg font-semibold text-slate-900">Leads by Category</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Category</th>
                    <th className="px-4 py-3 font-semibold">Leads</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm text-slate-800">
                  {leadStats.byCategory.map((row) => (
                    <tr key={row.category} className="hover:bg-slate-50">
                      <td className="px-4 py-3">{row.category || "-"}</td>
                      <td className="px-4 py-3">{row.totalLeads}</td>
                    </tr>
                  ))}
                  {leadStats.byCategory.length === 0 && (
                    <tr>
                      <td colSpan={2} className="px-4 py-6 text-center text-sm text-slate-500">
                        No data yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Area x Category Heatmap */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-lg font-semibold text-slate-900">Area × Category Heatmap</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Area</th>
                    <th className="px-4 py-3 font-semibold">Category</th>
                    <th className="px-4 py-3 font-semibold">Lead Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm text-slate-800">
                  {matrix.map((row, idx) => (
                    <tr key={`${row.area}-${row.category}-${idx}`} className="hover:bg-slate-50">
                      <td className="px-4 py-3">{row.area}</td>
                      <td className="px-4 py-3">{row.category}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${heatClass(
                            row.leads
                          )}`}
                        >
                          {row.leads}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {matrix.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-sm text-slate-500">
                        No data yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Provider Performance */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-lg font-semibold text-slate-900">Provider Performance</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Provider</th>
                    <th className="px-4 py-3 font-semibold">Phone</th>
                    <th className="px-4 py-3 font-semibold">Tasks Sent</th>
                    <th className="px-4 py-3 font-semibold">Tasks Accepted</th>
                    <th className="px-4 py-3 font-semibold">Response Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm text-slate-800">
                  {providerStats.map((prov) => (
                    <tr key={prov.providerId} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {prov.name || prov.providerId}
                      </td>
                      <td className="px-4 py-3">{prov.phone || "-"}</td>
                      <td className="px-4 py-3">{prov.tasksSent}</td>
                      <td className="px-4 py-3">{prov.tasksAccepted}</td>
                      <td className="px-4 py-3">{prov.responseRate}%</td>
                    </tr>
                  ))}
                  {providerStats.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">
                        No provider performance data yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tasks with No Response */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-lg font-semibold text-slate-900">Tasks With No Response</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Task ID</th>
                    <th className="px-4 py-3 font-semibold">Area</th>
                    <th className="px-4 py-3 font-semibold">Category</th>
                    <th className="px-4 py-3 font-semibold">Created At</th>
                    <th className="px-4 py-3 font-semibold">Providers Notified</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm text-slate-800">
                  {noResponseTasks.map((task) => (
                    <tr key={task.taskId} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {task.taskId}
                      </td>
                      <td className="px-4 py-3">{task.area}</td>
                      <td className="px-4 py-3">{task.category}</td>
                      <td className="px-4 py-3">{task.createdAt || "-"}</td>
                      <td className="px-4 py-3">{task.totalProvidersNotified ?? 0}</td>
                    </tr>
                  ))}
                  {noResponseTasks.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">
                        All tasks have at least one response.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
