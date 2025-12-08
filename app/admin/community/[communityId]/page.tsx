"use client";

import { useEffect, useMemo, useState } from "react";

type Community = {
  communityId: string;
  userPhone: string;
  needType: string;
  area: string;
  createdAt: string;
  status: string;
};

type Helper = {
  helperPhone: string;
  timestamp: string;
};

type PageProps = {
  params: { communityId: string };
};

export default function CommunityDetailPage({ params }: PageProps) {
  const { communityId } = params;
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [community, setCommunity] = useState<Community | null>(null);
  const [helpers, setHelpers] = useState<Helper[]>([]);
  const [resolving, setResolving] = useState(false);
  const [success, setSuccess] = useState("");

  useEffect(() => {
    const perms = JSON.parse(
      typeof window !== "undefined"
        ? localStorage.getItem("kk_permissions") || "[]"
        : "[]"
    );
    setPermissions(perms);
  }, []);

  const canView = useMemo(
    () => permissions.includes("view_community"),
    [permissions]
  );

  const canManage = useMemo(
    () => permissions.includes("manage_community"),
    [permissions]
  );

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const fetchData = async () => {
      try {
        const res = await fetch(`/api/admin/community/${communityId}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.ok) {
          setCommunity(data.community);
          setHelpers(data.helpers || []);
        } else {
          setError(data.error || "Failed to load community request");
        }
      } catch (err) {
        if (!cancelled) setError("Failed to load community request");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    return () => {
      cancelled = true;
    };
  }, [communityId, canView]);

  const statusBadge = (status: string) => {
    const normalized = (status || "").toUpperCase();
    if (normalized === "OPEN") {
      return (
        <span className="inline-flex rounded-full bg-green-100 text-green-700 px-3 py-1 text-xs font-semibold">
          OPEN
        </span>
      );
    }
    if (normalized === "RESOLVED") {
      return (
        <span className="inline-flex rounded-full bg-blue-100 text-blue-700 px-3 py-1 text-xs font-semibold">
          RESOLVED
        </span>
      );
    }
    return (
      <span className="inline-flex rounded-full bg-gray-100 text-gray-700 px-3 py-1 text-xs font-semibold">
        {status || "UNKNOWN"}
      </span>
    );
  };

  const handleResolve = async () => {
    if (!community) return;
    const confirmed = window.confirm("Mark this community request as RESOLVED?");
    if (!confirmed) return;
    setResolving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/community/${community.communityId}/close`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.ok) {
        setCommunity({ ...community, status: "RESOLVED" });
        setSuccess("Community request marked as resolved.");
      } else {
        setError(data.error || "Failed to resolve request");
      }
    } catch (err) {
      setError("Failed to resolve request");
    } finally {
      setResolving(false);
    }
  };

  if (!canView) {
    return (
      <p className="text-red-500 text-sm">
        You do not have permission to view this section.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Community Request Details</h1>

      <div className="bg-white rounded-lg shadow p-4 border border-gray-100 space-y-2">
        {loading ? (
          <p className="text-sm text-gray-600">Loading community request...</p>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : community ? (
          <>
            <div className="grid gap-2 md:grid-cols-2 text-sm text-gray-800">
              <p>
                <span className="font-semibold">Community ID:</span> {community.communityId}
              </p>
              <p>
                <span className="font-semibold">User Phone:</span> {community.userPhone}
              </p>
              <p>
                <span className="font-semibold">Need Type:</span> {community.needType}
              </p>
              <p>
                <span className="font-semibold">Area:</span> {community.area}
              </p>
              <p>
                <span className="font-semibold">Created At:</span> {community.createdAt}
              </p>
              <p className="flex items-center gap-2">
                <span className="font-semibold">Status:</span> {statusBadge(community.status)}
              </p>
            </div>

            {canManage && community.status !== "RESOLVED" && (
              <button
                type="button"
                onClick={handleResolve}
                disabled={resolving}
                className="mt-3 px-4 py-2 bg-green-600 text-white rounded-lg shadow hover:bg-green-700 disabled:opacity-60"
              >
                {resolving ? "Updating..." : "Mark as Resolved"}
              </button>
            )}

            {success && (
              <p className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg p-2">
                {success}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-gray-600">Not found.</p>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-4 border border-gray-100">
        <h2 className="text-lg font-semibold mb-2">Helpers Responded</h2>
        {helpers.length === 0 ? (
          <p className="text-sm text-gray-600">No helpers have responded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-gray-700">
              <thead>
                <tr className="text-blue-600 font-semibold border-b">
                  <th className="text-left py-2 pr-4">Helper Phone</th>
                  <th className="text-left py-2 pr-4">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {helpers.map((helper, idx) => (
                  <tr
                    key={`${helper.helperPhone}-${idx}`}
                    className="border-b border-gray-100 hover:bg-gray-50"
                  >
                    <td className="py-2 pr-4">{helper.helperPhone}</td>
                    <td className="py-2 pr-4">{helper.timestamp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
