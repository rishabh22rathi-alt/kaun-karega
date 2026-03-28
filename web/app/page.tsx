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

type CategoryGroup = {
  title: string;
  items: { label: string; image: string }[];
  accent: string;
};

const CATEGORY_GROUPS: CategoryGroup[] = [
  {
    title: "Home Services",
    items: [
      { label: "Electrician", image: "/subcategories/home-electrician.svg" },
      { label: "Plumber", image: "/subcategories/home-plumber.svg" },
      { label: "Carpenter", image: "/subcategories/home-carpenter.svg" },
      { label: "Cleaning", image: "/subcategories/home-cleaning.svg" },
    ],
    accent: "bg-amber-50",
  },
  {
    title: "Education",
    items: [
      { label: "Home Tutor", image: "/subcategories/edu-tutor.svg" },
      { label: "Play School", image: "/subcategories/edu-play.svg" },
      { label: "Tuition", image: "/subcategories/edu-tuition.svg" },
      { label: "Coaching", image: "/subcategories/edu-coaching.svg" },
    ],
    accent: "bg-sky-50",
  },
  {
    title: "Repairs & Others",
    items: [
      { label: "AC Repair", image: "/subcategories/repair-ac.svg" },
      { label: "RO Repair", image: "/subcategories/repair-ro.svg" },
      { label: "Pest Control", image: "/subcategories/repair-pest.svg" },
      { label: "Painter", image: "/subcategories/repair-paint.svg" },
    ],
    accent: "bg-emerald-50",
  },
];

const ITEMS_PER_PAGE = 4;
const ROTATION_INTERVAL_MS = 3500;

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

