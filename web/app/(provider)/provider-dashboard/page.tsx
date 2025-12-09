"use client";

"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ProviderDashboard,
  getProviderDashboard,
} from "@/lib/api/provider";

const badgeClasses: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  blocked: "bg-rose-50 text-rose-700 border-rose-200",
};

function maskPhone(phone: string) {
  if (!phone) return "-";
  if (phone.length < 4) return phone;
  return phone.slice(0, 2) + "*****" + phone.slice(-2);
}

export default function ProviderDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<ProviderDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [providerId, setProviderId] = useState("");
  const [roleChecked, setRoleChecked] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const role = localStorage.getItem("kk_user_role");
    if (role !== "provider") {
      router.replace("/");
      return;
    }
    const storedProviderId =
      localStorage.getItem("kk_provider_id") || localStorage.getItem("kk_user_phone") || "";
    setProviderId(storedProviderId);
    setRoleChecked(true);
  }, [router]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const dashboard = await getProviderDashboard(providerId);
        setData(dashboard);
      } catch (err) {
        console.error(err);
        setError("Unable to load dashboard");
      } finally {
        setLoading(false);
      }
    };
    if (roleChecked && providerId) {
      load();
    } else {
      setLoading(false);
      if (roleChecked) {
        setError("Provider not found. Please log in again.");
      }
    }
  }, [providerId, roleChecked]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm text-sm text-slate-600">
        Loading dashboard...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 shadow-sm text-sm text-rose-700">
        {error || "Dashboard unavailable"}
      </div>
    );
  }

  const statusKey = (data.provider.status || "").toLowerCase();
  const statusClass =
    badgeClasses[statusKey] || "bg-slate-100 text-slate-700 border-slate-200";

  return (
    <div className="space-y-6">
      {/* Profile */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Provider Dashboard
            </p>
            <h1 className="text-2xl font-semibold text-slate-900">
              {data.provider.name}
            </h1>
            <p className="text-sm text-slate-600">{data.provider.phone}</p>
          </div>
          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${statusClass}`}
          >
            {data.provider.status || "Status"}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            <span className="font-semibold">Categories:</span>{" "}
            {data.provider.categories.join(", ") || "-"}
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            <span className="font-semibold">Areas:</span>{" "}
            {data.provider.areas.join(", ") || "-"}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[
          {
            label: "Tasks Received",
            value: data.stats.tasksReceived,
            className: "bg-slate-900 text-white",
          },
          {
            label: "Tasks Accepted",
            value: data.stats.tasksAccepted,
            className: "bg-emerald-50 text-emerald-700",
          },
          {
            label: "Response Rate",
            value: `${data.stats.responseRate || 0}%`,
            className: "bg-blue-50 text-blue-700",
          },
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

      {/* Tasks Received */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-lg font-semibold text-slate-900">Tasks Received</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Task ID</th>
                <th className="px-4 py-3 font-semibold">Category</th>
                <th className="px-4 py-3 font-semibold">Area</th>
                <th className="px-4 py-3 font-semibold">Sent At</th>
                <th className="px-4 py-3 font-semibold">Accepted?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-800">
              {data.tasksReceived.map((task) => (
                <tr key={task.taskId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-900">{task.taskId}</td>
                  <td className="px-4 py-3">{task.category}</td>
                  <td className="px-4 py-3">{task.area}</td>
                  <td className="px-4 py-3">{task.sentAt || "-"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
                        task.accepted
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-slate-100 text-slate-700 border-slate-200"
                      }`}
                    >
                      {task.accepted ? "Yes" : "No"}
                    </span>
                  </td>
                </tr>
              ))}
              {data.tasksReceived.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-6 text-center text-sm text-slate-500"
                  >
                    No tasks received yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tasks Accepted */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-lg font-semibold text-slate-900">Tasks Accepted</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Task ID</th>
                <th className="px-4 py-3 font-semibold">Category</th>
                <th className="px-4 py-3 font-semibold">Area</th>
                <th className="px-4 py-3 font-semibold">Accepted At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-800">
              {data.tasksAccepted.map((task) => (
                <tr key={task.taskId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-900">{task.taskId}</td>
                  <td className="px-4 py-3">{task.category}</td>
                  <td className="px-4 py-3">{task.area}</td>
                  <td className="px-4 py-3">{task.acceptedAt || "-"}</td>
                </tr>
              ))}
              {data.tasksAccepted.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-6 text-center text-sm text-slate-500"
                  >
                    No accepted tasks yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reviews */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-lg font-semibold text-slate-900">Reviews</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {data.reviews.length === 0 && (
            <p className="px-4 py-4 text-sm text-slate-500">No reviews yet.</p>
          )}
          {data.reviews.map((review) => (
            <div key={review.reviewId} className="px-4 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg text-amber-500">★</span>
                  <span className="text-sm font-semibold text-slate-900">
                    {review.rating.toFixed(1)}
                  </span>
                </div>
                <span className="text-xs text-slate-500">{review.createdAt}</span>
              </div>
              <p className="mt-2 text-sm text-slate-800">{review.comment || "No comment"}</p>
              <p className="mt-1 text-xs text-slate-500">
                {review.userPhone ? maskPhone(review.userPhone) : "Anonymous"}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
