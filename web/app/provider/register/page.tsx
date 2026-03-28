"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import confetti from "canvas-confetti";
import { PROVIDER_PROFILE_UPDATED_EVENT } from "@/components/sidebarEvents";

// Change limits here if business rules change.
const MAX_CATEGORIES = 3;
const MIN_AREAS = 1;
const MAX_AREAS = 5;

type RegisterResponse = {
  ok?: boolean;
  status?: string;
  message?: string;
  error?: string;
  providerId?: string;
  verified?: string;
  pendingApproval?: string;
  requiresAdminApproval?: boolean;
  requestedNewCategories?: string[];
  provider?: {
    ProviderID?: string;
    Name?: string;
    Phone?: string;
    Verified?: string;
    PendingApproval?: string;
    Status?: string;
  };
};

type ProviderProfileResponse = {
  ok?: boolean;
  provider?: {
    ProviderID?: string;
    Name?: string;
    Phone?: string;
    Verified?: string;
    PendingApproval?: string;
    Status?: string;
  };
};

type ProviderByPhoneResponse = {
  ok?: boolean;
  provider?: {
    ProviderID?: string;
    ProviderName?: string;
    Phone?: string;
    Verified?: string;
    Services?: { Category: string }[];
    Areas?: { Area: string }[];
  };
  error?: string;
};

function normalizePhoneToTen(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits.slice(-10);
}

function normalizePhone10(phoneRaw: string): string {
  const digits = String(phoneRaw || "").replace(/\D/g, "");
  if (!digits) return "";
  const phone10 = digits.length > 10 ? digits.slice(-10) : digits;
  return phone10.length === 10 ? phone10 : "";
}

function getUserPhone(): string {
  const session = getAuthSession();
  if (session?.phone) return normalizePhoneToTen(session.phone);
  return "";
}

function uniqueStrings(items: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    const normalized = item.replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function normalizeCategoryInput(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function categoryKey(value: string): string {
  return normalizeCategoryInput(value).toLowerCase();
}

function removeCategoryKey(list: string[], keyToRemove: string): string[] {
  return list.filter((item) => categoryKey(item) !== keyToRemove);
}

function hasCategoryKey(list: string[], keyToFind: string): boolean {
  return list.some((item) => categoryKey(item) === keyToFind);
}

function toCategoryLookup(list: string[]): Set<string> {
  return new Set(list.map((item) => categoryKey(item)));
}

function uniqueCategoryValues(list: string[]): string[] {
  return uniqueStrings(list.map((item) => normalizeCategoryInput(item)));
}

async function parseJsonSafe(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Server returned invalid JSON");
  }
}

function normalizeLoadError(
  fallbackMessage: string,
  error: unknown,
  responseText?: string,
  responseStatus?: number
) {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("INVALID_JSON")) {
    const preview = message.replace("INVALID_JSON:", "").trim() || String(responseText || "").slice(0, 120);
    return `INVALID_JSON: ${preview || fallbackMessage}`;
  }
  if (message.startsWith("HTTP_ERROR:")) {
    return message.replace("HTTP_ERROR:", "").trim() || fallbackMessage;
  }
  if (responseStatus && responseStatus >= 400) {
    return `HTTP ${responseStatus}: ${String(responseText || "").slice(0, 120) || fallbackMessage}`;
  }
  return message || fallbackMessage;
}

function popConfetti() {
  confetti({ particleCount: 120, spread: 80, startVelocity: 45, origin: { y: 0.7 } });
  confetti({ particleCount: 80, spread: 120, startVelocity: 35, origin: { y: 0.6 } });
}

