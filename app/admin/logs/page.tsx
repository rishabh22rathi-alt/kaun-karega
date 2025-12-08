"use client";

import { useEffect, useState } from "react";
import { ProviderLog, getAllLogs } from "@/lib/api/logs";

const badgeStyles: Record<string, string> = {
  Info: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Warning: "bg-amber-50 text-amber-700 border-amber-200",
  Blocked: "bg-rose-50 text-rose-700 border-rose-200",
};

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<ProviderLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const data = await getAllLogs();
        if (mounted) setLogs(data || []);
      } catch (err) {
        console.error("getAllLogs error", err);
        if (mounted) setError("Unable to load logs");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Provider Logs
        </p>
        <h1 className="text-2xl font-semibold text-slate-900">Activity & History</h1>
        <p className="text-sm text-slate-600">
          Review provider actions, last response times, and overall task history.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Log ID</th>
                <th className="px-4 py-3 font-semibold">Provider</th>
                <th className="px-4 py-3 font-semibold">Action</th>
                <th className="px-4 py-3 font-semibold">Last Response</th>
                <th className="px-4 py-3 font-semibold">Task History</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-800">
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-4 text-center text-slate-500">
                    Loading logs...
                  </td>
                </tr>
              )}
              {!loading && error && (
                <tr>
                  <td colSpan={6} className="px-4 py-4 text-center text-rose-600">
                    {error}
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {log.id}
                    </td>
                    <td className="px-4 py-3">{log.provider}</td>
                    <td className="px-4 py-3 text-slate-700">{log.action}</td>
                    <td className="px-4 py-3 text-slate-700">{log.lastResponse}</td>
                    <td className="px-4 py-3 text-slate-700">{log.taskHistory}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
                          badgeStyles[log.status] || "bg-slate-100 text-slate-700 border-slate-200"
                        }`}
                      >
                        {log.status}
                      </span>
                    </td>
                  </tr>
                ))}
              {!loading && !error && logs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-4 text-center text-slate-500">
                    No logs available.
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
