"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getAuthSession } from "@/lib/auth";

// ─── Constants (unchanged from original) ──────────────────────────────────────

const CATEGORY_OPTIONS = [
  "Employer",
  "Employee",
  "Property Seller",
  "Property Buyer",
  "Landlord",
  "Tenant",
  "Vehicle Seller",
  "Vehicle Buyer",
  "Other",
];

const AREA_OPTIONS = [
  "Sardarpura",
  "Shastri Nagar",
  "Ratanada",
  "Paota",
  "Basni",
  "Pal Road",
  "Chopasni Housing Board",
  "Mandore",
  "Soorsagar",
  "Kudi Bhagtasni",
];

const VALIDITY_OPTIONS = [
  { value: "3", label: "3 days" },
  { value: "7", label: "7 days" },
  { value: "15", label: "15 days" },
  { value: "30", label: "30 days" },
];

// ─── Dynamic option groups per category ───────────────────────────────────────

type OptionGroup = {
  key: string;
  label: string;
  options: string[];
};

const DYNAMIC_OPTIONS: Record<string, OptionGroup[]> = {
  Employer: [
    {
      key: "work_field",
      label: "Looking for work in",
      options: [
        "Office",
        "Sales",
        "Delivery",
        "Shop / Retail",
        "Technical",
        "Helper / Labour",
        "Education",
        "Other",
      ],
    },
    {
      key: "qualification",
      label: "Qualification",
      options: ["10th", "12th", "Graduate", "Postgraduate", "Other"],
    },
    {
      key: "experience",
      label: "Experience",
      options: ["Fresher", "1–2 Years", "3–5 Years", "5+ Years", "Other"],
    },
    {
      key: "expected_salary",
      label: "Expected Salary",
      options: ["Under 10k", "10k–15k", "15k–25k", "25k+", "Other"],
    },
    {
      key: "preferred_work_type",
      label: "Preferred Work Type",
      options: ["Full Time", "Part Time", "Field Work", "Office Work", "Other"],
    },
  ],
  Employee: [
    {
      key: "hiring_for",
      label: "Hiring For",
      options: ["Office Staff", "Sales", "Delivery", "Helper", "Technician", "Other"],
    },
    {
      key: "experience_needed",
      label: "Experience Needed",
      options: ["Fresher", "1+ Years", "2+ Years", "5+ Years", "Other"],
    },
    {
      key: "salary_offered",
      label: "Salary Offered",
      options: ["Under 10k", "10k–15k", "15k–25k", "25k+", "Other"],
    },
    {
      key: "job_type",
      label: "Job Type",
      options: ["Full Time", "Part Time", "Contract", "Other"],
    },
  ],
  "Property Seller": [
    {
      key: "looking_for",
      label: "Looking For",
      options: ["Plot", "Flat", "House", "Shop", "Commercial", "Other"],
    },
    {
      key: "budget_range",
      label: "Budget Range",
      options: ["Under 10L", "10L–25L", "25L–50L", "50L+", "Other"],
    },
    {
      key: "preferred_size",
      label: "Preferred Size",
      options: ["1 BHK", "2 BHK", "3 BHK+", "Plot", "Other"],
    },
  ],
  "Property Buyer": [
    {
      key: "property_type",
      label: "Property Type",
      options: ["Plot", "Flat", "House", "Shop", "Commercial", "Other"],
    },
    {
      key: "budget_range",
      label: "Asking Price",
      options: ["Under 10L", "10L–25L", "25L–50L", "50L+", "Other"],
    },
    {
      key: "property_size",
      label: "Property Size",
      options: ["1 BHK", "2 BHK", "3 BHK+", "Plot", "Other"],
    },
  ],
  Landlord: [
    {
      key: "looking_for",
      label: "Looking For",
      options: ["Room", "Flat", "House", "PG", "Shop", "Other"],
    },
    {
      key: "budget",
      label: "Budget",
      options: ["Under 5k", "5k–10k", "10k–20k", "20k+", "Other"],
    },
    {
      key: "preference",
      label: "Preference",
      options: ["Family", "Bachelor", "Students", "Anyone", "Other"],
    },
    {
      key: "furnishing",
      label: "Furnishing",
      options: ["Furnished", "Semi-Furnished", "Unfurnished", "Other"],
    },
  ],
  Tenant: [
    {
      key: "property_type",
      label: "Property Type",
      options: ["Room", "Flat", "House", "PG", "Shop", "Other"],
    },
    {
      key: "monthly_rent",
      label: "Monthly Rent",
      options: ["Under 5k", "5k–10k", "10k–20k", "20k+", "Other"],
    },
    {
      key: "tenant_preference",
      label: "Tenant Preference",
      options: ["Family", "Bachelor", "Students", "Anyone", "Other"],
    },
    {
      key: "furnishing",
      label: "Furnishing",
      options: ["Furnished", "Semi-Furnished", "Unfurnished", "Other"],
    },
  ],
  "Vehicle Seller": [
    {
      key: "looking_for",
      label: "Looking For",
      options: ["Bike", "Scooter", "Car", "Auto", "Commercial Vehicle", "Other"],
    },
    {
      key: "budget",
      label: "Budget",
      options: ["Under 50k", "50k–2L", "2L–5L", "5L+", "Other"],
    },
    {
      key: "preference",
      label: "Preference",
      options: ["New", "Used", "Any", "Other"],
    },
  ],
  "Vehicle Buyer": [
    {
      key: "vehicle_type",
      label: "Vehicle Type",
      options: ["Bike", "Scooter", "Car", "Auto", "Commercial Vehicle", "Other"],
    },
    {
      key: "price_range",
      label: "Price Range",
      options: ["Under 50k", "50k–2L", "2L–5L", "5L+", "Other"],
    },
    {
      key: "condition",
      label: "Condition",
      options: ["Excellent", "Good", "Average", "Urgent Sale", "Other"],
    },
  ],
};