function normalizeAreaInput(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.toLowerCase().replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function capitalizeWords(text: string) {
  return text
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function ProviderRegisterPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const areaBoxRef = useRef<HTMLDivElement | null>(null);
  const step2Ref = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const ignoreNextOutsideClickRef = useRef(false);

  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [phone, setPhone] = useState("");

  const [name, setName] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [customCategoryKeys, setCustomCategoryKeys] = useState<string[]>([]);
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);

  const [catQuery, setCatQuery] = useState("");
  const [areaSearch, setAreaSearch] = useState("");
  const [showAreaSuggestions, setShowAreaSuggestions] = useState(false);
  const [shakeCategories, setShakeCategories] = useState(false);
  const [highlightCategories, setHighlightCategories] = useState(false);

  const [isLoadingCategories, setIsLoadingCategories] = useState(true);
  const [isLoadingAreas, setIsLoadingAreas] = useState(true);
  const [categoriesError, setCategoriesError] = useState("");
  const [areasError, setAreasError] = useState("");
  const [areasLimitError, setAreasLimitError] = useState("");
  const [celebrate, setCelebrate] = useState(false);
  const [celebrateText, setCelebrateText] = useState("");

  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState<RegisterResponse | null>(null);
  const [submittedRequiresApproval, setSubmittedRequiresApproval] = useState(false);
  const [showSuccessCelebration, setShowSuccessCelebration] = useState(false);
  const [successProviderId, setSuccessProviderId] = useState("");
  const [hasLoadedEditProfile, setHasLoadedEditProfile] = useState(false);

  const editTarget = searchParams.get("edit");
  const isEditMode = editTarget === "services" || editTarget === "areas";

  useEffect(() => {
    const userPhone = getUserPhone();
    if (!/^\d{10}$/.test(userPhone)) {
      router.replace("/login");
      return;
    }
    setPhone(userPhone);
    setIsAuthChecking(false);
  }, [router]);

  useEffect(() => {
    const loadCategories = async () => {
      setIsLoadingCategories(true);
      setCategoriesError("");
      try {
        const response = await fetch("/api/kk?action=get_all_categories", {
          cache: "no-store",
        });
        const text = await response.text();
        let data: any = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          throw new Error(`INVALID_JSON:${text.slice(0, 120)}`);
        }
        if (!response.ok) {
          const apiMessage =
            typeof data?.error === "string" && data.error.trim()
              ? data.error.trim()
              : text.slice(0, 120);
          throw new Error(`HTTP_ERROR: HTTP ${response.status} ${apiMessage}`.trim());
        }
        if (Array.isArray(data?.categories)) {
          setCategories(
            data.categories.filter((value: unknown): value is string => typeof value === "string")
          );
        } else {
          setCategories([]);
          setCategoriesError(
            (typeof data?.error === "string" && data.error) || "Failed to load categories"
          );
        }
      } catch (error) {
        setCategories([]);
        setCategoriesError(normalizeLoadError("Failed to load categories", error));
      } finally {
        setIsLoadingCategories(false);
      }
    };

    loadCategories();
  }, []);

  useEffect(() => {
    const loadAreas = async () => {
      setIsLoadingAreas(true);
      setAreasError("");
      try {
        const response = await fetch("/api/kk?action=get_areas", { cache: "no-store" });
        const text = await response.text();
        let data: any = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          throw new Error(`INVALID_JSON:${text.slice(0, 120)}`);
        }
        if (!response.ok) {
          const apiMessage =
            (typeof data?.error === "string" && data.error.trim()) || text.slice(0, 120);
          throw new Error(`HTTP_ERROR: HTTP ${response.status} ${apiMessage}`.trim());
        }
        const list = Array.isArray(data?.areas)
          ? data.areas.filter((value: unknown): value is string => typeof value === "string")
          : [];
        if (!Array.isArray(data?.areas) && typeof data?.error === "string" && data.error.trim()) {
          throw new Error(data.error.trim());
        }
        setAreas(list);
      } catch (error) {
        setAreas([]);
        setAreasError(normalizeLoadError("Failed to load areas", error));
      } finally {
        setIsLoadingAreas(false);
      }
    };

    loadAreas();
  }, []);

  useEffect(() => {
    if (!isEditMode || !/^\d{10}$/.test(phone) || hasLoadedEditProfile) {
      return;
    }

    let ignore = false;

    const loadExistingProvider = async () => {
      try {
        const response = await fetch(
          `/api/kk?action=get_provider_by_phone&phone=${encodeURIComponent(phone)}`,
          { cache: "no-store" }
        );
        const data = (await parseJsonSafe(response)) as ProviderByPhoneResponse | null;
        if (!response.ok || data?.ok !== true || !data.provider || ignore) {
          return;
        }

        const serviceCategories = uniqueCategoryValues(
          Array.isArray(data.provider.Services)
            ? data.provider.Services.map((service) => service.Category)
            : []
        );
        const serviceAreas = uniqueStrings(
          Array.isArray(data.provider.Areas)
            ? data.provider.Areas.map((area) => area.Area)
            : []
        );

        setName(String(data.provider.ProviderName || "").trim().toUpperCase());
        setSelectedCategories(serviceCategories);
        setSelectedAreas(serviceAreas);
        setCustomCategoryKeys([]);
      } catch {
        // Keep the form usable even if prefill fails.
      } finally {
        if (!ignore) {
          setHasLoadedEditProfile(true);
        }
      }
    };

    void loadExistingProvider();

    return () => {
      ignore = true;
    };
  }, [hasLoadedEditProfile, isEditMode, phone]);

  useEffect(() => {
    if (!isEditMode || !hasLoadedEditProfile) return;

    const targetNode = editTarget === "areas" ? areaBoxRef.current : step2Ref.current;
    if (!targetNode) return;

    const timeoutId = window.setTimeout(() => {
      targetNode.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);

    return () => window.clearTimeout(timeoutId);
  }, [editTarget, hasLoadedEditProfile, isEditMode]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (areaBoxRef.current && !areaBoxRef.current.contains(target)) {
        setShowAreaSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!celebrate) return;

    timerRef.current = setTimeout(() => {
      setCelebrate(false);
    }, 5000);

    const closeHandler = () => {
      if (ignoreNextOutsideClickRef.current) {
        ignoreNextOutsideClickRef.current = false;
        return;
      }
      setCelebrate(false);
    };

    window.addEventListener("click", closeHandler);
    window.addEventListener("touchstart", closeHandler);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      window.removeEventListener("click", closeHandler);
      window.removeEventListener("touchstart", closeHandler);
      ignoreNextOutsideClickRef.current = false;
    };
  }, [celebrate]);

  const filteredCategories = useMemo(() => {
    const q = categoryKey(catQuery);
    const selectedKeys = toCategoryLookup(selectedCategories);
    const pool = categories.filter((item) => !selectedKeys.has(categoryKey(item)));
    if (!q) return pool;
    return pool.filter((item) => categoryKey(item).includes(q));
  }, [categories, catQuery, selectedCategories]);

  const filteredAreaSuggestions = useMemo(() => {
    const q = areaSearch.trim().toLowerCase();
    const suggestions = areas.filter((item) => {
      if (selectedAreas.some((selected) => selected.toLowerCase() === item.toLowerCase())) {
        return false;
      }
      if (!q) return true;
      return item.toLowerCase().includes(q);
    });
    return suggestions;
  }, [areas, areaSearch, selectedAreas]);

  const normalizedCatQuery = normalizeCategoryInput(catQuery);
  const normalizedAreaQuery = normalizeAreaInput(areaSearch);
  const noMatch =
    normalizedCatQuery.length >= 3 &&
    !isLoadingCategories &&
    !categoriesError &&
    filteredCategories.length === 0;
  const totalSelectedServices = selectedCategories.length;
  const isMaxReached = totalSelectedServices >= MAX_CATEGORIES;
  const canAddCustomCategory = noMatch;
  const canAddCustomArea =
    normalizedAreaQuery.length >= 3 &&
    !isLoadingAreas &&
    !areasError &&
    filteredAreaSuggestions.length === 0 &&
    selectedAreas.length < MAX_AREAS;
  const isMaxAreasReached = selectedAreas.length >= MAX_AREAS;
  const canSubmit =
    !!name.trim() &&
    selectedCategories.length >= 1 &&
    selectedAreas.length >= MIN_AREAS &&
    !isSubmitting &&
    !showSuccessCelebration;
  const canAccessAreas = selectedCategories.length > 0;

  function nudgeSelectCategory() {
    setShakeCategories(true);
    setHighlightCategories(true);
    step2Ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => setShakeCategories(false), 550);
    window.setTimeout(() => setHighlightCategories(false), 1400);
  }

  const toggleCategory = (category: string) => {
    setSubmitError("");
    setSuccess(null);
    setSelectedCategories((prev) => {
      const normalized = normalizeCategoryInput(category);
      const key = categoryKey(normalized);
      if (!normalized) return prev;
      if (hasCategoryKey(prev, key)) {
        setCustomCategoryKeys((existingKeys) => existingKeys.filter((item) => item !== key));
        return removeCategoryKey(prev, key);
      }
      if (prev.length >= MAX_CATEGORIES) {
        return prev;
      }
      return [...prev, normalized];
    });
  };

  const addArea = (area: string) => {
    setSubmitError("");
    setSuccess(null);
    setAreasLimitError("");
    setSelectedAreas((prev) => {
      if (prev.some((item) => item.toLowerCase() === area.toLowerCase())) return prev;
      if (prev.length >= MAX_AREAS) {
        setAreasLimitError("Max 5 areas allowed");
        return prev;
      }
      return [...prev, area];
    });
    setAreaSearch("");
    setShowAreaSuggestions(false);
  };

  const removeCategory = (category: string) => {
    const key = categoryKey(category);
    setCustomCategoryKeys((prev) => prev.filter((item) => item !== key));
    setSelectedCategories((prev) => removeCategoryKey(prev, key));
  };

  const removeArea = (area: string) => {
    setAreasLimitError("");
    setSelectedAreas((prev) => prev.filter((item) => item !== area));
  };

  const handleAddCustomArea = () => {
    if (isMaxAreasReached) {
      setAreasLimitError("Max 5 areas allowed");
      return;
    }
    if (!canAddCustomArea) return;
    addArea(normalizedAreaQuery);
  };

  const requestNewCategoryInBackground = (requestedCategory: string) => {
    if (!/^\d{10}$/.test(phone)) return;
    void fetch("/api/kk?action=request_new_category", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phone,
        name: name.trim().toUpperCase(),
        requestedCategory,
        source: "provider_register",
        ts: new Date().toISOString(),
      }),
    }).catch(() => undefined);
  };

  const triggerConfettiAndModal = () => {
    setCelebrateText(
      "Woo hoo! Congratulations \uD83C\uDF89 You are the first one to register with us in this new category.\nWe have sent this request for admin approval."
    );
    ignoreNextOutsideClickRef.current = true;
    setCelebrate(true);
    popConfetti();
    setSubmitError("");
    setSuccess(null);
  };

  const handleAddCustomCategory = () => {
    if (!canAddCustomCategory) return;
    const pending = normalizedCatQuery;
    const key = categoryKey(pending);
    const selectedKeys = toCategoryLookup(selectedCategories);
    const newKeys = new Set(customCategoryKeys);
    if (selectedKeys.has(key) || newKeys.has(key)) {
      setCatQuery("");
      return;
    }
    if (totalSelectedServices >= MAX_CATEGORIES) {
      return;
    }
    setSelectedCategories((prev) => uniqueCategoryValues([...prev, pending]));
    setCustomCategoryKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setCatQuery("");
    triggerConfettiAndModal();
    requestNewCategoryInBackground(pending);
  };

  const handleSubmit = async () => {
    if (!canSubmit || !/^\d{10}$/.test(phone)) return;

    setIsSubmitting(true);
    setSubmitError("");
    setSuccess(null);

    try {
      const pendingNewCategories = selectedCategories.filter((category) =>
        customCategoryKeys.includes(categoryKey(category))
      );
      const customCategory = pendingNewCategories[0] || "";
      const payload = {
        action: "provider_register",
        phone,
        name: name.trim().toUpperCase(),
        categories: JSON.stringify(uniqueCategoryValues(selectedCategories)),
        areas: JSON.stringify(selectedAreas),
        pendingNewCategories: JSON.stringify(pendingNewCategories),
        customCategory,
        requiresAdminApproval: pendingNewCategories.length > 0 ? "true" : "false",
      };

      const response = await fetch("/api/kk", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = (await parseJsonSafe(response)) as RegisterResponse | null;
      if (!response.ok || data?.ok !== true) {
        throw new Error(data?.error || data?.message || "Failed to submit registration");
      }

      setSuccess(data ?? { ok: true, status: "success" });
      const requiresAdminApproval = Boolean(data?.requiresAdminApproval);
      setSubmittedRequiresApproval(requiresAdminApproval);
      if (typeof window !== "undefined") {
        const canonicalPhone = normalizePhone10(phone);
        const responseProviderId = data?.providerId || "";
        const fallbackProfile = {
          ProviderID: responseProviderId,
          Name: name.trim().toUpperCase(),
          Phone: canonicalPhone,
          Verified: String(data?.verified || data?.provider?.Verified || "no").trim() || "no",
          PendingApproval:
            String(data?.pendingApproval || data?.provider?.PendingApproval || "no").trim() ||
            "no",
          Status:
            data?.provider?.Status ||
            (requiresAdminApproval ? "Pending Admin Approval" : "Active"),
        };
        window.localStorage.setItem("kk_provider_profile", JSON.stringify(fallbackProfile));
        window.dispatchEvent(new Event(PROVIDER_PROFILE_UPDATED_EVENT));

        try {
          const profileResponse = await fetch(
            `/api/kk?action=get_provider_profile&phone=${encodeURIComponent(phone)}`,
            { cache: "no-store" }
          );
          const profileData = (await parseJsonSafe(profileResponse)) as ProviderProfileResponse | null;
          if (profileResponse.ok && profileData?.ok && profileData.provider) {
            window.localStorage.setItem(
              "kk_provider_profile",
              JSON.stringify(profileData.provider)
            );
            window.dispatchEvent(new Event(PROVIDER_PROFILE_UPDATED_EVENT));
          }
        } catch {
          // Sidebar will keep fallback until next successful profile refresh.
        }
      }
      setSuccessProviderId(data?.providerId || "");
      setShowSuccessCelebration(true);
      popConfetti();
      window.setTimeout(() => {
        router.push("/provider/dashboard");
      }, 2000);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to submit registration");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isAuthChecking) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="mx-auto w-full max-w-6xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          Loading...
        </div>
      </main>
    );
  }

  return (
    <main
      className={`min-h-screen bg-slate-50 px-4 py-8 ${
        showSuccessCelebration ? "pointer-events-none select-none" : ""
      }`}
    >
      <div className="mx-auto w-full max-w-6xl space-y-6">
        {isEditMode ? (
          <section className="rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4 shadow-sm">
            <p className="text-sm font-semibold text-sky-900">Edit Provider Profile</p>
            <p className="mt-1 text-sm text-sky-800">
              Your current provider details have been loaded so you can update your
              {editTarget === "areas" ? " service areas" : " services"} without changing the
              existing submission flow.
            </p>
          </section>
        ) : null}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-600">Service Provider</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900 md:text-3xl">List your service on Kaun Karega</h1>
          <p className="mt-2 text-sm text-slate-600">
            Complete your profile to join as a provider. Your application will go for verification.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="space-y-6">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Account</p>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  Logged-in WhatsApp: <span className="font-semibold text-slate-900">{phone}</span>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Step 1: Your name</label>
                <input
                  type="text"
                  value={name}
                  disabled={showSuccessCelebration}
                  onChange={(event) => {
                    setName(event.target.value.toUpperCase());
                    setSubmitError("");
                    setSuccess(null);
                  }}
                  placeholder="Enter your full name"
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 uppercase shadow-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label className="block text-sm font-semibold text-slate-700">Step 2: Service Categories</label>
                  <span className="text-xs font-medium text-slate-500">
                    {totalSelectedServices}/{MAX_CATEGORIES}
                  </span>
                </div>
                <p className="mb-2 text-xs text-slate-500">(Choose the services you actually provide)</p>
                <input
                  type="text"
                  value={catQuery}
                  onChange={(event) => {
                    const formatted = capitalizeWords(event.target.value);
                    setCatQuery(formatted);
                  }}
                  disabled={isMaxReached || showSuccessCelebration}
                  placeholder={
                    isMaxReached
                      ? "You have chosen the maximum service categories (3)"
                      : "Search categories"
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                />
                {isLoadingCategories ? <p className="mt-2 text-xs text-slate-500">Loading categories...</p> : null}
                {categoriesError ? <p className="mt-2 text-xs text-red-600">{categoriesError}</p> : null}
                <div
                  ref={step2Ref}
                  className={[
                    "mt-3 rounded-xl transition-all",
                    highlightCategories ? "ring-2 ring-red-400 bg-red-50/40" : "",
                    shakeCategories ? "kk-shake" : "",
                  ].join(" ")}
                >
                  {!isLoadingCategories && !categoriesError ? (
                    <div className="flex flex-wrap gap-2">
                    {filteredCategories.length > 0 ? (
                      filteredCategories.map((category) => {
                        const selected = hasCategoryKey(selectedCategories, categoryKey(category));
                        const disabled = !selected && totalSelectedServices >= MAX_CATEGORIES;
                        return (
                          <button
                            key={category}
                            type="button"
                            onClick={() => toggleCategory(category)}
                            disabled={disabled}
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                              selected
                                ? "border-green-700 bg-green-700 text-white"
                                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                            } disabled:cursor-not-allowed disabled:opacity-60`}
                          >
                            {category}
                          </button>
                        );
                      })
                    ) : null}
                    {canAddCustomCategory ? (
                      <button
                        type="button"
                        onClick={handleAddCustomCategory}
                        className="inline-flex items-center gap-2 rounded-full border border-green-700 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-800"
                      >
                        + Add "{normalizedCatQuery}" as new category
                      </button>
                    ) : null}
                    </div>
                  ) : null}
                  {totalSelectedServices > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                    {selectedCategories.map((category) => (
                      <button
                        key={category}
                        type="button"
                        onClick={() => removeCategory(category)}
                        className="inline-flex items-center gap-2 rounded-full border border-green-700 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-800"
                      >
                        {category}
                        {customCategoryKeys.includes(categoryKey(category)) ? (
                          <span className="rounded bg-green-700 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                            NEW
                          </span>
                        ) : null}
                        <span aria-hidden="true">x</span>
                      </button>
                    ))}
                    </div>
                  ) : null}
                </div>
                {highlightCategories ? (
                  <p className="mt-2 text-xs font-medium text-red-700">
                    Please select at least 1 service category first.
                  </p>
                ) : null}
              </div>

              <div
                ref={areaBoxRef}
                className="relative"
                tabIndex={!canAccessAreas ? 0 : -1}
                aria-disabled={!canAccessAreas}
                onMouseDown={(event) => {
                  if (canAccessAreas) return;
                  event.preventDefault();
                  nudgeSelectCategory();
                }}
                onClick={(event) => {
                  if (canAccessAreas) return;
                  event.preventDefault();
                  nudgeSelectCategory();
                }}
                onKeyDownCapture={(event) => {
                  if (canAccessAreas) return;
                  event.preventDefault();
                  nudgeSelectCategory();
                }}
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label className="block text-sm font-semibold text-slate-700">Step 3: Service areas</label>
                  <span className="text-xs font-medium text-slate-500">
                    {selectedAreas.length}/{MAX_AREAS}
                  </span>
                </div>
                <input
                  type="text"
                  value={areaSearch}
                  onFocus={() => {
                    if (canAccessAreas) {
                    setShowAreaSuggestions(true);
                    }
                  }}
                  onChange={(event) => {
                    if (!canAccessAreas) return;
                    setAreaSearch(event.target.value);
                    setAreasLimitError("");
                    setShowAreaSuggestions(true);
                  }}
                  readOnly={!canAccessAreas}
                  disabled={isMaxAreasReached || showSuccessCelebration || !canAccessAreas}
                  placeholder={
                    !canAccessAreas
                      ? "Select at least 1 category to choose areas"
                      : isMaxAreasReached
                      ? "You have chosen the maximum service areas (5)"
                      : "Search and select areas"
                  }
                  className={`w-full rounded-xl border px-4 py-3 text-sm shadow-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200 ${
                    canAccessAreas
                      ? "border-slate-200 bg-white text-slate-900"
                      : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500"
                  }`}
                />
                {isLoadingAreas ? <p className="mt-2 text-xs text-slate-500">Loading areas...</p> : null}
                {areasError ? <p className="mt-2 text-xs text-red-600">{areasError}</p> : null}
                {areasLimitError ? <p className="mt-2 text-xs text-red-600">{areasLimitError}</p> : null}
                {canAddCustomArea ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleAddCustomArea}
                      className="inline-flex items-center gap-2 rounded-full border border-sky-700 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800"
                    >
                      + Add "{normalizedAreaQuery}" as new area
                    </button>
                  </div>
                ) : null}
                {showAreaSuggestions &&
                canAccessAreas &&
                !isLoadingAreas &&
                !areasError &&
                !isMaxAreasReached ? (
                  <div className="absolute z-20 mt-2 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                    {filteredAreaSuggestions.length === 0 ? (
                      canAddCustomArea ? null : <p className="px-2 py-1 text-xs text-slate-500">No area match found.</p>
                    ) : (
                      filteredAreaSuggestions.map((area) => {
                        const isLimitReached = selectedAreas.length >= MAX_AREAS;
                        return (
                          <button
                            key={area}
                            type="button"
                            onClick={() => addArea(area)}
                            disabled={isLimitReached}
                            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {area}
                          </button>
                        );
                      })
                    )}
                  </div>
                ) : null}
                {selectedAreas.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedAreas.map((area) => (
                      <button
                        key={area}
                        type="button"
                        onClick={() => removeArea(area)}
                        className="inline-flex items-center gap-2 rounded-full border border-sky-700 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800"
                      >
                        {area}
                        <span aria-hidden="true">x</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {submitError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{submitError}</div>
              ) : null}

                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-white" />
                    Submitting...
                  </>
                  ) : (
                    isEditMode ? "Save Changes" : "Submit Application"
                  )}
                </button>
              </div>
          </section>

          <aside className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Summary</h2>
            <div className="mt-4 space-y-4 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Name</p>
                <p className="mt-1 font-medium text-slate-900">{name.trim() || "-"}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Phone</p>
                <p className="mt-1 font-medium text-slate-900">{phone || "-"}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Service Categories</p>
                {selectedCategories.length > 0 ? (
                  <p className="mt-1 text-slate-700">{selectedCategories.join(", ")}</p>
                ) : (
                  <p className="mt-1 text-slate-700">-</p>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Areas</p>
                <p className="mt-1 text-slate-700">{selectedAreas.length > 0 ? selectedAreas.join(", ") : "-"}</p>
              </div>
            </div>

            {success ? (
            <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-4">
              <p className="text-sm font-semibold text-green-800">
                  {success.message ||
                    (submittedRequiresApproval
                      ? "Application submitted successfully. Your new category request is pending admin approval."
                      : "Registration successful. Your profile has been verified successfully.")}
              </p>
              <p className="mt-2 text-sm text-green-900">
                ProviderID: <span className="font-bold">{success.providerId || "Will be assigned soon"}</span>
              </p>
              {success.requestedNewCategories?.length ? (
                <p className="mt-2 text-xs text-green-700">
                  Pending categories: {success.requestedNewCategories.join(", ")}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-green-700">
                Selected: {selectedCategories.length} categories, {selectedAreas.length} areas
              </p>
            </div>
          ) : null}
          </aside>
        </div>
      </div>
      {celebrate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="relative p-6 text-center">
            <button
              type="button"
              onClick={() => setCelebrate(false)}
              className="absolute right-3 top-3 rounded-md px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close celebration"
            >
              X
            </button>
              <h2 className="text-2xl font-bold tracking-wide text-[#0F5132] drop-shadow-sm md:text-3xl">
                🎉 Congratulations!
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-gray-600">
                You are the first service provider to register in this category on Kaun Karega.
                <br />
                Our team will review and approve it shortly.
                <br />
                Thank you for helping us grow 🚀
              </p>
            </div>
          </div>
        </div>
      ) : null}
      {showSuccessCelebration ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 px-4">
          <div className="w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-6 text-center shadow-2xl">
            <h2 className="text-2xl font-bold tracking-wide text-emerald-700 md:text-3xl">
              Congratulations!
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-700">
              {submittedRequiresApproval
                ? "Your application has been submitted successfully and is pending admin approval."
                : "You are now a registered and verified service provider on Kaun Karega."}
            </p>
            <p className="mt-3 text-sm font-semibold text-slate-900">
              ProviderID: {successProviderId || "PR-xxxx"}
            </p>
          </div>
        </div>
      ) : null}
      <style jsx global>{`
        @keyframes kk-shake {
          0%,
          100% {
            transform: translateX(0);
          }
          15% {
            transform: translateX(-8px);
          }
          30% {
            transform: translateX(6px);
          }
          45% {
            transform: translateX(-4px);
          }
          60% {
            transform: translateX(6px);
          }
          75% {
            transform: translateX(-4px);
          }
          90% {
            transform: translateX(4px);
          }
        }
        .kk-shake {
          animation: kk-shake 0.55s ease-in-out;
        }
      `}</style>
    </main>
  );
}

export default function ProviderRegisterPage() {
  return (
    <Suspense fallback={null}>
      <ProviderRegisterPageInner />
    </Suspense>
  );
}
