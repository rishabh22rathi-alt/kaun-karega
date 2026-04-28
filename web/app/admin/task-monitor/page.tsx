"use client";

import { useEffect, useMemo, useState } from "react";

type Light = "green" | "yellow" | "red" | "gray";

type AuditTrail = {
  taskCreatedAt: string;
  providersMatched: number;
  notificationsAccepted: number;
  notificationsFailed: number;
  firstProviderResponseAt: string | null;
  firstUserReplyAt: string | null;
  currentStatus: string;
  closedAt: string | null;
  closedBy: string | null;
  closeReason: string | null;
};

function formatClosedBy(closedBy: string | null): string {
  const normalized = String(closedBy || "").trim().toLowerCase();
  if (normalized === "user") return "User";
  if (normalized === "admin") return "Admin";
  if (normalized === "system") return "System";
  return closedBy || "—";
}

type EnrichedTask = {
  taskId: string;
  displayId: string;
  category: string;
  area: string;
  userPhone: string;
  createdAt: string;
  currentStatus: string;
  // Backend emits the 6-stage lifecycle keys explicitly. Legacy keys
  // (notification/response/userChat/closure) are still on the response
  // for the previous /admin/dashboard binding, but this page now reads
  // the explicit lifecycle keys via aliases that share the same values.
  lights: {
    taskPosted: Light;
    providersMatched: Light;
    providersNotified: Light;
    providerResponded: Light;
    userResponded: Light;
    closed: Light;
  };
  auditTrail: AuditTrail;
};

type ApiResponse =
  | { ok: true; tasks: EnrichedTask[] }
  | { ok: false; error: string };

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-IN");
}

function lightClass(light: Light): string {
  switch (light) {
    case "green":
      return "bg-emerald-500 ring-emerald-200";
    case "yellow":
      return "bg-amber-400 ring-amber-200";
    case "red":
      return "bg-red-500 ring-red-200";
    default:
      return "bg-slate-300 ring-slate-200";
  }
}

function lightLabel(light: Light): string {
  switch (light) {
    case "green":
      return "OK";
    case "yellow":
      return "Pending";
    case "red":
      return "Stuck / failed";
    default:
      return "Not yet";
  }
}

function LightDot({ light, title }: { light: Light; title: string }) {
  return (
    <span
      title={`${title}: ${lightLabel(light)}`}
      className={`inline-block h-3.5 w-3.5 rounded-full ring-2 ${lightClass(light)}`}
    />
  );
}

