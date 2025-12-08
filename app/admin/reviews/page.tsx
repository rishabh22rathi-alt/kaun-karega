"use client";

"use client";
import { useEffect, useMemo, useState } from "react";
import { Review, getAllReviews } from "@/lib/api/reviews";

export default function AdminReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const perms = JSON.parse(localStorage.getItem("kk_permissions") || "[]");
    setPermissions(perms);
    if (!perms.includes("view_reviews")) {
      setLoading(false);
      return;
    }
    const fetchReviews = async () => {
      try {
        const data = await getAllReviews();
        setReviews(data || []);
      } catch (err) {
        console.error("getAllReviews error", err);
        setError("Error loading data");
      } finally {
        setLoading(false);
      }
    };
    fetchReviews();
  }, []);

  const filteredReviews = useMemo(() => {
    const term = searchTerm.toLowerCase();
    if (!term) return reviews;
    return reviews.filter(
      (row) =>
        row.roomId.toLowerCase().includes(term) ||
        row.reviewerPhone.toLowerCase().includes(term) ||
        row.reviewText.toLowerCase().includes(term)
    );
  }, [reviews, searchTerm]);

  const badgeClass = (rating: number) => {
    if (rating <= 1) return "bg-red-100 text-red-700";
    if (rating <= 3) return "bg-orange-100 text-orange-700";
    return "bg-green-100 text-green-700";
  };

  const handleDelete = (roomId: string, idx: number) => {
    // UI-only delete to support cleanup flows
    setReviews((prev) =>
      prev.filter((review, reviewIdx) => !(review.roomId === roomId && reviewIdx === idx))
    );
  };

  if (!permissions.includes("view_reviews")) {
    return (
      <p className="text-sm text-red-500">
        You do not have permission to view this section.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Reviews Cleanup
        </p>
        <h1 className="text-2xl font-semibold text-slate-900">Reviews</h1>
        <p className="text-sm text-slate-600">
          Search reviews by provider or phone and remove problematic entries (UI only).
        </p>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow">
        {loading ? (
          <p className="text-sm text-gray-600">Loading...</p>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : reviews.length === 0 ? (
          <p className="text-sm text-gray-600">No records found.</p>
        ) : (
          <>
            <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <label className="w-full md:w-80">
                <span className="text-xs font-medium text-slate-600">Search</span>
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                  placeholder="Search by provider or phone"
                />
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm text-gray-700">
                <thead>
                  <tr className="border-b text-blue-600 font-semibold">
                    <th className="py-2 pr-4 text-left">Room ID</th>
                    <th className="py-2 pr-4 text-left">Reviewer Phone</th>
                    <th className="py-2 pr-4 text-left">Reviewer Role</th>
                    <th className="py-2 pr-4 text-left">Rating</th>
                    <th className="py-2 pr-4 text-left">Review Text</th>
                    <th className="py-2 pr-4 text-left">Timestamp</th>
                    <th className="py-2 pl-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReviews.map((row, idx) => (
                    <tr
                      key={`${row.roomId}-${idx}`}
                      className="border-b border-gray-100 hover:bg-gray-50"
                    >
                      <td className="py-2 pr-4">{row.roomId}</td>
                      <td className="py-2 pr-4">{row.reviewerPhone}</td>
                      <td className="py-2 pr-4 capitalize">{row.reviewerRole}</td>
                      <td className="py-2 pr-4">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-semibold ${badgeClass(
                            row.rating
                          )}`}
                        >
                          {row.rating}
                        </span>
                      </td>
                      <td className="py-2 pr-4">
                        {row.reviewText || <span className="text-gray-400">—</span>}
                      </td>
                      <td className="py-2 pr-4">{row.timestamp}</td>
                      <td className="py-2 pl-4 text-right">
                        <button
                          onClick={() => handleDelete(row.roomId, idx)}
                          className="rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-100"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredReviews.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="py-3 text-center text-sm text-gray-500"
                      >
                        No reviews matched your search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