const toGroupKey = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function FeaturedCategoryGrid() {
  const router = useRouter();
  const [pageByGroup, setPageByGroup] = useState<Record<string, number>>({});
  const [pausedGroups, setPausedGroups] = useState<Record<string, boolean>>({});
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(media.matches);
    update();
    if (media.addEventListener) {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) return;
    const intervalId = setInterval(() => {
      setPageByGroup((prev) => {
        let changed = false;
        const next = { ...prev };
        CATEGORY_GROUPS.forEach((group) => {
          const groupKey = toGroupKey(group.title);
          if (pausedGroups[groupKey]) return;
          const totalPages = Math.max(
            1,
            Math.ceil(group.items.length / ITEMS_PER_PAGE)
          );
          if (totalPages <= 1) return;
          const currentPage = prev[groupKey] ?? 0;
          const nextPage = (currentPage + 1) % totalPages;
          next[groupKey] = nextPage;
          changed = true;
        });
        return changed ? next : prev;
      });
    }, ROTATION_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [prefersReducedMotion, pausedGroups]);

  const handleManualChange = (
    groupKey: string,
    nextPage: number,
    totalPages: number
  ) => {
    if (totalPages <= 1) return;
    setPageByGroup((prev) => ({ ...prev, [groupKey]: nextPage }));
  };

  return (
    <section className="mb-6 w-full">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {CATEGORY_GROUPS.map((category) => {
          const groupKey = toGroupKey(category.title);
          const totalPages = Math.max(
            1,
            Math.ceil(category.items.length / ITEMS_PER_PAGE)
          );
          const currentPage = (pageByGroup[groupKey] ?? 0) % totalPages;
          const startIndex = currentPage * ITEMS_PER_PAGE;
          const featuredItems = category.items.slice(
            startIndex,
            startIndex + ITEMS_PER_PAGE
          );

          return (
            <div
              key={category.title}
              className={`rounded-2xl ${category.accent} p-4 shadow-sm`}
              onMouseEnter={() =>
                setPausedGroups((prev) => ({ ...prev, [groupKey]: true }))
              }
              onMouseLeave={() =>
                setPausedGroups((prev) => ({ ...prev, [groupKey]: false }))
              }
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  {category.title}
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={`Previous ${category.title} services`}
                    disabled={totalPages <= 1}
                    onClick={() =>
                      handleManualChange(
                        groupKey,
                        (currentPage - 1 + totalPages) % totalPages,
                        totalPages
                      )
                    }
                    className="flex h-7 w-7 items-center justify-center rounded-full border border-white/60 bg-white/80 text-slate-600 shadow-sm transition hover:text-slate-900 disabled:opacity-40"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 20 20"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M12.5 4.5L7 10l5.5 5.5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    aria-label={`Next ${category.title} services`}
                    disabled={totalPages <= 1}
                    onClick={() =>
                      handleManualChange(
                        groupKey,
                        (currentPage + 1) % totalPages,
                        totalPages
                      )
                    }
                    className="flex h-7 w-7 items-center justify-center rounded-full border border-white/60 bg-white/80 text-slate-600 shadow-sm transition hover:text-slate-900 disabled:opacity-40"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 20 20"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M7.5 4.5L13 10l-5.5 5.5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <ul
                key={`${groupKey}-${currentPage}`}
                className={`mt-4 grid grid-cols-2 gap-3 text-xs text-slate-700 ${
                  prefersReducedMotion ? "" : "featured-fade"
                }`}
              >
                {featuredItems.map((item) => (
                  <li key={item.label} className="flex flex-col items-center">
                    <div className="h-12 w-12 rounded-full bg-white/90 p-2 shadow-sm">
                      <img
                        src={item.image}
                        alt={item.label}
                        className="h-full w-full rounded-full object-cover"
                      />
                    </div>
                    <span className="mt-2 text-center font-medium">
                      {item.label}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="mt-4 inline-flex text-sm font-semibold text-slate-700 hover:text-slate-900"
              >
                View all
              </button>
            </div>
          );
        })}

        {/* I NEED card */}
        <div className="relative rounded-2xl bg-violet-500 p-4 shadow-sm">
          <button
            type="button"
            aria-label="Open I NEED"
            onClick={() => router.push("/i-need")}
            className="absolute inset-0 z-10 rounded-2xl bg-transparent"
          >
            <span className="sr-only">Open I NEED</span>
          </button>
          <div className="flex min-h-7 items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold leading-none text-white">I NEED</h3>
              <p className="mt-0.5 text-[10px] leading-none text-violet-100">Post your need &amp; get responses</p>
            </div>
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-3 text-xs text-white">
            {[
              { label: "Naukri", icon: "N" },
              { label: "Property", icon: "P" },
              { label: "Rent", icon: "R" },
              { label: "Buy / Sell", icon: "B/S" },
            ].map((item) => (
              <li key={item.label} className="flex flex-col items-center">
                <div className="h-12 w-12 rounded-full bg-white/15 p-2 shadow-sm ring-1 ring-white/20">
                  <div className="flex h-full w-full items-center justify-center rounded-full text-sm font-bold text-white">
                    {item.icon}
                  </div>
                </div>
                <span className="mt-2 text-center font-medium">{item.label}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="mt-4 inline-flex text-sm font-semibold text-white hover:text-violet-100"
          >
            Post or Browse &rarr;
          </button>
        </div>
      </div>
      <style jsx>{`
        .featured-fade {
          animation: featuredFade 260ms ease;
        }
        @keyframes featuredFade {
          from {
            opacity: 0;
            transform: translateY(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .featured-fade {
            animation: none;
          }
        }
      `}</style>
    </section>
  );
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
const APPS_SCRIPT_BASE_URL = (process.env.NEXT_PUBLIC_APPS_SCRIPT_URL || "")
  .trim()
  .replace(/\/$/, "");

type TaskDraft = {
  category?: string;
  area?: string;
  urgency?: string;
  time?: string;
  serviceDate?: string;
  timeSlot?: string;
  details?: string;
};

type ServiceStatsResponse = Record<string, unknown>;
type MatchProvidersResponse = {
  count?: number;
  providers?: unknown[];
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
  const [selectedArea, setSelectedArea] = useState("");
  const [serviceStats, setServiceStats] = useState<ServiceStatsResponse | null>(
    null
  );
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [matchedProviders, setMatchedProviders] = useState<unknown[]>([]);
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
  const statsRequestIdRef = useRef(0);
  const matchRequestIdRef = useRef(0);

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
      setSelectedArea(normalizedDraftArea);
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

  const fetchServiceStats = async (categoryValue: string) => {
    const normalizedCategory = categoryValue.trim();
    if (!normalizedCategory || !APPS_SCRIPT_BASE_URL) {
      setServiceStats(null);
      return;
    }
    const requestId = ++statsRequestIdRef.current;
    try {
      const url = `${APPS_SCRIPT_BASE_URL}?action=service_stats&service=${encodeURIComponent(
        normalizedCategory
      )}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`service_stats failed: ${res.status}`);
      }
      const data = (await res.json()) as ServiceStatsResponse;
      if (requestId !== statsRequestIdRef.current) return;
      setServiceStats(data);
    } catch (err) {
      if (requestId !== statsRequestIdRef.current) return;
      console.debug("[home] service_stats fetch failed", err);
      setServiceStats(null);
    }
  };

  const fetchMatch = async (categoryValue: string, areaValue: string) => {
    const normalizedCategory = categoryValue.trim();
    const normalizedArea = normalizeAreaValue(areaValue);
    if (!normalizedCategory || !normalizedArea || !APPS_SCRIPT_BASE_URL) {
      setMatchLoading(false);
      setMatchCount(null);
      setMatchedProviders([]);
      return;
    }
    const requestId = ++matchRequestIdRef.current;
    setMatchLoading(true);
    try {
      const url = `${APPS_SCRIPT_BASE_URL}?action=match_providers&service=${encodeURIComponent(
        normalizedCategory
      )}&area=${encodeURIComponent(normalizedArea)}&limit=20`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`match_providers failed: ${res.status}`);
      }
      const data = (await res.json()) as MatchProvidersResponse;
      if (requestId !== matchRequestIdRef.current) return;
      const providers = Array.isArray(data?.providers) ? data.providers : [];
      const count =
        typeof data?.count === "number" ? data.count : providers.length;
      setMatchCount(count);
      setMatchedProviders(providers);
    } catch (err) {
      if (requestId !== matchRequestIdRef.current) return;
      console.debug("[home] match_providers fetch failed", err);
      setMatchCount(0);
      setMatchedProviders([]);
    } finally {
      if (requestId === matchRequestIdRef.current) {
        setMatchLoading(false);
      }
    }
  };

  useEffect(() => {
    const nextCategory = category.trim();
    if (!nextCategory) {
      setSelectedCategory("");
      setServiceStats(null);
      return;
    }
    if (nextCategory !== selectedCategory) {
      setSelectedCategory(nextCategory);
    }
    const timer = window.setTimeout(() => {
      console.debug("[home] category selected:", nextCategory);
      fetchServiceStats(nextCategory);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [category, selectedCategory]);

  useEffect(() => {
    if (!selectedCategory || !selectedArea) {
      setMatchLoading(false);
      setMatchCount(null);
      setMatchedProviders([]);
      return;
    }
    fetchMatch(selectedCategory, selectedArea);
  }, [selectedCategory, selectedArea]);

  useEffect(() => {
    if (!serviceStats) return;
    console.debug("[home] service_stats cached for category:", selectedCategory);
  }, [serviceStats, selectedCategory]);

  useEffect(() => {
    if (!selectedArea) return;
    console.debug(
      "[home] matched providers cached:",
      matchedProviders.length,
      "for area:",
      selectedArea
    );
  }, [matchedProviders, selectedArea]);

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

      setShowDirectContactOption(false);
      setDetails("");
      if (typeof window !== "undefined") {
        window.localStorage.setItem("kk_last_area", normalizedArea);
      }
      clearTaskDraftFromSessionStorage();
      setIsRedirecting(true);
      router.replace(buildSuccessRedirect(category, normalizedArea));
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
          buttonUrl: "http://localhost:3000/login",
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
        `/api/find-providers?category=${encodeURIComponent(
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-8 leading-relaxed">
      <div className="w-full max-w-5xl rounded-3xl border border-slate-100 bg-white p-5 shadow-md md:p-7">
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

        <FeaturedCategoryGrid />

        {/* Step 1: Category search bar */}
        <div className="relative mb-6">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Step 1 · What help do you need?
          </label>
          <div className="mt-2 flex items-center rounded-full border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-400/30">
            <span className="mr-2 text-slate-400">🔍</span>
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
              onKeyDown={handleCategoryKeyDown}
              placeholder="Plumber, Electrician, Home Tutor, AC Mechanic..."
              className="w-full bg-transparent text-sm text-slate-900 outline-none md:text-base"
            />
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
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
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
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Step 3 · Where do you need it?
            </label>
            <AreaSelection
              selectedArea={area}
              onSelect={(value) => {
                const normalizedArea = normalizeAreaValue(value);
                setArea(normalizedArea);
                setSelectedArea(normalizedArea);
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
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
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
      </div>

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
  </div>
);
}




