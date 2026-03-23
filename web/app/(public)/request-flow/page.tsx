"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import WhenNeedIt from "../components/WhenNeedIt";
import AreaSelection, {
  normalizeAreaValue,
} from "@/app/(public)/components/AreaSelection";

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

export default function RequestFlowPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col items-center justify-center bg-white px-4 py-10">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700 shadow-sm">
            Loading request flow...
          </div>
        </div>
      }
    >
      <PageContent />
    </Suspense>
  );
}

function getTodayLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDateOnly(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const dmyMatch = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;

  return "";
}

function PageContent() {
  const params = useSearchParams();
  const router = useRouter();

  const [category, setCategory] = useState(params.get("category") || "");
  const [time, setTime] = useState("");
  const [serviceDate, setServiceDate] = useState("");
  const [timeSlot, setTimeSlot] = useState("");
  const [area, setArea] = useState("");
  const [areaError, setAreaError] = useState("");
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string>("");
  const [debug, setDebug] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);

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
  const todayDate = useMemo(() => getTodayLocalDateString(), []);
  const normalizedServiceDate = useMemo(() => normalizeDateOnly(serviceDate), [serviceDate]);
  const serviceDateError = useMemo(() => {
    if (time !== "Schedule later" || !serviceDate) return "";
    if (!normalizedServiceDate || normalizedServiceDate < todayDate) {
      return "Please select today or a future date.";
    }
    return "";
  }, [normalizedServiceDate, serviceDate, time, todayDate]);

  const handleSubmit = async () => {
    setError("");
    setDebug("");
    setAreaError("");
    setIsRedirecting(false);
    const normalizedArea = normalizeAreaValue(area);
    if (!normalizedArea) {
      setAreaError("Please select or type your area.");
      return;
    }
    if (!canSubmit) {
      setError("Please fill all required fields.");
      return;
    }
    if (time === "Schedule later" && (!serviceDate || !timeSlot)) {
      setError("Please select both date and time slot.");
      return;
    }
    if (serviceDateError) {
      console.log("[request-flow] rejected past service date", {
        rawDate: serviceDate,
        normalizedDate: normalizedServiceDate,
        todayDate,
        reason: serviceDateError,
      });
      setError(serviceDateError);
      return;
    }
    setLoading(true);
    try {
      const cleanDetails = (details ?? "").trim();
      const res = await fetch("/api/submit-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          area: normalizedArea,
          time,
          serviceDate: normalizedServiceDate,
          timeSlot,
          details: cleanDetails,
          createdAt: new Date().toISOString(),
        }),
      });

      const text = await res.text();
      setDebug(`HTTP ${res.status}: ${text}`);

      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {}

      if (!res.ok) {
        setError(json?.message || json?.error || "Request failed (non-200). Check debug.");
        return;
      }

      if (!json?.ok) {
        setError(json?.message || json?.error || "Apps Script rejected request. Check debug.");
        return;
      }

      if (typeof window !== "undefined") {
        window.localStorage.setItem("kk_last_area", normalizedArea);
      }
      setIsRedirecting(true);
      router.push("/my-tasks");
      router.refresh();
      return;
    } catch (err: any) {
      setError(err?.message || "Something went wrong.");
      setIsRedirecting(false);
    } finally {
      setLoading(false);
    }
  };

  if (isRedirecting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-4 py-10">
        <p className="text-sm font-medium text-slate-700">Redirecting...</p>
      </div>
    );
  }

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
            serviceDate={serviceDate}
            timeSlot={timeSlot}
            minDate={todayDate}
            dateError={serviceDateError}
            onSelect={(value) => {
              setTime(value);
              if (error) setError("");
            }}
            onServiceDateChange={(value) => {
              setServiceDate(value);
              if (error) setError("");
            }}
            onTimeSlotChange={(value) => {
              setTimeSlot(value);
              if (error) setError("");
            }}
          />

          <AreaSelection
            selectedArea={area}
            onSelect={(value) => {
              setArea(value);
              setAreaError("");
            }}
            errorMessage={areaError}
          />

          <div className="space-y-3">
            <label className="text-sm font-semibold text-[#111827]">Task details (optional)</label>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Describe your work in 1-2 sentences..."
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 shadow-sm focus:border-[#0EA5E9] focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/30"
              rows={4}
            />
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || isRedirecting || Boolean(serviceDateError)}
            className="w-full rounded-full bg-[#0EA5E9] px-4 py-3 text-white font-semibold shadow-md transition hover:shadow-lg disabled:opacity-60"
          >
            {loading || isRedirecting ? "Submitting..." : "Submit Request"}
          </button>
          {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
          {debug && (
            <pre className="mt-2 text-xs whitespace-pre-wrap rounded bg-gray-50 p-2 border">
              {debug}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
