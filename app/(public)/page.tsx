"use client";

import Image from "next/image";
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FaSearch } from "react-icons/fa";
import WhenNeedIt from "@/app/(public)/components/WhenNeedIt";
import AreaSelection from "@/app/(public)/components/AreaSelection";

const MASTER_CATEGORIES = [
  "Carpenter",
  "Electrician",
  "Plumber",
  "AC Mechanic",
  "Washing Machine Repair",
  "RO Technician",
  "Painter",
  "House Cleaner",
  "Sofa Cleaner",
  "Car Cleaner",
  "Kitchen Deep Cleaner",
  "Play Group / Pre-School Teacher",
  "Home Tutor (Nursery-5)",
  "Home Tutor (6-10)",
  "Accounts",
  "Maths",
  "English",
  "Science",
  "Economics",
  "Business Studies",
  "Dance Teacher",
  "Drawing Teacher",
  "Music Teacher",
  "Yoga Instructor",
  "Skating Coach",
  "Karate Coach",
  "Car Driver",
  "Auto Driver",
  "Bike Mechanic",
  "Car Mechanic",
  "Cook",
  "Babysitter / Nanny",
  "Elderly Care / Aya",
  "Gardener",
  "Security Guard",
  "Photographer",
  "Videographer",
  "Event Helper",
  "Makeup Artist",
  "Mehendi Artist",
  "Tailor",
  "Delivery Boy",
  "Labor / Helper (General)",
  "Loader / Unloader",
];

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

function capitalizeWords(str: string) {
  return str
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export default function HomePage() {
  const router = useRouter();
  const [category, setCategory] = useState("");
  const [time, setTime] = useState("");
  const [area, setArea] = useState("");
  const [details, setDetails] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [providerList, setProviderList] = useState<{ name: string; phone: string }[]>([]);
  const [showProviders, setShowProviders] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const suggestions = useMemo(() => {
    const value = searchQuery.trim().toLowerCase();
    if (!value) return [];
    const starts = MASTER_CATEGORIES.filter((item) =>
      item.toLowerCase().startsWith(value)
    );
    const contains = MASTER_CATEGORIES.filter(
      (item) => !starts.includes(item) && item.toLowerCase().includes(value)
    );
    return [...starts, ...contains].slice(0, 12);
  }, [searchQuery]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const role =
      typeof window !== "undefined" ? localStorage.getItem("kk_user_role") : null;
    if (role === "provider") {
      router.replace("/dashboard");
    }
  }, [router]);

  const handleSelectService = (service: string) => {
    setCategory(service);
    setSearchQuery(service);
    setDropdownOpen(false);
    setTime("");
    setArea("");
    setDetails("");
    setSubmitted(false);
    setSubmitError("");
    setProviderList([]);
    setShowProviders(false);
  };

  const handleCreateNewCategory = (name: string) => {
    setCategory(name);
    setSearchQuery(name);
    setTime("");
    setArea("");
    setDetails("");
    setDropdownOpen(false);
    setSubmitted(false);
    setSubmitError("");
    setProviderList([]);
    setShowProviders(false);
  };

  const handleSubmit = async () => {
    setSubmitError("");
    setSubmitted(false);
    if (!category.trim() || !area.trim()) {
      setSubmitError("Please select a category and area.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/submit-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          area,
          details,
          createdAt: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to submit request");
      }
      const data = await res.json();
      setProviderList(Array.isArray(data?.providers) ? data.providers : []);
      setShowProviders(false);
      setSubmitted(true);
      setDetails("");
    } catch (err: any) {
      setSubmitError(err?.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-start bg-white px-4 pt-12">
      <div className="flex w-full max-w-2xl flex-col items-center gap-8 text-center">
        <Image
          src="/kaun-karega-logo.svg"
          alt="Kaun Karega logo"
          width={480}
          height={200}
          className="h-auto w-80 sm:w-[28rem]"
          priority
        />

        <div className="mt-8 flex w-full flex-col items-center gap-6" ref={containerRef}>
          <div className="relative w-full max-w-xl">
            <div className="flex items-center gap-3 rounded-full border border-orange-100 bg-white px-5 py-3 shadow-lg">
              <span className="text-base font-semibold tracking-tight text-green-800 sm:text-lg">
                Looking for
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setDropdownOpen(true);
                  setCategory("");
                  setSubmitted(false);
                }}
                onFocus={() => setDropdownOpen(true)}
                placeholder="Search work..."
                className="flex-1 bg-transparent text-sm text-gray-800 placeholder:text-gray-400 outline-none sm:text-base"
              />
              <FaSearch size={18} color="#2a3d2f" aria-hidden="true" />
            </div>

            {dropdownOpen && searchQuery.trim() !== "" && (
              <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-orange-100 bg-white shadow-xl">
                {suggestions.length > 0 ? (
                  <ul className="max-h-64 overflow-y-auto py-2">
                    {suggestions.map((item) => (
                      <li key={item}>
                        <button
                          type="button"
                          className="w-full px-4 py-2 text-left text-sm text-gray-800 hover:bg-orange-50"
                          onClick={() => handleSelectService(item)}
                        >
                          {item}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <button
                    type="button"
                    className="w-full px-4 py-3 text-left text-sm font-semibold text-gray-800 hover:bg-orange-50"
                    onClick={() => handleCreateNewCategory(searchQuery)}
                  >
                    Create a new task for "{searchQuery}"
                  </button>
                )}
              </div>
            )}
          </div>

          {category && (
            <div className="w-full max-w-xl space-y-6 text-left">
              <WhenNeedIt
                selectedTime={time}
                onSelect={(value) => {
                  setTime(value);
                  setSubmitted(false);
                }}
              />

              <AreaSelection
                selectedArea={area}
                onSelect={(value) => {
                  const fixed = capitalizeWords(value);
                  setArea(fixed);
                  setSubmitted(false);
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

              {submitError && <p className="text-sm text-red-600">{submitError}</p>}
              {submitted && (
                <p className="text-sm font-semibold text-emerald-700">
                  Your request has been submitted! Providers will contact you soon.
                </p>
              )}
              {submitted && providerList.length > 0 && (
                <div className="mt-4 rounded border border-slate-200 bg-white p-4 text-left">
                  <p>Would you like to contact service providers yourself?</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setShowProviders(true)}
                      className="rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white"
                    >
                      Yes, show providers
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowProviders(false)}
                      className="rounded bg-gray-300 px-4 py-2 text-sm font-semibold text-gray-800"
                    >
                      No, thanks
                    </button>
                  </div>
                </div>
              )}
              {showProviders && providerList.length > 0 && (
                <div className="mt-4 rounded border border-slate-200 bg-white p-4 text-left">
                  <h3 className="mb-2 text-base font-bold">Available Providers</h3>
                  {providerList.map((p, index) => (
                    <div key={`${p.phone}-${index}`} className="py-1 text-sm text-slate-800">
                      {index + 1}. {p.name} – {p.phone}
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full max-w-sm rounded-full bg-orange-500 px-6 py-4 text-lg font-semibold text-white shadow-lg transition hover:bg-orange-600 disabled:opacity-60"
              >
                {submitting ? "Submitting..." : "Submit Request"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

