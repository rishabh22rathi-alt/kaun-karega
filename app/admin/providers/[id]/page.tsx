"use client";

"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Provider,
  ProviderStatus,
  blockProvider,
  getProviderById,
  unblockProvider,
} from "@/lib/api/providers";

export default function ProviderProfilePage() {
  const params = useParams();
  const router = useRouter();

  const providerIdParam = params?.id;
  const providerId = Array.isArray(providerIdParam)
    ? providerIdParam[0]
    : providerIdParam || "";

  const [provider, setProvider] = useState<Provider | null>(null);
  const [status, setStatus] = useState<ProviderStatus>("Pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const data = await getProviderById(providerId);
        if (!mounted) return;
        if (!data) {
          setError("Provider not found");
          return;
        }
        setProvider(data);
        setStatus((data.status as ProviderStatus) || "Pending");
      } catch (err) {
        console.error("Failed to fetch provider", err);
        if (mounted) setError("Failed to load provider details.");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    if (providerId) {
      load();
    } else {
      setError("Invalid provider id");
      setLoading(false);
    }
    return () => {
      mounted = false;
    };
  }, [providerId]);

  const statusBadge: Record<ProviderStatus, string> = {
    Active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    Pending: "bg-amber-50 text-amber-700 border-amber-200",
    Blocked: "bg-rose-50 text-rose-700 border-rose-200",
  };

  const stats = useMemo(
    () => [
      { label: "Tasks Completed", value: provider?.totalTasks ?? 0 },
      { label: "Responses", value: provider?.totalResponses ?? 0 },
      { label: "Status", value: status },
      { label: "Phone", value: provider?.phone || "" },
    ],
    [provider, status]
  );

  const handleToggleStatus = async () => {
    if (!provider) return;
    setActionLoading(true);
    try {
      if (status === "Blocked") {
        const res = await unblockProvider(provider.id);
        setStatus((res?.status as ProviderStatus) || "Active");
      } else {
        const res = await blockProvider(provider.id);
        setStatus((res?.status as ProviderStatus) || "Blocked");
      }
    } catch (err) {
      console.error("Status toggle failed", err);
      setError("Unable to update status right now.");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-slate-500">Loading provider...</p>;
  }

  if (error || !provider) {
    return (
      <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-700">
        {error || "Provider not found"}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with status + actions */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Provider Profile
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-900">
              {provider.name || "Provider"}
            </h1>
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
                statusBadge[status] ||
                "bg-slate-100 text-slate-700 border-slate-200"
              }`}
            >
              {status}
            </span>
          </div>
          <p className="text-sm text-slate-500">ID: {provider.id}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-100"
            onClick={() => router.push(`/admin/providers/${provider.id}/edit`)}
          >
            Edit
          </button>
          <button
            className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition ${
              status === "Blocked"
                ? "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                : "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
            }`}
            onClick={handleToggleStatus}
            disabled={actionLoading}
          >
            {actionLoading
              ? "Updating..."
              : status === "Blocked"
              ? "Unblock"
              : "Block"}
          </button>
        </div>
      </div>

      {/* Key stats */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((item) => (
          <div
            key={item.label}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm"
          >
            <p className="text-sm text-slate-600">{item.label}</p>
            <p className="text-2xl font-semibold text-slate-900">{item.value}</p>
          </div>
        ))}
      </div>

      {/* Details + placeholders for reviews/chat */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
          <h2 className="text-lg font-semibold text-slate-900">Provider Details</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Phone
              </p>
              <p className="text-sm font-semibold text-slate-900">{provider.phone}</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Categories
              </p>
              <div className="mt-1 flex flex-wrap gap-2">
                {provider.categories.map((category) => (
                  <span
                    key={category}
                    className="rounded-full bg-slate-900/90 px-3 py-1 text-xs font-medium text-white"
                  >
                    {category}
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 md:col-span-2">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Areas Served
              </p>
              <div className="mt-1 flex flex-wrap gap-2">
                {provider.areas.map((area) => (
                  <span
                    key={area}
                    className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"
                  >
                    {area}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Reviews Summary</h2>
          <div className="mt-3 space-y-3">
            <p className="text-sm text-slate-500">
              Reviews data not yet connected for this view.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Chat Preview</h3>
          <div className="mt-3 space-y-2">
            <p className="text-sm text-slate-500">
              Chat history preview not available yet.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Actions</h3>
          <p className="mt-2 text-sm text-slate-600">
            Use the buttons below to manage this provider. Block/Unblock will update the
            provider status via the backend.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={() => router.push(`/admin/providers/${provider.id}/edit`)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-100"
            >
              Edit Provider
            </button>
            <button
              onClick={handleToggleStatus}
              disabled={actionLoading}
              className={`rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition ${
                status === "Blocked"
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  : "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
              } disabled:opacity-60`}
            >
              {actionLoading
                ? "Updating..."
                : status === "Blocked"
                ? "Unblock Provider"
                : "Block Provider"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
