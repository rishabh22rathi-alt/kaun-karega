"use client";

import { useEffect, useState } from "react";

type CommunityRow = {
  communityId: string;
  userPhone: string;
  needType: string;
  area: string;
  createdAt: string;
  status: string;
  helpersCount: number;
};

export default function AdminCommunityPage() {
  const [rows, setRows] = useState<CommunityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const perms = JSON.parse(localStorage.getItem("kk_permissions") || "[]");
    if (!perms.includes("view_community")) {
      setLoading(false);
      setError("NO_PERMISSION");
      return;
    }

    const fetchData = async () => {
      try {
        const res = await fetch("/api/admin/community");
        const data = await res.json();
        if (data.ok) {
          setRows(data.community || []);
        } else {
          setError("Error loading data");
        }
      } catch (err) {
        setError("Error loading data");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (error === "NO_PERMISSION") {
    return (
      <p className="text-red-500 text-sm">
        You do not have permission to view this section.
      </p>
    );
  }

  const statusBadge = (status: string) => {
    const normalized = (status || "").toUpperCase();
    if (normalized === "OPEN") {
      return (
        <span className="px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">
          OPEN
        </span>
      );
    }
    if (normalized === "CLOSED") {
      return (
        <span className="px-2 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">
          CLOSED
        </span>
      );
    }
    return (
      <span className="px-2 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
        {status || "UNKNOWN"}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Community</h1>
      <div className="bg-white rounded-lg shadow p-4 border border-gray-100">
        {loading ? (
          <p className="text-sm text-gray-600">Loading...</p>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-600">No records found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-gray-700">
              <thead>
                <tr className="text-blue-600 font-semibold border-b">
                  <th className="text-left py-2 pr-4">Community ID</th>
                  <th className="text-left py-2 pr-4">User Phone</th>
                  <th className="text-left py-2 pr-4">Need Type</th>
                  <th className="text-left py-2 pr-4">Area</th>
                  <th className="text-left py-2 pr-4">Created At</th>
                  <th className="text-left py-2 pr-4">Status</th>
                  <th className="text-left py-2 pr-4">Helpers Responded</th>
                  <th className="text-left py-2 pr-4">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.communityId}
                    className="border-b border-gray-100 hover:bg-gray-50"
                  >
                    <td className="py-2 pr-4">{row.communityId}</td>
                    <td className="py-2 pr-4">{row.userPhone}</td>
                    <td className="py-2 pr-4">{row.needType}</td>
                    <td className="py-2 pr-4">{row.area}</td>
                    <td className="py-2 pr-4">{row.createdAt}</td>
                    <td className="py-2 pr-4">{statusBadge(row.status)}</td>
                    <td className="py-2 pr-4">{row.helpersCount}</td>
                    <td className="py-2 pr-4">
                      <button
                        type="button"
                        onClick={() =>
                          window.open(
                            `/admin/community/${row.communityId}`,
                            "_blank"
                          )
                        }
                        className="px-3 py-1 text-xs bg-blue-600 text-white rounded"
                      >
                        View Details
                      </button>
                    </td>
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
