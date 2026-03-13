"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuthSession } from "@/lib/auth";

type RequestRow = {
  taskId: string;
  category: string;
  area: string;
  details: string;
  status: string;
  createdAt: string;
};

type RawRequest = Record<string, unknown>;

const normalizeRequest = (item: RawRequest): RequestRow => ({
  taskId:
    String(
      item.TaskID ??
        item.taskId ??
        item.id ??
        item.task_id ??
        ""
    ) || "-",
  category: String(item.Category ?? item.category ?? "") || "-",
  area: String(item.Area ?? item.area ?? "") || "-",
  details: String(item.Details ?? item.details ?? "") || "-",
  status: String(item.Status ?? item.status ?? "") || "-",
  createdAt: String(item.CreatedAt ?? item.createdAt ?? "") || "-",
});

export default function MyRequestsList() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [error, setError] = useState("");
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    const session = getAuthSession();
    if (!session?.phone) {
      setHasSession(false);
      setLoading(false);
      return;
    }

    setHasSession(true);

    const loadRequests = async () => {
      try {
        const res = await fetch("/api/my-requests", { cache: "no-store" });
        if (res.status === 401) {
          setHasSession(false);
          router.replace("/login");
          return;
        }
        const data = await res.json();
        if (!res.ok || data?.ok !== true) {
          throw new Error(data?.error || "Failed to load requests");
        }

        const list = Array.isArray(data?.requests)
          ? data.requests
          : Array.isArray(data?.tasks)
            ? data.tasks
            : [];
        const normalized = list.map((item: RawRequest) =>
          normalizeRequest(item)
        );
        setRows(normalized);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load requests"
        );
      } finally {
        setLoading(false);
      }
    };

    loadRequests();
  }, [router]);

  const total = useMemo(() => rows.length, [rows]);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto w-full max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          Loading your requests...
        </div>
      </main>
    );
  }

  if (!hasSession) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto w-full max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          Please log in to view your requests.
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto w-full max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 text-red-600 shadow-sm">
          {error}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">
            My Requests
          </h1>
          <p className="text-sm text-slate-600">Total requests: {total}</p>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            No requests yet. Create your first task from home.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="py-2 pr-3 font-semibold">Task ID</th>
                  <th className="py-2 pr-3 font-semibold">Category</th>
                  <th className="py-2 pr-3 font-semibold">Area</th>
                  <th className="py-2 pr-3 font-semibold">Details</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 pr-3 font-semibold">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={`${row.taskId}-${row.createdAt}-${row.area}`}
                    className="border-b border-slate-100"
                  >
                    <td className="py-2 pr-3 text-slate-900">{row.taskId}</td>
                    <td className="py-2 pr-3 text-slate-900">
                      {row.category}
                    </td>
                    <td className="py-2 pr-3 text-slate-700">{row.area}</td>
                    <td className="py-2 pr-3 text-slate-700">
                      {row.details}
                    </td>
                    <td className="py-2 pr-3 text-slate-700">
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                        {row.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-slate-700">
                      {row.createdAt !== "-" &&
                      !Number.isNaN(Date.parse(row.createdAt))
                        ? new Date(row.createdAt).toLocaleString()
                        : row.createdAt}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
