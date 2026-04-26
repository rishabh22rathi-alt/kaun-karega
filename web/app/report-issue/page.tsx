"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getAuthSession } from "@/lib/auth";

const ISSUE_TYPE_OPTIONS = [
  "Login / OTP problem",
  "Task not submitting",
  "Wrong service shown",
  "Area/location problem",
  "Chat/message problem",
  "Provider not responding",
  "Provider dashboard issue",
  "Website/app looks broken",
  "Payment / charges issue",
  "Other",
];

const ISSUE_PAGE_OPTIONS = [
  "Homepage",
  "Responses",
  "Dashboard",
  "Chat",
  "Login / OTP",
  "Sidebar / Navigation",
  "Other",
];

export default function ReportIssuePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [issueType, setIssueType] = useState("");
  const [issuePage, setIssuePage] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const session = getAuthSession();
    if (!session?.phone) {
      router.replace("/login?next=/report-issue");
      return;
    }
    setReady(true);
  }, [router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    const trimmedDescription = description.trim();
    if (!issueType || !issuePage || trimmedDescription.length < 10) {
      setError("Please complete all fields. Description must be at least 10 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/report-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueType,
          issuePage,
          description: trimmedDescription,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; issueId?: string; error?: string };

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to submit issue report");
      }

      setIssueType("");
      setIssuePage("");
      setDescription("");
      setSuccess(
        data.issueId
          ? `Issue submitted successfully. Reference: ${data.issueId}`
          : "Issue submitted successfully."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit issue report");
    } finally {
      setSubmitting(false);
    }
  };

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          Redirecting...
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
        <h1 className="text-2xl font-bold text-slate-900">Report an Issue</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Facing a problem on Kaun Karega? Tell us what happened and we&apos;ll review it.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Issue Type</label>
            <select
              value={issueType}
              onChange={(event) => setIssueType(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20"
              required
            >
              <option value="">Select issue type</option>
              {ISSUE_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Where did this happen?</label>
            <select
              value={issuePage}
              onChange={(event) => setIssuePage(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20"
              required
            >
              <option value="">Select page/area</option>
              {ISSUE_PAGE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Tell us what happened</label>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Please explain the issue in your own words."
              minLength={10}
              rows={6}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20"
              required
            />
          </div>

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {success ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {success}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-full bg-sky-500 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Submitting..." : "Submit"}
          </button>
        </form>
      </div>
    </main>
  );
}
