"use client";

"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import WhenNeedIt from "../components/WhenNeedIt";
import AreaSelection from "@/app/(public)/components/AreaSelection";

const MASTER_AREAS = [
  "Sardarpura",
  "Shastri Nagar",
  "Ratanada",
  "Pal Road",
  "Bhagat Ki Kothi",
  "Chopasni Housing Board",
  "Chopasni Road",
  "Basni",
  "Paota",
  "Mandore",
  "Residency Road",
  "Rai Ka Bagh",
  "High Court Colony",
  "Civil Lines",
  "Kamla Nehru Nagar",
  "Kudi Bhagtasni Housing Board",
  "Banar",
  "Pratap Nagar",
  "Nayapura",
  "Shikargarh",
  "Air Force Area",
  "MIA",
  "Jalori Gate",
  "Sojati Gate",
  "Clock Tower",
  "Nandri",
  "Paota Circle",
  "Kabir Nagar",
  "Vivek Vihar",
  "BJS Colony",
  "Umaid Stadium",
  "Ashapurna Valley",
  "Sangriya",
  "Mogra",
  "Khema Ka Kuan",
  "Idgah",
  "Agolai",
  "Tinwari",
  "Laxmi Nagar",
  "Rajiv Gandhi Colony",
  "Sursagar",
  "Rikhtiya Bheruji",
  "Sivanchi Gate",
  "Chand Pole",
  "Soorsagar Road",
  "Panch Batti Circle",
  "New Power House",
  "Madar",
  "Mahamandir",
];

const POPULAR_AREAS = ["Sardarpura", "Shastri Nagar"];

export default function RequestFlowPage() {
  const params = useSearchParams();
  const router = useRouter();

  const [category, setCategory] = useState(params.get("category") || "");
  const [time, setTime] = useState("");
  const [area, setArea] = useState("");
  const [details, setDetails] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const fromParams = params.get("category") || "";
    if (fromParams && fromParams !== category) {
      setCategory(fromParams);
    }
  }, [params, category]);

  const canSubmit = useMemo(
    () => category.trim() !== "" && time.trim() !== "" && area.trim() !== "",
    [area, category, time]
  );

  const handleSubmit = async () => {
    setError("");
    setSuccess(false);
    if (!canSubmit) {
      setError("Please fill all required fields.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/submit-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          time,
          area,
          details,
          createdAt: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to submit request");
      }
      setSuccess(true);
      setDetails("");
    } catch (err: any) {
      setError(err?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white px-4 py-10">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Submit request</p>
          <h1 className="text-2xl font-semibold text-slate-900">{category || "Select a category"}</h1>
        </div>

        <div className="space-y-6">
          <WhenNeedIt
            selectedTime={time}
            onSelect={(value) => {
              setTime(value);
            }}
          />

          <AreaSelection
            selectedArea={area}
            onSelect={(value) => {
              setArea(value);
            }}
            areas={MASTER_AREAS}
            popularAreas={POPULAR_AREAS}
          />

          <div className="space-y-3">
            <label className="text-sm font-semibold text-[#111827]">Task details (optional)</label>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Describe your work in 1–2 sentences..."
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 shadow-sm focus:border-[#0EA5E9] focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/30"
              rows={4}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && (
            <p className="text-sm font-semibold text-emerald-700">
              Your request has been submitted! Providers will contact you soon.
            </p>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading}
            className="w-full rounded-full bg-[#0EA5E9] px-4 py-3 text-white font-semibold shadow-md transition hover:shadow-lg disabled:opacity-60"
          >
            {loading ? "Submitting..." : "Submit Request"}
          </button>
        </div>
      </div>
    </div>
  );
}
