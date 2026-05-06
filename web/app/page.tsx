"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import AreaSelection, {
  normalizeAreaValue,
} from "@/app/(public)/components/AreaSelection";
import WhenNeedIt from "@/app/(public)/components/WhenNeedIt";
import { getAuthSession, setAuthSession } from "@/lib/auth";

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
  // Additive, optional: only populated when /api/categories?include=aliases
  // returned a `suggestions[]` row. Existing consumers that read only
  // `name`/`active` are unaffected.
  canonical?: string;
  type?: "canonical" | "alias";
  matchPriority?: 1 | 2;
};

type ActiveCategory = {
  originalName: string;
  normName: string;
  // Present only for alias rows. Undefined for canonical rows so resolver
  // falls back to today's behavior.
  canonical?: string;
};

type CategoryResolution = {
  resolvedName: string;
  confidence: number;
  // "alias" added so the existing "Using category: …" hint (which fires for
  // any reason !== "exact") covers alias matches automatically.
  reason: "exact" | "fuzzy" | "alias" | "none";
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
    // Use canonical ONLY if present (alias rows). Otherwise fall back to
    // originalName — preserves today's behavior for canonical rows.
    const resolvedName = exactMatch.canonical || exactMatch.originalName;
    return {
      resolvedName,
      confidence: 1,
      reason: exactMatch.canonical ? "alias" : "exact",
      isConfident: true,
      bestMatch: resolvedName,
    };
  }

  const best = activeCategories.reduce<{
    name: string;
    normName: string;
    similarity: number;
    distance: number;
    canonical?: string;
  } | null>((currentBest, item) => {
    const distance = levenshteinDistance(normalizedInput, item.normName);
    const similarity = similarityScore(normalizedInput, item.normName);
    if (!currentBest || similarity > currentBest.similarity) {
      return {
        name: item.originalName,
        normName: item.normName,
        similarity,
        distance,
        canonical: item.canonical,
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

  // Same canonical-only-if-present rule on the fuzzy branch.
  const resolvedName = best.canonical || best.name;
  return {
    resolvedName,
    confidence: best.similarity,
    reason: confident ? (best.canonical ? "alias" : "fuzzy") : "none",
    isConfident: confident,
    bestMatch: resolvedName,
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
  // Flips to true the moment the user actively claims ownership of the
  // category field (selection or typing). Mount-time bootstrap effects
  // (URL ?category=, session draft) bail out once this is set, so a stale
  // URL value can't snap back over a user-picked canonical.
  const userPickedCategoryRef = useRef(false);

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
    if (userPickedCategoryRef.current) return;
    const fromParams = params.get("category") || "";
    if (fromParams && fromParams !== category) {
      setCategory(fromParams);
      setSelectedCategory(fromParams.trim());
      console.debug("[home] category selected from query:", fromParams.trim());
    }
  }, [params]);

  useEffect(() => {
    if (userPickedCategoryRef.current) return;
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
        // Opt-in to alias suggestions. Server returns the original `data`
        // shape PLUS a `suggestions[]` array with canonical/alias rows.
        // E2E mocks (URL glob `**/api/categories**`) still match this URL and
        // return their legacy shape — the parser below falls through to the
        // legacy branch when `suggestions` is absent.
        const res = await fetch("/api/categories?include=aliases");
        console.log("CATEGORIES RAW RESPONSE:", res);
        if (!res.ok) {
          throw new Error("Failed to fetch categories");
        }
        const data = await res.json();
        console.log("CATEGORIES API RESPONSE:", data);
        // Prefer `suggestions[]` when present — carries label, canonical,
        // type, matchPriority. Otherwise fall back to the legacy parser.
        const suggestionsRaw = Array.isArray(data?.suggestions)
          ? data.suggestions
          : null;
        const categoriesRaw = suggestionsRaw
          ? suggestionsRaw
          : Array.isArray(data)
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
                (typeof record.title === "string" && record.title) ||
                (typeof record.category === "string" && record.category) ||
                (typeof record.category_name === "string" &&
                  record.category_name) ||
                "";
              if (!name) return null;
              const canonicalRaw =
                typeof record.canonical === "string" ? record.canonical.trim() : "";
              const typeRaw =
                record.type === "alias" || record.type === "canonical"
                  ? record.type
                  : undefined;
              const matchPriorityRaw =
                record.matchPriority === 1 || record.matchPriority === 2
                  ? record.matchPriority
                  : undefined;
              return {
                name,
                // Server already filters `active=true` on the suggestions
                // path, so default to true there. Legacy path keeps the
                // original record.active value.
                active:
                  suggestionsRaw !== null
                    ? true
                    : (record.active as string | boolean | undefined),
                // Only set canonical for alias rows whose canonical key
                // actually differs from the displayed label. Canonical rows
                // leave it undefined so resolveCategory falls back to its
                // original behavior.
                canonical:
                  typeRaw === "alias" && canonicalRaw && canonicalRaw !== name
                    ? canonicalRaw
                    : undefined,
                type: typeRaw,
                matchPriority: matchPriorityRaw,
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

  const isActiveCategory = (active: unknown): boolean => {
    if (active === undefined || active === null) return true;
    if (typeof active === "boolean") return active;
    const normalized = String(active).toLowerCase().trim();
    return (
      normalized === "yes" ||
      normalized === "true" ||
      normalized === "active" ||
      normalized === "1"
    );
  };

  const activeCategories = useMemo(() => {
    return categoryList
      .filter((item) => isActiveCategory(item.active))
      .map((item) => ({
        originalName: item.name,
        normName: normalizeCategory(item.name),
        // Pass-through. Undefined for canonical rows — resolveCategory
        // treats absence as "use originalName" (today's behavior).
        canonical: item.canonical,
      }));
  }, [categoryList]);

  const categoryResolution = useMemo(
    () => resolveCategory(category, activeCategories),
    [category, activeCategories]
  );

  // Single source of truth for what to *display* and *submit* as the category.
  // If the input fuzzy-resolves to a known active category, prefer the resolved
  // name; otherwise fall back to the raw user input. The chip and the submit
  // payload both read from this — no UI / backend mismatch.
  const displayCategory = useMemo(() => {
    if (categoryResolution.isConfident && categoryResolution.resolvedName) {
      return categoryResolution.resolvedName;
    }
    return category;
  }, [categoryResolution, category]);

  const filteredCategories = useMemo(() => {
    const query = category.trim().toLowerCase();
    if (!query) return [];
    const candidates = categoryList.filter((item) => isActiveCategory(item.active));

    const matched = candidates
      .map((item) => {
        const name = item.name;
        if (typeof name !== "string" || !name) return null;
        const lower = name.toLowerCase();
        const startsWith = lower.startsWith(query);
        const includes = lower.includes(query);
        if (!includes) return null;
        return {
          name,
          startsWith,
          lower,
          // Carry through so the dropdown can render the muted "(Welder)"
          // hint on alias rows. Undefined on canonical rows / legacy shape.
          canonical: item.canonical,
          type: item.type,
          matchPriority: item.matchPriority,
        };
      })
      .filter(
        (
          item
        ): item is {
          name: string;
          startsWith: boolean;
          lower: string;
          canonical: string | undefined;
          type: "canonical" | "alias" | undefined;
          matchPriority: 1 | 2 | undefined;
        } => Boolean(item)
      );

    // Final dedup gate: keep one entry per lowercased label. On collision the
    // lower matchPriority wins (canonical 1 beats alias 2); equal priority
    // keeps the first occurrence so the server's canonical-before-alias
    // ordering is preserved.
    const dedupedByLabel = new Map<string, (typeof matched)[number]>();
    for (const item of matched) {
      const existing = dedupedByLabel.get(item.lower);
      if (!existing) {
        dedupedByLabel.set(item.lower, item);
        continue;
      }
      const existingPriority = existing.matchPriority ?? 1;
      const itemPriority = item.matchPriority ?? 1;
      if (itemPriority < existingPriority) {
        dedupedByLabel.set(item.lower, item);
      }
    }

    const results = Array.from(dedupedByLabel.values())
      .sort((a, b) => {
        // Primary: matchPriority (canonical 1 before alias 2). Falls through
        // to today's tie-breakers when priority is equal or absent.
        const pa = a.matchPriority ?? 1;
        const pb = b.matchPriority ?? 1;
        if (pa !== pb) return pa - pb;
        if (a.startsWith !== b.startsWith) {
          return a.startsWith ? -1 : 1;
        }
        return a.lower.localeCompare(b.lower);
      })
      .slice(0, 8);

    return results;
  }, [category, categoryList]);

  // TEMP debug: surface what the dropdown will render. Remove once verified.
  useEffect(() => {
    console.log("FILTERED RESULTS:", filteredCategories);
  }, [filteredCategories]);

  const showSuggestions =
    isCategoryFocused &&
    category.trim().length > 0 &&
    filteredCategories.length > 0;

  useEffect(() => {
    if (!showSuggestions) return;
    const id = requestAnimationFrame(() => {
      categoryDropdownRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(id);
  }, [showSuggestions]);

  const selectCategory = (label: string, canonical?: string) => {
    // Claim ownership of the category field before any state update so the
    // URL/draft bootstrap effects can't re-fire and snap the value back.
    userPickedCategoryRef.current = true;
    // When the picked suggestion carries a canonical key (alias rows), commit
    // the canonical so downstream submission uses it directly without relying
    // on resolveCategory to re-derive it. Falls back to the label for typed
    // input or canonical rows where canonical is absent.
    const canonicalTrimmed = canonical?.trim() ?? "";
    const finalValue = canonicalTrimmed || label;
    setCategory(finalValue);
    setSelectedCategory(finalValue.trim());
    setIsCategoryFocused(false);
    setHighlightIndex(-1);
    console.debug("[home] category selected:", finalValue.trim());
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
      // No dropdown match → don't trap the user. Pressing Enter commits the
      // raw input as the chosen category; downstream resolution will route it
      // to the admin-review path automatically.
      if (event.key === "Enter") {
        event.preventDefault();
        const trimmed = category.trim();
        if (trimmed) {
          selectCategory(trimmed);
        }
        return;
      }
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
        selectCategory(selected.name, selected.canonical);
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
        <span className="font-bold text-orange-600 tracking-wide">
          {match}
        </span>
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
      // TEMP debug: confirm the raw input is what gets queued for admin review.
      console.log("FINAL CATEGORY SENT:", category, "(approval path — rawCategoryInput)");
      const res = await fetch("/api/submit-approval-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawCategoryInput: category,
          bestMatch: resolution.bestMatch || "",
          confidence: resolution.confidence,
          area: normalizedArea,
          time,
          serviceDate: normalizedServiceDate,
          timeSlot,
          details: cleanDetails,
          createdAt: new Date().toISOString(),
        }),
      });

      const rawApproval = await res.text();
      let approvalJson: any = null;
      try {
        approvalJson = JSON.parse(rawApproval);
      } catch {}

      if (!res.ok || !approvalJson?.ok) {
        throw new Error(
          approvalJson?.message ||
            approvalJson?.error ||
            "Failed to submit approval request"
        );
      }

      const refId =
        (typeof approvalJson?.displayId === "string" && approvalJson.displayId.trim()) ||
        (typeof approvalJson?.taskId === "string" && approvalJson.taskId.trim()) ||
        `REQ-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
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
      // TEMP debug: prove the resolved category (not the raw input) is on the wire.
      console.log("FINAL CATEGORY SENT:", payload.category);
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
    <div className="min-h-screen bg-slate-50">

      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-white px-4 pb-10 pt-5 text-center">
        {/* Very subtle dot-grid texture */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage: "radial-gradient(circle, #334155 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />

        <div className="relative mx-auto max-w-2xl">

          {/* Text wordmark */}
          <div className="mb-3 flex justify-center select-none">
            <div className="inline-flex items-start justify-center gap-2 leading-none sm:gap-3">
              <span className="relative inline-block translate-y-[18px] text-[2.75rem] font-extrabold tracking-tight text-orange-500 sm:translate-y-[22px] sm:text-6xl md:translate-y-[28px] md:text-[4.8rem]">
                कौन
              </span>
              <div className="flex flex-col items-start">
                <span className="relative inline-block text-[2.4rem] font-extrabold tracking-[0.06em] text-[#003d20] sm:text-5xl md:text-[4.35rem]">
                  <span className="relative inline-block pb-1 after:absolute after:bottom-[-10px] after:left-0 after:h-[5px] after:w-full after:bg-orange-500 after:content-['']">KAREGA</span><span>?</span>
                </span>
                <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-gray-600 sm:text-xs">
                  Jodhpur Local Services
                </p>
              </div>
            </div>
          </div>

          {/* Search bar */}
          <div className="mx-auto mt-3 max-w-xl">

            <div className="relative">
              <div className="relative flex items-center rounded-2xl border border-slate-300 bg-white px-4 py-3 shadow-lg transition-all duration-200 focus-within:ring-2 focus-within:ring-[#003d20]/40">
                <span className="mr-3 shrink-0 text-xl text-[#003d20]">&#128269;</span>
                <div className="relative flex-1 min-w-0">
                  <input
                    ref={categoryInputRef}
                    type="text"
                    value={category}
                    onChange={(e) => {
                      const value = e.target.value;
                      userPickedCategoryRef.current = true;
                      setCategory(value);
                      setSelectedCategory(value.trim());
                      setHighlightIndex(-1);
                    }}
                    onFocus={() => setIsCategoryFocused(true)}
                    onBlur={() => { if (!category) setIsCategoryFocused(false); }}
                    onKeyDown={handleCategoryKeyDown}
                    onDrop={(e) => e.preventDefault()}
                    onDragOver={(e) => e.preventDefault()}
                    placeholder={isHydrated && !isCategoryFocused && twText ? "" : "What service do you need? (e.g. Electrician)"}
                    className="w-full bg-transparent pr-3 text-base text-slate-900 outline-none placeholder:text-slate-400 md:text-lg"
                  />
                  {/* Typewriter overlay — anchored to input wrapper */}
                  {isHydrated && !isCategoryFocused && category === "" && twText !== "" && (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none select-none absolute inset-0 flex items-center bg-white"
                      onDragStart={(e) => e.preventDefault()}
                    >
                      <span className="text-base font-medium text-slate-500 md:text-lg">
                        {twText}
                        <span
                          className="ml-px"
                          style={{ opacity: twCaretOn ? 1 : 0, transition: "opacity 50ms" }}
                        >|</span>
                      </span>
                    </div>
                  )}
                </div>
                {/* Search button */}
                <button
                  type="button"
                  onClick={() => {
                    if (filteredCategories.length > 0) {
                      const first = filteredCategories[0];
                      selectCategory(first.name, first.canonical);
                    } else if (category.trim()) {
                      selectCategory(category.trim());
                    } else {
                      categoryInputRef.current?.focus();
                    }
                  }}
                  className="ml-2 shrink-0 rounded-xl bg-[#003d20] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#002a15] active:scale-[0.97] md:text-base"
                >
                  Search
                </button>
              </div>

              {/* Suggestions dropdown */}
              {showSuggestions && (
                <div
                  ref={categoryDropdownRef}
                  className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-xl border border-slate-100 bg-white shadow-2xl"
                >
                  {filteredCategories.map((item, index) => {
                    const isHighlighted = index === highlightIndex;
                    // Alias-row hint: e.g. label "lohar" → muted "(Welder)".
                    // Only render when canonical is present AND differs from
                    // the displayed label (parser already enforces both, but
                    // double-check defensively).
                    const showAliasHint =
                      item.type === "alias" &&
                      typeof item.canonical === "string" &&
                      item.canonical.length > 0 &&
                      item.canonical.toLowerCase() !== item.name.toLowerCase();
                    const aliasHintText = showAliasHint && item.canonical
                      ? `(${item.canonical.charAt(0).toUpperCase()}${item.canonical.slice(1)})`
                      : "";
                    return (
                      <button
                        key={item.name}
                        type="button"
                        className={`w-full px-4 py-2.5 text-left text-sm text-slate-800 transition-colors ${
                          isHighlighted
                            ? "bg-[#003d20]/10 text-[#003d20]"
                            : "hover:bg-[#003d20]/10 hover:text-[#003d20]"
                        }`}
                        onMouseEnter={() => setHighlightIndex(index)}
                        onClick={() => selectCategory(item.name, item.canonical)}
                      >
                        {renderHighlightedMatch(item.name, category)}
                        {showAliasHint && (
                          <span className="ml-2 text-xs text-slate-400">
                            {aliasHintText}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Fuzzy match hint */}
              {categoryResolution.isConfident && categoryResolution.reason !== "exact" && (
                <p className="mt-2 text-left text-xs text-slate-500">
                  Using category:{" "}
                  <span className="font-semibold text-[#003d20]">
                    {categoryResolution.resolvedName}
                  </span>
                </p>
              )}

              {/* Unknown-service hint: only when input has no fuzzy match AND
                  no dropdown matches either. Keeps the user unblocked and
                  sets expectations about the admin-review path. */}
              {category.trim().length > 0 &&
                !categoryResolution.isConfident &&
                filteredCategories.length === 0 && (
                  <p className="mt-2 text-left text-xs text-amber-700">
                    New service — will be reviewed by admin
                  </p>
                )}
            </div>

            {/* Trust strip */}
            <div
              className={`mt-5 grid grid-cols-3 gap-2 select-none sm:gap-3 ${
                isCategoryFocused || hasCategory ? "hidden md:grid" : ""
              }`}
            >
              {[
                { icon: "✓", label: "Trusted", desc: "Verified providers" },
                { icon: "⚡", label: "Quick", desc: "Matched in minutes" },
                { icon: "★", label: "Reliable", desc: "Real reviews" },
              ].map(({ icon, label, desc }) => (
                <div
                  key={label}
                  className="flex flex-col items-center rounded-xl border border-slate-100 bg-slate-50 px-2 py-3 text-center sm:px-3"
                >
                  <span className="text-base text-[#003d20]/60">{icon}</span>
                  <p className="mt-1 text-sm font-medium text-slate-600">{label}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-400 sm:text-xs sm:leading-normal">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── STATS BAR ────────────────────────────────────────────────── */}
      {!hasCategory && (
        <div
          className={`border-b border-slate-100 bg-white select-none ${
            isCategoryFocused ? "hidden md:block" : ""
          }`}
          onDragStart={(e) => e.preventDefault()}
        >
          <div className="mx-auto grid max-w-2xl grid-cols-3 divide-x divide-slate-100">
            <div className="py-3 text-center">
              <p className="text-lg font-semibold text-[#003d20]/60">50+</p>
              <p className="mt-0.5 text-[11px] leading-snug text-slate-400 sm:text-xs sm:leading-normal">Service Types</p>
            </div>
            <div className="py-3 text-center">
              <p className="text-lg font-semibold text-[#003d20]/60">40+</p>
              <p className="mt-0.5 text-[11px] leading-snug text-slate-400 sm:text-xs sm:leading-normal">Areas in Jodhpur</p>
            </div>
            <div className="py-3 text-center">
              <p className="text-lg font-semibold text-[#003d20]/60">Free</p>
              <p className="mt-0.5 text-[11px] leading-snug text-slate-400 sm:text-xs sm:leading-normal">To Post a Request</p>
            </div>
          </div>
        </div>
      )}

      {/* ── PROGRESSIVE FORM STEPS ───────────────────────────────────── */}
      {hasCategory && (
        <div className="mx-auto max-w-xl space-y-4 px-4 py-8">

          {/* Selected service breadcrumb */}
          <div className="flex items-center gap-2 rounded-xl bg-[#003d20]/10 px-4 py-2.5">
            <span className="text-sm font-semibold text-[#003d20]">
              Service:
            </span>
            <span className="rounded-full bg-[#003d20] px-3 py-0.5 text-xs font-bold text-white">
              {displayCategory}
            </span>
            <button
              type="button"
              onClick={() => {
                setCategory("");
                setSelectedCategory("");
                setTime("");
                setArea("");
                setDetails("");
              }}
              className="ml-auto text-xs text-[#003d20]/50 hover:text-[#003d20]"
            >
              Change
            </button>
          </div>

          {/* Step 2: When */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#003d20] text-[10px] font-bold text-white">
                2
              </span>
              When do you need it?
            </p>
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

          {/* Step 3: Where */}
          {hasTime && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#003d20] text-[10px] font-bold text-white">
                  3
                </span>
                Where do you need it?
              </p>
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

          {/* Step 4: Details + Submit */}
          {hasTime && hasArea && (
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div>
                <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#003d20] text-[10px] font-bold text-white">
                    4
                  </span>
                  Task details (optional)
                </p>
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="Describe your work in 1&#8211;2 sentences (e.g. &quot;Kitchen tap is leaking, need plumber today evening&quot;)..."
                  rows={3}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 focus:border-[#003d20] focus:outline-none focus:ring-2 focus:ring-[#003d20]/20"
                  onDrop={(e) => e.preventDefault()}
                  onDragOver={(e) => e.preventDefault()}
                />
              </div>

              {error && <div className="text-sm text-red-600">{error}</div>}
              {debug && (
                <pre className="text-xs whitespace-pre-wrap rounded border bg-gray-50 p-2">
                  {debug}
                </pre>
              )}

              {showDirectContactOption && (
                <div className="rounded-xl border bg-slate-50 p-4">
                  <p className="text-sm font-medium text-slate-700">
                    Do you want to contact providers yourself?
                  </p>
                  <div className="mt-2 flex gap-3">
                    <button
                      className="rounded-lg bg-[#003d20] px-4 py-2 text-sm text-white"
                      onClick={handleShowProviders}
                    >
                      Yes, show numbers
                    </button>
                    <button
                      className="rounded-lg bg-slate-200 px-4 py-2 text-sm text-slate-700"
                      onClick={() => setShowProvidersList(false)}
                    >
                      No
                    </button>
                  </div>
                </div>
              )}

              {showProvidersList && (
                <div className="space-y-3">
                  {providersList.map((p) => (
                    <div key={p.phone} className="rounded-xl border border-slate-200 p-3">
                      <p className="font-semibold text-slate-800">{p.name}</p>
                      <p className="mt-0.5 text-sm text-slate-500">&#128205; {p.area}</p>
                      <p className="text-sm text-slate-500">&#128222; {p.phone}</p>
                      <a
                        href={`tel:${p.phone}`}
                        draggable={false}
                        className="mt-2 inline-block rounded-lg bg-blue-500 px-3 py-1 text-sm text-white"
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
                className="w-full rounded-xl bg-[#003d20] px-4 py-4 text-base font-bold text-white shadow-md transition hover:bg-[#002a15] hover:shadow-lg active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading || isRedirecting ? "Submitting..." : "Find Providers"}
              </button>

              {!isLoggedIn && (
                <p className="text-center text-xs text-slate-400">
                  Your number will be collected in the next step to send you updates on WhatsApp.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── HOW IT WORKS ─────────────────────────────────────────────── */}
      {!hasCategory && (
        <section
          className="bg-white px-4 py-14 select-none"
          onDragStart={(e) => e.preventDefault()}
        >
          <div className="mx-auto max-w-2xl">
            <h2 className="text-center text-2xl font-bold text-slate-900">How it works</h2>
            <p className="mt-1 text-center text-sm text-slate-500">Simple. Fast. Reliable.</p>

            <div className="relative mt-10">
              {/* Horizontal connector line — desktop only */}
              <div
                aria-hidden="true"
                className="absolute left-[16.7%] right-[16.7%] top-10 hidden h-0.5 bg-[#003d20]/20 sm:block"
              />

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
                {[
                  { step: "1", icon: "📋", title: "Post your task",    desc: "Tell us what you need and where. Takes under a minute." },
                  { step: "2", icon: "🔔", title: "Providers respond", desc: "Matched, verified providers in your area are notified instantly." },
                  { step: "3", icon: "✅", title: "Get work done",     desc: "Connect via private chat and get your job completed." },
                ].map(({ step, icon, title, desc }) => (
                  <div
                    key={step}
                    className="relative flex flex-col items-center rounded-2xl border border-slate-100 bg-slate-50 px-5 py-8 text-center shadow-sm"
                  >
                    <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-[#003d20] text-sm font-bold text-white shadow">
                      {step}
                    </div>
                    <span className="mb-2 text-3xl leading-none">{icon}</span>
                    <p className="text-sm font-bold text-slate-800">{title}</p>
                    <p className="mt-2 text-xs leading-5 text-slate-500">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── PROVIDER CTA ─────────────────────────────────────────────── */}
      {!hasCategory && (
        <section
          className="bg-gradient-to-br from-slate-800 to-slate-900 px-4 py-14 select-none"
          onDragStart={(e) => e.preventDefault()}
        >
          <div className="mx-auto max-w-2xl sm:flex sm:items-center sm:gap-12">

            {/* Left: copy */}
            <div className="flex-1 text-center sm:text-left">
              <p className="text-xs font-bold uppercase tracking-widest text-white/70">
                For Service Providers
              </p>
              <h2 className="mt-2 text-2xl font-bold text-white">
                Grow your business with Kaun Karega
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Get real customer leads in your area — free.
              </p>

              {/* Benefit bullets */}
              <ul className="mt-4 space-y-1.5 text-sm text-slate-300">
                {[
                  "Zero upfront cost or commission",
                  "Customers come to you — no cold calling",
                  "Manage leads from your dashboard",
                ].map((b) => (
                  <li key={b} className="flex items-start gap-2 sm:justify-start">
                    <span className="mt-0.5 shrink-0 text-white/70">&#10003;</span>
                    {b}
                  </li>
                ))}
              </ul>
            </div>

            {/* Right: CTA button */}
            <div className="mt-8 text-center sm:mt-0 sm:shrink-0">
              <button
                type="button"
                onClick={() => router.push("/provider/register")}
                className="inline-flex items-center gap-2 rounded-xl bg-[#003d20] px-7 py-3.5 text-sm font-bold text-white shadow-lg transition hover:bg-[#002a15] hover:shadow-xl"
              >
                Register as Provider &#8594;
              </button>
              <p className="mt-2 text-xs text-slate-400">Free registration. No commitment.</p>
            </div>
          </div>
        </section>
      )}

      {/* ── OTP MODAL ────────────────────────────────────────────────── */}
      {showOtpModal && !isLoggedIn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-2xl">
            <div className="space-y-2 text-center select-none">
              <h3 className="text-xl font-semibold text-slate-900">
                Verify your phone number
              </h3>
              <p className="mt-2 text-sm text-slate-600">
                To serve you better, please verify your number.
                <br />
                This helps us connect your request to the right nearby providers.
                <br />
                <br />
                Be assured &#8212; your phone number will NOT be shared with any provider.
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
                onDrop={(e) => e.preventDefault()}
                onDragOver={(e) => e.preventDefault()}
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
                    const value = e.target.value.replace(/\D/g, "");
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
                  onDrop={(e) => e.preventDefault()}
                  onDragOver={(e) => e.preventDefault()}
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
              <div className="mt-2 text-center text-sm text-slate-600">
                {!canResend ? (
                  <span>
                    Resend OTP in {String(Math.floor(otpTimer / 60)).padStart(2, "0")}:
                    {String(otpTimer % 60).padStart(2, "0")}
                  </span>
                ) : (
                  <button onClick={handleResendOtp} className="font-medium text-blue-600">
                    Resend OTP
                  </button>
                )}
              </div>
            )}

            {otpError && (
              <p className="text-center text-sm text-red-600">{otpError}</p>
            )}
            <style jsx>{`
              .shake {
                animation: shake 0.3s linear;
              }
              @keyframes shake {
                0% { transform: translateX(0); }
                20% { transform: translateX(-4px); }
                40% { transform: translateX(4px); }
                60% { transform: translateX(-4px); }
                80% { transform: translateX(4px); }
                100% { transform: translateX(0); }
              }
            `}</style>
          </div>
        </div>
      )}

    </div>
  );
}