// ─── Auth helpers (unchanged from original) ───────────────────────────────────

function normalizePhoneToTen(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits.slice(-10);
}

function getUserPhone(): string {
  const session = getAuthSession();
  if (session?.phone) return normalizePhoneToTen(session.phone);
  return "";
}

// ─── Chip components ──────────────────────────────────────────────────────────

function Chip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition active:scale-95 ${
        selected
          ? "border-violet-600 bg-violet-600 text-white shadow-sm"
          : "border-slate-200 bg-white text-slate-600 hover:border-violet-300 hover:text-violet-700"
      }`}
    >
      {label}
    </button>
  );
}

function ChipGroup({
  group,
  selected,
  otherText,
  onSelect,
  onOtherText,
}: {
  group: OptionGroup;
  selected: string;
  otherText: string;
  onSelect: (key: string, value: string) => void;
  onOtherText: (key: string, value: string) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {group.label}
      </p>
      <div className="flex flex-wrap gap-2">
        {group.options.map((option) => (
          <Chip
            key={option}
            label={option}
            selected={selected === option}
            onClick={() => onSelect(group.key, option)}
          />
        ))}
      </div>
      {selected === "Other" && (
        <input
          type="text"
          value={otherText}
          onChange={(e) => onOtherText(group.key, e.target.value)}
          placeholder={`Describe your ${group.label.toLowerCase()}...`}
          className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
        />
      )}
    </div>
  );
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepLabel({ n, label }: { n: number; label: string }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white">
        {n}
      </span>
      <p className="text-sm font-semibold text-slate-800">{label}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PostNeedPage() {
  const router = useRouter();

  // ── Base fields (original — fed into existing submit payload) ──
  const [category, setCategory] = useState("");
  const [area, setArea] = useState("");
  const [validity, setValidity] = useState("3");
  const [displayName, setDisplayName] = useState("");
  const [identityMode, setIdentityMode] = useState<"show-name" | "anonymous">("show-name");
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Dynamic quick-select state (UI only — not yet wired to payload) ──
  const [dynamicSelections, setDynamicSelections] = useState<Record<string, string>>({});
  const [dynamicOtherText, setDynamicOtherText] = useState<Record<string, string>>({});

  const isAnonymous = identityMode === "anonymous";
  const dynamicGroups = category ? (DYNAMIC_OPTIONS[category] ?? []) : [];

  function handleCategorySelect(value: string) {
    setCategory(value);
    // Reset dynamic state when category changes
    setDynamicSelections({});
    setDynamicOtherText({});
  }

  function handleDynamicSelect(key: string, value: string) {
    setDynamicSelections((prev) => ({ ...prev, [key]: value }));
    // Clear other-text if switching away from Other
    if (value !== "Other") {
      setDynamicOtherText((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  function handleDynamicOtherText(key: string, value: string) {
    setDynamicOtherText((prev) => ({ ...prev, [key]: value }));
  }

  function getSelectionLabel(key: string): string {
    const selected = (dynamicSelections[key] ?? "").trim();
    if (!selected) return "";
    if (selected !== "Other") return selected;
    return (dynamicOtherText[key] ?? "").trim();
  }

  function generateTitle(): string {
    const areaLabel = area.trim();

    if (category === "Employer") {
      const workField = getSelectionLabel("work_field");
      const experience = getSelectionLabel("experience");
      const expectedSalary = getSelectionLabel("expected_salary");
      const prefix = workField ? `Looking for ${workField.toLowerCase()} job` : "Looking for job";
      const parts = [experience, expectedSalary].filter(Boolean);
      return `${prefix}${parts.length ? ` • ${parts.join(" • ")}` : ""}${areaLabel ? ` in ${areaLabel}` : ""}`.trim();
    }

    if (category === "Employee") {
      const hiringFor = getSelectionLabel("hiring_for");
      const experienceNeeded = getSelectionLabel("experience_needed");
      const salaryOffered = getSelectionLabel("salary_offered");
      const prefix = hiringFor ? `Hiring for ${hiringFor.toLowerCase()}` : "Hiring";
      const parts = [experienceNeeded, salaryOffered].filter(Boolean);
      return `${prefix}${parts.length ? ` • ${parts.join(" • ")}` : ""}${areaLabel ? ` in ${areaLabel}` : ""}`.trim();
    }

    if (category === "Property Seller") {
      const lookingFor = getSelectionLabel("looking_for");
      const budget = getSelectionLabel("budget_range");
      const size = getSelectionLabel("preferred_size");
      const prefix = lookingFor ? `Looking for ${lookingFor.toLowerCase()}` : "Looking for property";
      const parts = [budget ? `Budget ${budget}` : "", size].filter(Boolean);
      return `${prefix}${parts.length ? ` • ${parts.join(" • ")}` : ""}${areaLabel ? ` in ${areaLabel}` : ""}`.trim();
    }

    if (category === "Property Buyer") {
      const propertyType = getSelectionLabel("property_type");
      const askingPrice = getSelectionLabel("budget_range");
      const propertySize = getSelectionLabel("property_size");
      const prefix = propertyType ? `${propertyType} for sale` : "Property for sale";
      const parts = [askingPrice, propertySize].filter(Boolean);
      return `${prefix}${parts.length ? ` • ${parts.join(" • ")}` : ""}${areaLabel ? ` in ${areaLabel}` : ""}`.trim();
    }

    if (category === "Tenant") {
      const propertyType = getSelectionLabel("property_type");
      const monthlyRent = getSelectionLabel("monthly_rent");
      const tenantPreference = getSelectionLabel("tenant_preference");
      const prefix = propertyType ? `${propertyType} for rent` : "Place for rent";
      const parts = [monthlyRent, tenantPreference ? `${tenantPreference} preferred` : ""].filter(Boolean);
      return `${prefix}${parts.length ? ` • ${parts.join(" • ")}` : ""}${areaLabel ? ` in ${areaLabel}` : ""}`.trim();
    }

    if (category === "Landlord") {
      const lookingFor = getSelectionLabel("looking_for");
      const budget = getSelectionLabel("budget");
      const preference = getSelectionLabel("preference");
      const prefix = lookingFor ? `Looking for ${lookingFor.toLowerCase()}` : "Looking for rental";
      const parts = [budget ? `Budget ${budget}` : "", preference].filter(Boolean);
      return `${prefix}${parts.length ? ` • ${parts.join(" • ")}` : ""}${areaLabel ? ` in ${areaLabel}` : ""}`.trim();
    }

    if (category === "Vehicle Seller") {
      const lookingFor = getSelectionLabel("looking_for");
      const budget = getSelectionLabel("budget");
      const prefix = lookingFor ? `Looking for ${lookingFor.toLowerCase()}` : "Looking for vehicle";
      const parts = [budget ? `Budget ${budget}` : ""].filter(Boolean);
      return `${prefix}${parts.length ? ` • ${parts.join(" • ")}` : ""}${areaLabel ? ` in ${areaLabel}` : ""}`.trim();
    }

    if (category === "Vehicle Buyer") {
      const vehicleType = getSelectionLabel("vehicle_type");
      const priceRange = getSelectionLabel("price_range");
      const condition = getSelectionLabel("condition");
      const prefix = vehicleType ? `${vehicleType} for sale` : "Vehicle for sale";
      const parts = [priceRange, condition].filter(Boolean);
      return `${prefix}${parts.length ? ` • ${parts.join(" • ")}` : ""}${areaLabel ? ` in ${areaLabel}` : ""}`.trim();
    }

    return `${category || "Need"}${areaLabel ? ` in ${areaLabel}` : ""}`.trim();
  }

  function generateDescription(): string {
    if (!dynamicGroups.length) return "";

    return dynamicGroups
      .map((group) => {
        const value = getSelectionLabel(group.key);
        return value ? `${group.label}: ${value}` : "";
      })
      .filter(Boolean)
      .join("\n");
  }

  // ── Submit (original — payload unchanged) ──────────────────────────────────
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setSubmitError("");
    setSubmitSuccess("");

    const userPhone = getUserPhone();
    if (!userPhone) {
      setSubmitError("Please verify your phone number before posting a need.");
      return;
    }

    const payload = {
      action: "create_need",
      UserPhone: userPhone,
      Category: category.trim(),
      Area: area.trim(),
      Title: generateTitle(),
      Description: generateDescription(),
      ValidDays: Number(validity) || 3,
      IsAnonymous: isAnonymous,
      DisplayName: isAnonymous ? "" : displayName.trim(),
    };

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const raw = await response.text();
      let data: Record<string, unknown> | null = null;
      try {
        data = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        data = null;
      }

      if (!response.ok || data?.ok !== true) {
        throw new Error(
          String(data?.error || data?.message || "Failed to post your need.")
        );
      }

      setCategory("");
      setArea("");
      setValidity("3");
      setDisplayName("");
      setIdentityMode("show-name");
      setDynamicSelections({});
      setDynamicOtherText({});
      router.replace("/i-need/my-needs");
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Failed to post your need."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-xl px-4 pb-12 pt-8 sm:px-6">

        {/* Header */}
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-violet-500">
            Post a Request
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            Post Your Need
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Fill in a few quick details — done in under a minute.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* ── Step 1: Category + Area ── */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <StepLabel n={1} label="What are you looking for?" />

            {/* Category chips */}
            <div className="flex flex-wrap gap-2">
              {CATEGORY_OPTIONS.map((opt) => (
                <Chip
                  key={opt}
                  label={opt}
                  selected={category === opt}
                  onClick={() => handleCategorySelect(opt)}
                />
              ))}
            </div>

            {/* Area */}
            <div className="mt-4">
              <label
                htmlFor="need-area"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Area
              </label>
              <input
                id="need-area"
                list="i-need-post-area-options"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder="Type or select your area"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
              <datalist id="i-need-post-area-options">
                {AREA_OPTIONS.map((opt) => (
                  <option key={opt} value={opt} />
                ))}
              </datalist>
            </div>
          </div>

          {/* ── Step 2: Dynamic quick-select options ── */}
          {category && category !== "Other" && dynamicGroups.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <StepLabel n={2} label="Quick details" />
              <div className="space-y-5">
                {dynamicGroups.map((group) => (
                  <ChipGroup
                    key={group.key}
                    group={group}
                    selected={dynamicSelections[group.key] ?? ""}
                    otherText={dynamicOtherText[group.key] ?? ""}
                    onSelect={handleDynamicSelect}
                    onOtherText={handleDynamicOtherText}
                  />
                ))}
              </div>
            </div>
          )}

          {category === "Other" && (
            <div className="rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3 text-sm text-violet-700">
              Pick the closest options you can. A short title will be generated automatically.
            </div>
          )}

          {/* ── Step 3: Title + Description + Validity ── */}
          {category && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <StepLabel
                n={category !== "Other" && dynamicGroups.length > 0 ? 3 : 2}
                label="Review your post"
              />

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Auto-generated title
                </p>
                <p className="mt-1 text-sm font-medium text-slate-800">
                  {generateTitle() || "Your title will be generated from the options above."}
                </p>
              </div>

              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Keep this post active for
                </p>
                <div className="flex flex-wrap gap-2">
                  {VALIDITY_OPTIONS.map((opt) => (
                    <Chip
                      key={opt.value}
                      label={opt.label}
                      selected={validity === opt.value}
                      onClick={() => setValidity(opt.value)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Step 4: Identity ── */}
          {category && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <StepLabel
                n={category !== "Other" && dynamicGroups.length > 0 ? 4 : 3}
                label="Your identity"
              />

              <div className="inline-flex w-full rounded-xl border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setIdentityMode("show-name")}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    !isAnonymous
                      ? "bg-white text-violet-700 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Show my name
                </button>
                <button
                  type="button"
                  onClick={() => setIdentityMode("anonymous")}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    isAnonymous
                      ? "bg-white text-violet-700 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Post anonymously
                </button>
              </div>

              {!isAnonymous ? (
                <input
                  id="display-name"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Ramesh S."
                  className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                />
              ) : (
                <p className="mt-3 text-xs text-slate-400">
                  Your post will appear as{" "}
                  <span className="font-medium text-slate-500">Anonymous</span>.
                </p>
              )}
            </div>
          )}

          {/* ── Feedback messages ── */}
          {submitError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {submitError}
            </div>
          )}
          {submitSuccess && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {submitSuccess}
            </div>
          )}

          {/* ── Submit ── */}
          <button
            type="submit"
            disabled={isSubmitting || !category || !area.trim()}
            className="w-full rounded-xl bg-violet-600 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Posting..." : "Post Need"}
          </button>
        </form>
      </div>
    </div>
  );
}

