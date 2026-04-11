"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";

import AreaSelection, {
  normalizeAreaValue,
} from "@/app/(public)/components/AreaSelection";
import WhenNeedIt from "@/app/(public)/components/WhenNeedIt";
import { getAuthSession, setAuthSession } from "@/lib/auth";
import logo from "@/public/kaun-karega-logo.svg";

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


type CategoryOption = {
  name: string;
  active?: string | boolean;
};

type ActiveCategory = {
  originalName: string;
  normName: string;
};

type CategoryResolution = {
  resolvedName: string;
  confidence: number;
  reason: "exact" | "fuzzy" | "none";
  isConfident: boolean;
  bestMatch: string | null;
};

const normalizeCategory = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");

const levenshteinDistance = (a: string, b: string) => {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const dp = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0)
  );
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[a.length][b.length];
};

const similarityScore = (a: string, b: string) => {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLen;
};

const resolveCategory = (
  userInput: string,
  activeCategories: ActiveCategory[]
): CategoryResolution => {
  const normalizedInput = normalizeCategory(userInput);
  if (!normalizedInput) {
    return {
      resolvedName: "",
      confidence: 0,
      reason: "none",
      isConfident: false,
      bestMatch: null,
    };
  }

  const exactMatch = activeCategories.find(
    (item) => item.normName === normalizedInput
  );
  if (exactMatch) {
    return {
      resolvedName: exactMatch.originalName,
      confidence: 1,
      reason: "exact",
      isConfident: true,
      bestMatch: exactMatch.originalName,
    };
  }

  const best = activeCategories.reduce<{
    name: string;
    normName: string;
    similarity: number;
    distance: number;
  } | null>((currentBest, item) => {
    const distance = levenshteinDistance(normalizedInput, item.normName);
    const similarity = similarityScore(normalizedInput, item.normName);
    if (!currentBest || similarity > currentBest.similarity) {
      return {
        name: item.originalName,
        normName: item.normName,
        similarity,
        distance,
      };
    }
    return currentBest;
  }, null);

  if (!best) {
    return {
      resolvedName: "",
      confidence: 0,
      reason: "none",
      isConfident: false,
      bestMatch: null,
    };
  }

  const maxLen = Math.max(normalizedInput.length, best.normName.length);
  const confident =
    best.similarity >= 0.82 ||
    (best.distance <= 2 && maxLen <= 12) ||
    (best.distance <= 3 && maxLen > 12);

  return {
    resolvedName: best.name,
    confidence: best.similarity,
    reason: confident ? "fuzzy" : "none",
    isConfident: confident,
    bestMatch: best.name,
  };
};

const TASK_DRAFT_STORAGE_KEY = "kk_task_draft_v1";

type TaskDraft = {
  category?: string;
  area?: string;
  urgency?: string;
  time?: string;
  serviceDate?: string;
  timeSlot?: string;
  details?: string;
};

const saveTaskDraftToSessionStorage = (draft: TaskDraft) => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(TASK_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch (error) {
    console.warn("Unable to save task draft", error);
  }
};

const readTaskDraftFromSessionStorage = (): TaskDraft | null => {
  if (typeof window === "undefined") return null;
  try {
    const rawDraft = window.sessionStorage.getItem(TASK_DRAFT_STORAGE_KEY);
    if (!rawDraft) return null;
    const parsedDraft = JSON.parse(rawDraft) as TaskDraft;
    return parsedDraft && typeof parsedDraft === "object" ? parsedDraft : null;
  } catch (error) {
    console.warn("Unable to read task draft", error);
    return null;
  }
};

const clearTaskDraftFromSessionStorage = () => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(TASK_DRAFT_STORAGE_KEY);
  } catch (error) {
    console.warn("Unable to clear task draft", error);
  }
};

const buildSuccessRedirect = (service: string, area: string, taskId = "", displayId = "") => {
  const params = new URLSearchParams();
  const trimmedService = service.trim();
  const normalizedArea = normalizeAreaValue(area);
  if (trimmedService) params.set("service", trimmedService);
  if (normalizedArea) params.set("area", normalizedArea);
  if (taskId.trim()) params.set("taskId", taskId.trim());
  if (displayId.trim()) params.set("displayId", displayId.trim());
  const query = params.toString();
  return query ? `/success?${query}` : "/success";
};

