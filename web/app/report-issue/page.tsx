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
      const data = (await res.json()) as {
        ok?: boolean;
        issueId?: string;
        issueNo?: number;
        error?: string;
      };

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to submit issue report");
      }

      // Keep issueType / issuePage / description on screen so the user
      // sees exactly what was submitted. The "Submitted" button state
      // (driven by `success` being non-empty) makes the form
      // read-only-feeling without disabling the inputs themselves —
      // any edit clears `success` (see field onChange handlers below)
      // and re-enables Submit.

      // Prefer the public sequential reference (Issue No. X). Fall back
      // to the UUID only when issue_no isn't present (migration not yet
      // applied). Final fallback: a generic success line.
      const successLine =
        typeof data.issueNo === "number" && data.issueNo > 0
          ? `Issue submitted successfully. Issue No. ${data.issueNo}`
          : data.issueId
            ? `Issue submitted successfully. Reference: ${data.issueId}`
            : "Issue submitted successfully.";
      setSuccess(successLine);
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
              onChange={(event) => {
                setIssueType(event.target.value);
                // Any edit after a successful submit clears the
                // "Submitted" state so the user can submit a new
                // report without re-mounting the page.
                if (success) setSuccess("");
              }}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-[#003d20] focus:ring-2 focus:ring-[#003d20]/20"
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
              onChange={(event) => {
                setIssuePage(event.target.value);
                if (success) setSuccess("");
              }}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-[#003d20] focus:ring-2 focus:ring-[#003d20]/20"
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
              onChange={(event) => {
                setDescription(event.target.value);
                if (success) setSuccess("");
              }}
              placeholder="Please explain the issue in your own words."
              minLength={10}
              rows={6}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-[#003d20] focus:ring-2 focus:ring-[#003d20]/20"
              required
            />
          </div>

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {success ? (
            <div
              className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
              role="status"
              aria-live="polite"
            >
              {success}
            </div>
          ) : null}

          {/* Brand-green primary; orange-tinted "Submitted" confirmation
              state. Disabled while the request is in flight or while
              the form still reflects the just-submitted values; any
              field edit clears `success` and re-enables Submit. */}
          <button
            type="submit"
            disabled={submitting || Boolean(success)}
            className={`w-full rounded-full px-4 py-3 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-80 ${
              success
                ? "bg-emerald-700 hover:bg-emerald-700"
                : "bg-[#003d20] hover:bg-[#002a16]"
            }`}
          >
            {submitting ? "Submitting..." : success ? "Submitted ✓" : "Submit"}
          </button>
        </form>
      </div>
    </main>
  );
}