export default function AdminTaskMonitorPage() {
  const [tasks, setTasks] = useState<EnrichedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [auditTask, setAuditTask] = useState<EnrichedTask | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/admin/task-monitor", { cache: "no-store" });
        const data = (await res.json()) as ApiResponse;
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setError(
            (!data.ok && data.error) || `Failed to load (HTTP ${res.status})`
          );
          setTasks([]);
        } else {
          setTasks(data.tasks);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Network error");
        setTasks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((t) => {
      const haystack = [
        t.displayId,
        t.taskId,
        t.userPhone,
        t.category,
        t.area,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [tasks, search]);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8">
      <header className="mb-6 flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-slate-900">
          Admin Task Audit Monitor
        </h1>
        <p className="text-sm text-slate-500">
          Stage-wise traffic-light view of every task. Lights are derived
          strictly from real rows in tasks, provider_task_matches,
          notification_logs, and chat_messages — no synthetic state.
        </p>
        <ol className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
          <li>
            <span className="mr-1 font-semibold text-slate-500">Lifecycle:</span>
            1. Posted
          </li>
          <li>2. Matched</li>
          <li>3. Notified</li>
          <li>4. Provider Replied</li>
          <li>5. User Replied</li>
          <li>6. Closed</li>
        </ol>
      </header>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by Kaam No., phone, category, area..."
          className="w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
        />
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <LegendDot light="green" label="OK" />
          <LegendDot light="yellow" label="Pending / waiting" />
          <LegendDot light="red" label="Stuck / failed" />
          <LegendDot light="gray" label="Not reached yet" />
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-3 font-semibold">Kaam No.</th>
              <th className="px-3 py-3 font-semibold">Created</th>
              <th className="px-3 py-3 font-semibold">Service</th>
              <th className="px-3 py-3 font-semibold">Area</th>
              <th className="px-3 py-3 font-semibold">User Phone</th>
              <th
                className="px-2 py-3 text-center font-semibold"
                title="Stage 1 — Task Posted: row exists in `tasks`"
              >
                Posted
              </th>
              <th
                className="px-2 py-3 text-center font-semibold"
                title="Stage 2 — Providers Matched: rows in `provider_task_matches` for this task"
              >
                Matched
              </th>
              <th
                className="px-2 py-3 text-center font-semibold"
                title="Stage 3 — Providers Notified: WhatsApp send accepted in `notification_logs`"
              >
                Notify
              </th>
              <th
                className="px-2 py-3 text-center font-semibold"
                title="Stage 4 — Provider Responded: match_status responded/accepted/assigned, or provider chat message, or task status moved past notified"
              >
                Response
              </th>
              <th
                className="px-2 py-3 text-center font-semibold"
                title="Stage 5 — User Replied in Chat: chat_messages with sender_type='user'"
              >
                Chat
              </th>
              <th
                className="px-2 py-3 text-center font-semibold"
                title="Stage 6 — Closed / Completed: tasks.status='closed'/'completed' or closed_at set"
              >
                Closed
              </th>
              <th className="px-3 py-3 font-semibold">Status</th>
              <th className="px-3 py-3 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {loading ? (
              <tr>
                <td colSpan={13} className="px-3 py-8 text-center text-slate-500">
                  Loading...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-3 py-8 text-center text-slate-500">
                  No tasks match the current filter.
                </td>
              </tr>
            ) : (
              filtered.map((task) => (
                <tr key={task.taskId} className="hover:bg-slate-50">
                  <td className="px-3 py-3 font-medium text-slate-900">
                    {task.displayId
                      ? `Kaam No. ${task.displayId}`
                      : task.taskId || "-"}
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-500">
                    {formatDateTime(task.createdAt)}
                  </td>
                  <td className="px-3 py-3">{task.category || "-"}</td>
                  <td className="px-3 py-3">{task.area || "-"}</td>
                  <td className="px-3 py-3 font-mono text-xs">
                    {task.userPhone || "-"}
                  </td>
                  <td className="px-2 py-3 text-center">
                    <LightDot light={task.lights.taskPosted} title="Task Posted" />
                  </td>
                  <td className="px-2 py-3 text-center">
                    <LightDot
                      light={task.lights.providersMatched}
                      title="Providers Matched"
                    />
                  </td>
                  <td className="px-2 py-3 text-center">
                    <LightDot
                      light={task.lights.providersNotified}
                      title="Providers Notified"
                    />
                  </td>
                  <td className="px-2 py-3 text-center">
                    <LightDot
                      light={task.lights.providerResponded}
                      title="Provider Responded"
                    />
                  </td>
                  <td className="px-2 py-3 text-center">
                    <LightDot
                      light={task.lights.userResponded}
                      title="User Responded in Chat"
                    />
                  </td>
                  <td className="px-2 py-3 text-center">
                    <LightDot light={task.lights.closed} title="Closed / Completed" />
                  </td>
                  <td className="px-3 py-3 text-xs">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-700">
                      {task.currentStatus || "-"}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setAuditTask(task)}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                    >
                      View Audit Trail
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {auditTask ? (
        <AuditModal task={auditTask} onClose={() => setAuditTask(null)} />
      ) : null}
    </div>
  );
}

function LegendDot({ light, label }: { light: Light; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full ring-2 ${lightClass(light)}`}
      />
      {label}
    </span>
  );
}

function AuditModal({
  task,
  onClose,
}: {
  task: EnrichedTask;
  onClose: () => void;
}) {
  const trail = task.auditTrail;
  const events: Array<{ label: string; value: string; emphasis?: boolean }> = [
    {
      label: "Task created",
      value: formatDateTime(trail.taskCreatedAt),
    },
    {
      label: "Providers matched",
      value: String(trail.providersMatched),
    },
    {
      label: "WhatsApp notifications accepted",
      value: String(trail.notificationsAccepted),
    },
    {
      label: "WhatsApp notifications failed",
      value: String(trail.notificationsFailed),
      emphasis: trail.notificationsFailed > 0,
    },
    {
      label: "First provider response",
      value: trail.firstProviderResponseAt
        ? formatDateTime(trail.firstProviderResponseAt)
        : "—",
    },
    {
      label: "First user chat reply",
      value: trail.firstUserReplyAt
        ? formatDateTime(trail.firstUserReplyAt)
        : "—",
    },
    {
      label: "Current status",
      value: trail.currentStatus || "—",
    },
    {
      label: "Closed / completed",
      value: trail.closedAt ? formatDateTime(trail.closedAt) : "—",
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Audit Trail —{" "}
              {task.displayId ? `Kaam No. ${task.displayId}` : task.taskId}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {task.category || "—"} · {task.area || "—"} · {task.userPhone || "—"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            Close
          </button>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          <LegendBlock label="Posted" light={task.lights.taskPosted} />
          <LegendBlock label="Matched" light={task.lights.providersMatched} />
          <LegendBlock label="Notify" light={task.lights.providersNotified} />
          <LegendBlock label="Response" light={task.lights.providerResponded} />
          <LegendBlock label="Chat" light={task.lights.userResponded} />
          <LegendBlock label="Closed" light={task.lights.closed} />
        </div>

        <ol className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {events.map((event, idx) => (
            <li
              key={idx}
              className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
            >
              <span className="text-slate-500">{event.label}</span>
              <span
                className={`font-medium ${
                  event.emphasis ? "text-red-700" : "text-slate-900"
                }`}
              >
                {event.value}
              </span>
            </li>
          ))}
        </ol>

        {(task.lights.closed === "green" || trail.closedAt) ? (
          <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Closure Details
            </h3>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500">Closed by</dt>
                <dd className="font-medium text-slate-900">
                  {formatClosedBy(trail.closedBy)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500">Reason</dt>
                <dd className="font-medium text-slate-900">
                  {trail.closeReason && trail.closeReason.trim()
                    ? trail.closeReason
                    : "—"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500">Closed at</dt>
                <dd className="font-medium text-slate-900">
                  {trail.closedAt ? formatDateTime(trail.closedAt) : "—"}
                </dd>
              </div>
            </dl>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function LegendBlock({ label, light }: { label: string; light: Light }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center">
      <span
        className={`inline-block h-3 w-3 rounded-full ring-2 ${lightClass(light)}`}
      />
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span className="text-[10px] text-slate-600">{lightLabel(light)}</span>
    </div>
  );
}