export default function Home() {
  return (
    <>
      <Suspense
        fallback={
          <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-10">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700 shadow-sm">
              Loading Kaun Karega…
            </div>
          </div>
        }
      >
        <PageContent />
      </Suspense>
    </>
  );
}

function PageContent() {
  const router = useRouter();
  const params = useSearchParams();
  const categoryInputRef = useRef<HTMLInputElement | null>(null);
  const categoryDropdownRef = useRef<HTMLDivElement | null>(null);

  const [category, setCategory] = useState(params.get("category") || "");
  const [time, setTime] = useState("");
  const [serviceDate, setServiceDate] = useState("");
  const [timeSlot, setTimeSlot] = useState("");
  const [area, setArea] = useState("");
  const [areaError, setAreaError] = useState("");
  const [details, setDetails] = useState("");
  const [error, setError] = useState("");
  const [debug, setDebug] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [categoryList, setCategoryList] = useState<CategoryOption[]>([]);
  const [isCategoryFocused, setIsCategoryFocused] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [showDirectContactOption, setShowDirectContactOption] = useState(false);
  const [providersList, setProvidersList] = useState<any[]>([]);
  const [showProvidersList, setShowProvidersList] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(
    (params.get("category") || "").trim()
  );
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [requestId, setRequestId] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpError, setOtpError] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [otpTimer, setOtpTimer] = useState(120); // seconds
  const [canResend, setCanResend] = useState(false);
  const [shakeOtp, setShakeOtp] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const lastOtpSentAtRef = useRef(0);

  // ── Typewriter animation ──────────────────────────────────────────────────
  const TW_HINTS = ["Carpenter", "Plumber", "Electrician", "Mechanic", "Teacher", "Home Tutor", "AC Repair"];
  const TW_TYPE_MS = 80;
  const TW_DELETE_MS = 45;
  const TW_PAUSE_COMPLETE_MS = 1400;
  const TW_PAUSE_BETWEEN_MS = 380;

  const [twText, setTwText] = useState("");
  const [twCaretOn, setTwCaretOn] = useState(true);
  const twTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const twCaretIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const twWordIdx = useRef(0);
  const twCharIdx = useRef(0);
  const twPhase = useRef<"typing" | "paused" | "deleting">("typing");

  useEffect(() => {
    const shouldAnimate = isHydrated && !isCategoryFocused && category === "";

    const stopAll = () => {
      if (twTimerRef.current) { clearTimeout(twTimerRef.current); twTimerRef.current = null; }
      if (twCaretIntervalRef.current) { clearInterval(twCaretIntervalRef.current); twCaretIntervalRef.current = null; }
    };

    if (!shouldAnimate) {
      stopAll();
      setTwText("");
      setTwCaretOn(true);
      return;
    }

    // Reset to start of current word index (or beginning)
    twCharIdx.current = 0;
    twPhase.current = "typing";
    setTwText("");

    // Blinking caret — toggles every 530 ms
    twCaretIntervalRef.current = setInterval(() => {
      setTwCaretOn((v) => !v);
    }, 530);

    function tick() {
      const word = TW_HINTS[twWordIdx.current % TW_HINTS.length];

      if (twPhase.current === "typing") {
        if (twCharIdx.current < word.length) {
          twCharIdx.current += 1;
          setTwText(word.slice(0, twCharIdx.current));
          twTimerRef.current = setTimeout(tick, TW_TYPE_MS);
        } else {
          twPhase.current = "paused";
          twTimerRef.current = setTimeout(tick, TW_PAUSE_COMPLETE_MS);
        }
      } else if (twPhase.current === "paused") {
        twPhase.current = "deleting";
        twTimerRef.current = setTimeout(tick, 0);
      } else {
        // deleting
        if (twCharIdx.current > 0) {
          twCharIdx.current -= 1;
          setTwText(word.slice(0, twCharIdx.current));
          twTimerRef.current = setTimeout(tick, TW_DELETE_MS);
        } else {
          twWordIdx.current = (twWordIdx.current + 1) % TW_HINTS.length;
          twPhase.current = "typing";
          twTimerRef.current = setTimeout(tick, TW_PAUSE_BETWEEN_MS);
        }
      }
    }

    twTimerRef.current = setTimeout(tick, TW_PAUSE_BETWEEN_MS);

    return stopAll;
  }, [isHydrated, isCategoryFocused, category]); // eslint-disable-line react-hooks/exhaustive-deps
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    const fromParams = params.get("category") || "";
    if (fromParams && fromParams !== category) {
      setCategory(fromParams);
      setSelectedCategory(fromParams.trim());
      console.debug("[home] category selected from query:", fromParams.trim());
    }
  }, [params, category]);

  useEffect(() => {
    const draft = readTaskDraftFromSessionStorage();
    if (!draft) return;

    const hasCategoryFromParams = Boolean(params.get("category"));
    if (!hasCategoryFromParams && typeof draft.category === "string") {
      setCategory(draft.category);
      setSelectedCategory(draft.category.trim());
      console.debug("[home] category restored from draft:", draft.category.trim());
    }
    if (typeof draft.area === "string") {
      const normalizedDraftArea = normalizeAreaValue(draft.area);
      setArea(normalizedDraftArea);
      console.debug("[home] area restored from draft:", normalizedDraftArea);
    }
    if (typeof draft.time === "string") {
      setTime(draft.time);
    } else if (typeof draft.urgency === "string") {
      setTime(draft.urgency);
    }
    if (typeof draft.serviceDate === "string") {
      setServiceDate(draft.serviceDate);
    }
    if (typeof draft.timeSlot === "string") {
      setTimeSlot(draft.timeSlot);
    }
    if (typeof draft.details === "string") {
      setDetails(draft.details);
    }
  }, [params]);

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const res = await fetch("/api/get-categories");
        if (!res.ok) {
          throw new Error("Failed to fetch categories");
        }
        const data = await res.json();
        const categoriesRaw = Array.isArray(data)
          ? data
          : Array.isArray(data?.categories)
          ? data.categories
          : Array.isArray(data?.data)
          ? data.data
          : [];
        const normalized = categoriesRaw
          .map((item: unknown): CategoryOption | null => {
            if (typeof item === "string") {
              return { name: item };
            }
            if (item && typeof item === "object") {
              const record = item as Record<string, unknown>;
              const name =
                (typeof record.name === "string" && record.name) ||
                (typeof record.label === "string" && record.label) ||
                (typeof record.category === "string" && record.category) ||
                (typeof record.category_name === "string" &&
                  record.category_name) ||
                "";
              if (!name) return null;
              return {
                name,
                active: record.active as string | boolean | undefined,
              };
            }
            return null;
          })
          .filter(
            (item: CategoryOption | null): item is CategoryOption =>
              Boolean(item?.name)
          );
        setCategoryList(normalized);
        console.log("Categories API normalized:", normalized);
      } catch (err) {
        console.error("Failed to load categories", err);
        setCategoryList([]);
      }
    };

    fetchCategories();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        categoryDropdownRef.current &&
        !categoryDropdownRef.current.contains(target) &&
        categoryInputRef.current &&
        !categoryInputRef.current.contains(target)
      ) {
        setIsCategoryFocused(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!otpSent) return;
    if (otpTimer === 0) {
      setCanResend(true);
      return;
    }
    const interval = setInterval(() => {
      setOtpTimer((t) => t - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [otpSent, otpTimer]);

  const canSubmit = useMemo(
    () => category.trim() !== "" && time.trim() !== "" && area.trim() !== "",
    [category, time, area]
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

  const activeCategories = useMemo(() => {
    return categoryList
      .filter((item) => {
        if (item.active === undefined) return true;
        if (typeof item.active === "boolean") return item.active;
        const normalizedActive = item.active.toLowerCase();
        return (
          normalizedActive === "yes" ||
          normalizedActive === "true" ||
          normalizedActive === "active"
        );
      })
      .map((item) => ({
        originalName: item.name,
        normName: normalizeCategory(item.name),
      }));
  }, [categoryList]);

  const categoryResolution = useMemo(
    () => resolveCategory(category, activeCategories),
    [category, activeCategories]
  );

  const filteredCategories = useMemo(() => {
    const query = category.trim().toLowerCase();
    if (!query) return [];
    const candidates = categoryList.filter((item) => {
      if (item.active === undefined) return true;
      if (typeof item.active === "boolean") return item.active;
      const normalizedActive = item.active.toLowerCase();
      return (
        normalizedActive === "yes" ||
        normalizedActive === "true" ||
        normalizedActive === "active"
      );
    });

    const results = candidates
      .map((item) => {
        const name = item.name;
        const lower = name.toLowerCase();
        const startsWith = lower.startsWith(query);
        const includes = lower.includes(query);
        if (!includes) return null;
        return {
          name,
          startsWith,
          lower,
        };
      })
      .filter(
        (item): item is { name: string; startsWith: boolean; lower: string } =>
          Boolean(item)
      )
      .sort((a, b) => {
        if (a.startsWith !== b.startsWith) {
          return a.startsWith ? -1 : 1;
        }
        return a.lower.localeCompare(b.lower);
      })
      .slice(0, 8);

    return results;
  }, [category, categoryList]);

  const showSuggestions =
    isCategoryFocused &&
    category.trim().length > 0 &&
    filteredCategories.length > 0;

  const selectCategory = (name: string) => {
    setCategory(name);
    setSelectedCategory(name.trim());
    setIsCategoryFocused(false);
    setHighlightIndex(-1);
    console.debug("[home] category selected:", name.trim());
  };

  useEffect(() => {
    const nextCategory = category.trim();
    if (!nextCategory) {
      setSelectedCategory("");
      return;
    }
    if (nextCategory !== selectedCategory) {
      setSelectedCategory(nextCategory);
    }
  }, [category, selectedCategory]);

  const handleCategoryKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (!showSuggestions) {
      if (event.key === "Escape") {
        setIsCategoryFocused(false);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((prev) =>
        prev < filteredCategories.length - 1 ? prev + 1 : 0
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((prev) =>
        prev > 0 ? prev - 1 : filteredCategories.length - 1
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const selected =
        highlightIndex === -1
          ? filteredCategories[0]
          : filteredCategories[highlightIndex];
      if (selected) {
        selectCategory(selected.name);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setIsCategoryFocused(false);
    }
  };

  const renderHighlightedMatch = (label: string, query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return label;
    const lowerLabel = label.toLowerCase();
    const lowerQuery = trimmed.toLowerCase();
    const matchIndex = lowerLabel.indexOf(lowerQuery);
    if (matchIndex === -1) return label;
    const before = label.slice(0, matchIndex);
    const match = label.slice(matchIndex, matchIndex + trimmed.length);
    const after = label.slice(matchIndex + trimmed.length);
    return (
      <>
        {before}
        <mark className="rounded bg-amber-100 px-0.5 text-slate-900">
          {match}
        </mark>
        {after}
      </>
    );
  };

const handleSubmit = async () => {
  setError("");
  setDebug("");
  setAreaError("");
  setIsRedirecting(false);

  if (!area.trim()) {
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
    console.log("[home] rejected past service date", {
      rawDate: serviceDate,
      normalizedDate: normalizedServiceDate,
      todayDate,
      reason: serviceDateError,
    });
    setError(serviceDateError);
    return;
  }

  const session = getAuthSession();
  if (session?.phone) {
    await submitResolvedRequest(categoryResolution);
    return;
  }

  const modalSession = getAuthSession();
  if (modalSession?.phone) {
    setShowOtpModal(false);
    return;
  }
  saveTaskDraftToSessionStorage({
    category,
    area,
    urgency: time,
    time,
    serviceDate,
    timeSlot,
    details,
  });
  const nextPath =
    typeof window !== "undefined"
      ? `${window.location.pathname}${window.location.search}${window.location.hash}`
      : "/";
  router.push(`/login?next=${encodeURIComponent(nextPath)}`);
};

const submitResolvedRequest = async (resolution: CategoryResolution) => {
  setLoading(true);
  setError("");
  setDebug("");
  const cleanDetails = (details ?? "").trim();
  const normalizedArea = normalizeAreaValue(area);
  if (!normalizedArea) {
    setLoading(false);
    setAreaError("Please select or type your area.");
    return;
  }
  const session = getAuthSession();
  if (!session?.phone) {
    setLoading(false);
    setError("Please verify your phone number before submitting.");
    return;
  }
  if (!resolution.isConfident) {
    try {
      const res = await fetch("/api/submit-approval-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawCategoryInput: category,
          bestMatch: resolution.bestMatch || "",
          confidence: resolution.confidence,
          area: normalizedArea,
          serviceDate: normalizedServiceDate,
          timeSlot,
          details: cleanDetails,
          createdAt: new Date().toISOString(),
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to submit approval request");
      }

      const refId = `REQ-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      const params = new URLSearchParams();
      params.set("status", "under_review");
      params.set("ref", refId);
      if (category.trim()) params.set("service", category.trim());
      if (normalizedArea) params.set("area", normalizedArea);

      setShowDirectContactOption(false);
      setDetails("");
      if (typeof window !== "undefined") {
        window.localStorage.setItem("kk_last_area", normalizedArea);
      }
      clearTaskDraftFromSessionStorage();
      setIsRedirecting(true);
      router.replace(`/success?${params.toString()}`);
      return;
    } catch (err: any) {
      setError(err?.message || "Something went wrong.");
      setIsRedirecting(false);
    } finally {
      setLoading(false);
    }
    return;
  }

  const resolvedCategory = resolution.resolvedName || category;
  try {
    const submitStartMs = Date.now();
    const payload = {
        category: resolvedCategory,
        area: normalizedArea,
        time,
        serviceDate: normalizedServiceDate,
        timeSlot,
        details: cleanDetails,
        createdAt: new Date().toISOString(),
    };
      console.log("submit payload", {
        category: payload.category,
        area: payload.area,
        time: payload.time,
        serviceDate: payload.serviceDate,
        timeSlot: payload.timeSlot,
        detailsLength: payload.details.length,
      });
    const res = await fetch("/api/submit-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const fetchCompletedMs = Date.now();

    const raw = await res.text();
    const responseParsedMs = Date.now();
    console.log("api raw", raw);
    setDebug(`API ${res.status}\n${raw}`);

    let json: any = null;
    try {
      json = JSON.parse(raw);
    } catch {}

    if (!res.ok) {
      setError(json?.message || json?.error || "Non-200 response");
      return;
    }

    if (!json?.ok) {
      setError(json?.message || json?.error || "ok=false");
      return;
    }

    console.log("submitResolvedRequest timing", {
      category: resolvedCategory,
      area: normalizedArea,
      time: payload.time,
      httpStatus: res.status,
      fetchElapsedMs: fetchCompletedMs - submitStartMs,
      responseReadElapsedMs: responseParsedMs - fetchCompletedMs,
      totalElapsedMs: responseParsedMs - submitStartMs,
      taskId: json?.taskId || "",
      displayId: json?.displayId || "",
    });

    setShowDirectContactOption(true);
    setDetails("");
    if (typeof window !== "undefined") {
      window.localStorage.setItem("kk_last_area", normalizedArea);
    }
    clearTaskDraftFromSessionStorage();
    setIsRedirecting(true);
    router.replace(
      buildSuccessRedirect(
        resolvedCategory,
        normalizedArea,
        json?.taskId || "",
        json?.displayId || ""
      )
    );
    return;
  } catch (err: any) {
    setError(err?.message || "Something went wrong.");
    setIsRedirecting(false);
  } finally {
    setLoading(false);
  }
};

  const sendOtp = async () => {
    if (isSending) return;
    const now = Date.now();
    if (now - lastOtpSentAtRef.current < 2000) {
      return;
    }
    lastOtpSentAtRef.current = now;

    setOtpError("");
    setOtpLoading(true);
    setIsLoading(true);
    setIsSending(true);
    const trimmedPhone = phone.trim();
    if (!trimmedPhone || trimmedPhone.length !== 10) {
      setOtpError("Enter a valid 10-digit phone number.");
      setOtpLoading(false);
      setIsLoading(false);
      setIsSending(false);
      return;
    }
  const nextRequestId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  setRequestId(nextRequestId);
    try {
      const res = await fetch("/api/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // --- FIX IS HERE: Sending correct keys for API route ---
        body: JSON.stringify({
          toPhoneNumber: "91" + trimmedPhone,
        requestId: nextRequestId,
          otpCode: "789012",
          buttonUrl: `${process.env.NEXT_PUBLIC_SITE_URL || ""}/login`,
        }),
        // ----------------------------------------------------
      });

      const rawText = await res.text();

      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        console.error("Server returned non-JSON:", rawText);
        throw new Error("Server error. Check backend.");
      }

      if (!res.ok) {
        throw new Error(data?.error || "Failed to send OTP");
      }

      if (data?.success) {
        setOtpSent(true);
      } else {
        throw new Error(data?.error || "Failed to send OTP");
      }
    } catch (err: any) {
      setOtpError(err?.message || "Failed to send OTP. Try again.");
    } finally {
      setOtpLoading(false);
      setIsLoading(false);
      setIsSending(false);
    }
  };

  const verifyOtp = async () => {
  setOtpError("");
  setOtpLoading(true);
  if (!requestId) {
    setOtpError("OTP request expired. Please request a new OTP.");
    setOtpLoading(false);
    return;
  }
  try {
    const res = await fetch("/api/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phone.trim(), otp: otp.trim(), requestId }),
    });
    const data = await res.json();
      const alreadyVerified =
        typeof data?.error === "string" &&
        data.error.toLowerCase().includes("already verified");
     if ((!res.ok || !data?.ok) && !alreadyVerified) {
       setShakeOtp(true);
       setOtpError("Incorrect OTP. Please try again.");
       setTimeout(() => setShakeOtp(false), 600);
       throw new Error(data?.error || "Invalid OTP");
     }
     setShowOtpModal(false);
     if (data?.phone && data?.token) {
       setAuthSession(data.phone, data.token);
       setPhone(data.phone);
     }
     // Mirror admin status from server response — sidebar reads this
     if (data?.isAdmin === true) {
       window.localStorage.setItem(
         "kk_admin_session",
         JSON.stringify({
           isAdmin: true,
           name: data.adminName ?? null,
           role: data.adminRole ?? null,
           permissions: data.permissions ?? [],
         })
       );
     } else {
       window.localStorage.removeItem("kk_admin_session");
     }
    await submitResolvedRequest(categoryResolution);
   } catch (err: any) {
     setOtpError(err?.message || "Invalid OTP. Please try again.");
  } finally {
      setOtpLoading(false);
    }
  };

  const handleShowProviders = async () => {
    try {
      const res = await fetch(
        `/api/find-provider?category=${encodeURIComponent(
          category
        )}&area=${encodeURIComponent(area)}`
      );
      const data = await res.json();
      setProvidersList(Array.isArray(data?.providers) ? data.providers : []);
      setShowProvidersList(true);
    } catch (err) {
      setProvidersList([]);
      setShowProvidersList(false);
    }
  };

  const handleResendOtp = async () => {
    setOtp("");
    setOtpTimer(120);
    setCanResend(false);
    await sendOtp();
  };

  const hasCategory = category.trim() !== "";
  const hasTime = time.trim() !== "";
const hasArea = area.trim() !== "";
  const session = isHydrated ? getAuthSession() : null;
  const isLoggedIn = !!session?.phone;

  if (isRedirecting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
        <p className="text-sm font-medium text-slate-700">Redirecting...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-slate-50 px-4 py-4 leading-relaxed">
      <div className="w-full max-w-5xl rounded-3xl border border-slate-200 bg-white p-5 shadow-md md:p-7">
        {/* Hero: Logo + Title + Tagline */}
        <div className="mb-4 flex flex-col items-center text-center">
          <div className="mb-3 flex items-center justify-center">
            <Image
              src={logo}
              alt="Kaun Karega logo"
              priority
              className="mx-auto w-full max-w-[300px] md:max-w-[420px]"
            />
          </div>
        </div>

        {/* Two-column layout: main form + I NEED sidebar */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">

          {/* Main column: search + steps */}
          <div className="flex-1 min-w-0">

        {/* Step 1: Category search bar */}
        <div className="relative mx-auto mb-6 mt-2 w-full max-w-3xl">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">
            What help do you need?
          </label>
          <div
            className="relative flex items-center rounded-full border border-slate-300 bg-white px-5 py-5 shadow-[0_8px_24px_rgba(0,0,0,0.08)] transition-all duration-200 focus-within:border-orange-400 focus-within:shadow-[0_8px_32px_rgba(249,115,22,0.15)] focus-within:ring-2 focus-within:ring-orange-400/20"
          >
            <span className="mr-3 text-xl text-orange-400">🔍</span>
            <input
              ref={categoryInputRef}
              type="text"
              value={category}
              onChange={(e) => {
                const value = e.target.value;
                setCategory(value);
                setSelectedCategory(value.trim());
                setHighlightIndex(-1);
              }}
              onFocus={() => setIsCategoryFocused(true)}
              onBlur={() => { if (!category) setIsCategoryFocused(false); }}
              onKeyDown={handleCategoryKeyDown}
              placeholder={isHydrated && !isCategoryFocused && twText ? "" : "What service do you need? (e.g. Electrician, Plumber)"}
              className="w-full bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-500 md:text-lg"
            />
            {/* Typewriter overlay — visible only when input is empty and not focused */}
            {isHydrated && !isCategoryFocused && category === "" && twText !== "" && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 flex items-center rounded-full bg-white pl-[52px] pr-5"
                style={{ left: 0, right: 0 }}
              >
                <span className="text-base font-medium text-slate-600 md:text-lg">
                  {twText}
                  <span
                    className="ml-px"
                    style={{ opacity: twCaretOn ? 1 : 0, transition: "opacity 50ms" }}
                  >|</span>
                </span>
              </div>
            )}
          </div>
          {showSuggestions && (
            <div
              ref={categoryDropdownRef}
              className="absolute left-0 right-0 z-50 mt-2 rounded-xl border border-slate-200 bg-sky-50 shadow-lg"
            >
              {filteredCategories.map((item, index) => {
                const isHighlighted = index === highlightIndex;
                return (
                  <button
                    key={item.name}
                    type="button"
                    className={`w-full px-4 py-2 text-left text-sm text-slate-800 ${
                      isHighlighted ? "bg-sky-100" : "hover:bg-sky-100"
                    }`}
                    onMouseEnter={() => setHighlightIndex(index)}
                    onClick={() => selectCategory(item.name)}
                  >
                    {renderHighlightedMatch(item.name, category)}
                  </button>
                );
              })}
            </div>
          )}
          {categoryResolution.isConfident &&
            categoryResolution.reason !== "exact" && (
              <p className="mt-2 text-xs text-slate-500">
                Using category:
                <span className="font-semibold text-slate-700">
                  {categoryResolution.resolvedName}
                </span>
              </p>
            )}
        </div>

        {/* Step 2: When do you need it? */}
        {hasCategory && (
          <div className="mb-6">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Step 2 · When do you need it?
            </label>
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
            </div>
        )}

        {/* Step 3: Where do you need it? */}
        {hasCategory && hasTime && (
          <div className="mb-6">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Step 3 · Where do you need it?
            </label>
            <AreaSelection
              selectedArea={area}
              onSelect={(value) => {
                const normalizedArea = normalizeAreaValue(value);
                setArea(normalizedArea);
                setAreaError("");
                console.debug("[home] area selected:", normalizedArea);
              }}
              errorMessage={areaError}
            />
          </div>
        )}

        {/* Step 4: Task details + Submit */}
        {hasCategory && hasTime && hasArea && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Step 4 · Task details (optional)
              </label>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Describe your work in 1–2 sentences (e.g. &quot;Kitchen tap is leaking, need plumber today evening&quot;)..."
                rows={3}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/30"
              />
            </div>

            {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
            {debug && (
              <pre className="mt-2 text-xs whitespace-pre-wrap rounded border bg-gray-50 p-2">
                {debug}
              </pre>
            )}
            {showDirectContactOption && (
              <div className="mt-4 p-4 bg-slate-50 border rounded-xl">
                <p className="text-sm font-medium text-slate-700">
                  Do you want to contact providers yourself?
                </p>
                <div className="flex gap-3 mt-2">
                  <button
                    className="px-4 py-2 rounded-lg bg-green-600 text-white"
                    onClick={handleShowProviders}
                  >
                    Yes, show numbers
                  </button>
                  <button
                    className="px-4 py-2 rounded-lg bg-slate-200 text-slate-700"
                    onClick={() => setShowProvidersList(false)}
                  >
                    No
                  </button>
                </div>
              </div>
            )}
            {showProvidersList && (
              <div className="mt-4 space-y-3">
                {providersList.map((p) => (
                  <div key={p.phone} className="border rounded-lg p-3">
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-sm text-slate-600">📍 {p.area}</p>
                    <p className="text-sm text-slate-600">📞 {p.phone}</p>
                    <a
                      href={`tel:${p.phone}`}
                      className="mt-2 inline-block px-3 py-1 bg-blue-500 text-white rounded-lg"
                    >
                      Call
                    </a>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || isRedirecting || !canSubmit || Boolean(serviceDateError)}
              className="w-full rounded-full bg-sky-500 px-4 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-sky-600 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60 md:text-base"
            >
              {loading || isRedirecting
                ? "Submitting your request..."
                : "Submit Request"}
            </button>
            {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
            {debug && (
              <pre className="mt-2 text-xs whitespace-pre-wrap rounded border bg-gray-50 p-2">
                {debug}
              </pre>
            )}
          </div>
        )}

    {/* Small hint at the bottom */}
    {!isLoggedIn && (
      <p className="mt-6 text-center text-xs text-gray-600 font-medium">
        Your phone number will be collected later in a quick step to send you updates on WhatsApp.
      </p>
    )}
          </div>{/* end main column */}

        </div>{/* end two-column layout */}
      </div>{/* end white card */}

      {showOtpModal && !isLoggedIn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="space-y-2 text-center">
              <h3 className="text-xl font-semibold text-slate-900">
                Verify your phone number
              </h3>
              <p className="text-sm text-slate-600 mt-2">
                To serve you better, please verify your number.
                <br />
                This helps us connect your request to the right nearby providers.
                <br />
                <br />
                Be assured — your phone number will NOT be shared with any provider.
                <br />
                You will receive a WhatsApp notification where a secure chat box
                <br />
                will appear for your negotiation.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">
                Phone Number
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/30"
                placeholder="10-digit mobile number"
                inputMode="numeric"
              />
                  <button
                    type="button"
                    onClick={sendOtp}
                    disabled={isSending || isLoading || otpLoading || phone.trim().length !== 10}
                    className="w-full rounded-full bg-sky-500 px-4 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-sky-600 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSending ? "Sending..." : "Send OTP"}
                  </button>
            </div>

            {otpSent && (
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">
                  Enter OTP
                </label>
                <input
                  type="tel"
                  value={otp}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, ""); // allow only digits
                    if (value.length <= 4) setOtp(value);
                    if (value.length === 4) {
                      setTimeout(() => {
                        document.getElementById("verifyOtpBtn")?.focus();
                      }, 50);
                    }
                  }}
                  maxLength={4}
                  inputMode="numeric"
                  pattern="\\d{4}"
                  className={`w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-center text-lg tracking-[0.25em] shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/30 ${
                    shakeOtp ? "shake" : ""
                  }`}
                  placeholder="____"
                />
                <button
                  type="button"
                  id="verifyOtpBtn"
                  onClick={verifyOtp}
                  disabled={otpLoading || otp.trim().length !== 4}
                  className="w-full rounded-full bg-emerald-500 px-4 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-emerald-600 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {otpLoading ? "Verifying..." : "Verify OTP"}
                </button>
              </div>
            )}

            {otpSent && (
              <div className="text-center mt-2 text-sm text-slate-600">
                {!canResend ? (
                  <span>
                    Resend OTP in {String(Math.floor(otpTimer / 60)).padStart(2, "0")}:
                    {String(otpTimer % 60).padStart(2, "0")}
                  </span>
                ) : (
                  <button onClick={handleResendOtp} className="text-blue-600 font-medium">
                    Resend OTP
                  </button>
                )}
              </div>
            )}

            {otpError && (
              <p className="text-sm text-red-600 text-center">{otpError}</p>
            )}
            <style jsx>{`
              .shake {
                animation: shake 0.3s linear;
              }
              @keyframes shake {
                0% {
                  transform: translateX(0);
                }
                20% {
                  transform: translateX(-4px);
                }
                40% {
                  transform: translateX(4px);
                }
                60% {
                  transform: translateX(-4px);
                }
                80% {
                  transform: translateX(4px);
                }
                100% {
                  transform: translateX(0);
                }
              }
            `}</style>
        </div>
      </div>
    )}

      {/* Service Provider onboarding section */}
      <section className="mt-10 rounded-2xl bg-orange-50 border border-orange-200 px-6 py-12 text-center">
        <h2 className="text-2xl font-bold text-slate-900">
          Are you a service provider?
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600 max-w-md mx-auto">
          Join Kaun Karega to get real customer leads in your area. Grow your business with zero upfront cost.
        </p>
        <button
          type="button"
          onClick={() => router.push("/provider/register")}
          className="mt-6 inline-flex rounded-full bg-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-orange-600 hover:shadow-lg"
        >
          Register as Service Provider
        </button>
      </section>
  </div>
);
}




