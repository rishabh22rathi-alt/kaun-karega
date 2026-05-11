"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import confetti from "canvas-confetti";
import InAppToastStack, { type InAppToast } from "@/components/InAppToastStack";
import { PROVIDER_PROFILE_UPDATED_EVENT } from "@/components/sidebarEvents";
import {
  PROVIDER_PLEDGE_TEXT,
  PROVIDER_PLEDGE_VERSION,
} from "@/lib/disclaimer";

// Change limits here if business rules change.
// Restricted from 3 to 1 — providers register a single canonical service
// category. Aliases / work-tags under that category are surfaced through the
// existing category_aliases table (resolveCategoryAlias) and a separate
// provider-side alias-request endpoint (/api/provider/aliases). Bumping this
// constant alone will NOT re-enable multi-category signup — backend caps in
// /api/kk (provider_register) and /api/provider/update also enforce the limit.
const MAX_CATEGORIES = 1;
// Region-based coverage (Phase 1): provider picks exactly 3 regions, the
// client expands them into the canonical areas underneath and ships the
// flat list to the existing provider_areas writers — schema and matching
// stay byte-identical. Custom localities (off-region typed strings) still
// flow into pendingNewAreas / area_review_queue for the admin approval
// lifecycle.
const MIN_REGIONS = 3;
const MAX_REGIONS = 3;
// Legacy area-count caps — kept only for any downstream code that still
// references them; the new flow gates on region count instead.
const MIN_AREAS = 1;
const MAX_AREAS = 5;

type RegionOption = {
  region_code: string;
  region_name: string;
  areas: string[];
};

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
  requestedNewAreas?: string[];
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

function areaKey(value: string): string {
  return normalizeAreaInput(value).toLowerCase();
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
  // Tag pool from /api/categories?include=aliases. Key = canonical name lowercased.
  const [workTagsByCanonical, setWorkTagsByCanonical] = useState<
    Record<string, Array<{ tag: string; aliasType?: string }>>
  >({});
  // Alias suggestions surfaced in the category typeahead. Built from the same
  // /api/categories?include=aliases response as workTagsByCanonical, but kept
  // separate because the typeahead needs a flat list and aliasLookup needs an
  // index keyed by alias label for O(1) resolve in toggleCategory /
  // handleAddCustomCategory.
  const [aliasOptions, setAliasOptions] = useState<
    Array<{ label: string; canonical: string; aliasType?: string }>
  >([]);
  const [aliasLookup, setAliasLookup] = useState<
    Map<string, { canonical: string; label: string; aliasType?: string }>
  >(new Map());
  // Provider's tag picks per category. Key = categoryKey(category).
  const [selectedWorkTags, setSelectedWorkTags] = useState<Record<string, string[]>>(
    {}
  );
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);
  const [customAreaKeys, setCustomAreaKeys] = useState<string[]>([]);
  // Region-based coverage state (Phase 1).
  // `regionOptions` is the catalog from /api/area-intelligence/regions.
  // `selectedRegions` is the provider's pick (≤ MAX_REGIONS). `customLocalities`
  // are typed strings that don't fall inside any region — they still flow
  // into pendingNewAreas / area_review_queue, preserving the queue lifecycle.
  const [regionOptions, setRegionOptions] = useState<RegionOption[]>([]);
  const [isLoadingRegions, setIsLoadingRegions] = useState<boolean>(false);
  const [regionsError, setRegionsError] = useState<string>("");
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [customLocalities, setCustomLocalities] = useState<string[]>([]);
  const [customLocalityInput, setCustomLocalityInput] = useState<string>("");
  // One-shot flag that gates both the edit-mode inference effect and the
  // region→area expansion sync effect. Declared up-front because the sync
  // effect (defined earlier in the file) references it in its deps array.
  const [hasInferredRegions, setHasInferredRegions] = useState(false);

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
  const [showEditSuccessModal, setShowEditSuccessModal] = useState(false);
  const [successProviderId, setSuccessProviderId] = useState("");
  const [toasts, setToasts] = useState<InAppToast[]>([]);
  // Provider Responsibility Pledge — Phase 3. Only relevant on the
  // NEW-registration path; edit mode never reads or writes these. The
  // submit button stays clickable when the box is unchecked so the user
  // sees a friendly inline message rather than wondering why nothing
  // happens.
  const [pledgeAccepted, setPledgeAccepted] = useState(false);
  const [pledgeError, setPledgeError] = useState<string | null>(null);

  const showSuccessToast = (message: string) => {
    const id = `save-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((current) => [...current, { id, title: "Saved", message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 2500);
  };

  const dismissToast = (id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  };
  const [hasLoadedEditProfile, setHasLoadedEditProfile] = useState(false);

  const editTarget = searchParams.get("edit");
  const isEditMode = editTarget === "services" || editTarget === "areas";

  useEffect(() => {
    const userPhone = getUserPhone();
    if (!/^\d{10}$/.test(userPhone)) {
      router.replace("/login");
      return;
    }

    // In edit mode the user explicitly came to update their profile — skip guard.
    if (isEditMode) {
      setPhone(userPhone);
      setIsAuthChecking(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/kk?action=get_provider_by_phone&phone=${encodeURIComponent(userPhone)}`,
          { cache: "no-store" }
        );
        const data = (await parseJsonSafe(res)) as ProviderByPhoneResponse | null;
        if (cancelled) return;
        if (res.ok && data?.ok === true && data.provider?.ProviderID) {
          router.replace("/provider/dashboard?alreadyRegistered=true");
          return;
        }
      } catch {
        // If check fails, fall through to showing the form.
        // The submit path still catches duplicate registrations via the 409 response.
      }
      if (cancelled) return;
      setPhone(userPhone);
      setIsAuthChecking(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [router, isEditMode]);

  useEffect(() => {
    const loadCategories = async () => {
      setIsLoadingCategories(true);
      setCategoriesError("");
      try {
        // Opt-in to alias suggestions so we can derive work-tag chips.
        // The strict `data.data[]` parser below is unchanged; we only ALSO
        // read the new `data.suggestions[]` array for tag building.
        const response = await fetch("/api/categories?include=aliases", {
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
        if (Array.isArray(data?.data)) {
          setCategories(
            data.data
              .map((item: unknown) =>
                item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string"
                  ? (item as { name: string }).name
                  : null
              )
              .filter((value: string | null): value is string => typeof value === "string")
          );
        } else {
          setCategories([]);
          setCategoriesError(
            (typeof data?.error === "string" && data.error) || "Failed to load categories"
          );
        }

        // Build the tag map keyed by canonical (lowercased). Non-alias rows
        // and rows missing label/canonical are skipped. When the API or
        // mocks omit `suggestions`, this leaves the map empty and the
        // tag-chip section never renders — registration flow unaffected.
        const suggestions = Array.isArray(data?.suggestions)
          ? (data.suggestions as Array<Record<string, unknown>>)
          : [];
        const tagsMap: Record<string, Array<{ tag: string; aliasType?: string }>> = {};
        const optionsList: Array<{ label: string; canonical: string; aliasType?: string }> = [];
        const lookupMap = new Map<
          string,
          { canonical: string; label: string; aliasType?: string }
        >();
        for (const row of suggestions) {
          if (!row || row.type !== "alias") continue;
          const label = typeof row.label === "string" ? row.label.trim() : "";
          const canonical =
            typeof row.canonical === "string" ? row.canonical.trim() : "";
          if (!label || !canonical) continue;
          const aliasType =
            typeof row.aliasType === "string" ? row.aliasType.trim() : "";
          const key = canonical.toLowerCase();
          if (!tagsMap[key]) tagsMap[key] = [];

          // Guard against duplicate alias rows in the suggestions[] feed
          // (e.g. same "lohar" returned twice). Match by tag label only.
          const exists = tagsMap[key].some((t) => t.tag === label);
          if (!exists) {
            tagsMap[key].push(
              aliasType ? { tag: label, aliasType } : { tag: label }
            );
          }

          // aliasOptions feeds the category typeahead; aliasLookup is the
          // O(1) resolver for toggleCategory and the belt-and-braces guard
          // in handleAddCustomCategory. Indexed by categoryKey(label) so the
          // input normalisation matches everywhere. First-write-wins on rare
          // cross-canonical label collisions; the API already de-dupes alias-
          // vs-canonical and per-canonical duplicates.
          const labelKey = categoryKey(label);
          if (!lookupMap.has(labelKey)) {
            const entry = aliasType
              ? { canonical, label, aliasType }
              : { canonical, label };
            lookupMap.set(labelKey, entry);
            optionsList.push(
              aliasType ? { label, canonical, aliasType } : { label, canonical }
            );
          }
        }
        setWorkTagsByCanonical(tagsMap);
        setAliasOptions(optionsList);
        setAliasLookup(lookupMap);
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

  // Region catalog — drives the new Step 3 region picker.
  useEffect(() => {
    const loadRegions = async () => {
      setIsLoadingRegions(true);
      setRegionsError("");
      try {
        const res = await fetch("/api/area-intelligence/regions", {
          cache: "no-store",
        });
        const data = (await res.json()) as {
          ok?: boolean;
          regions?: RegionOption[];
          error?: string;
        };
        if (!res.ok || !data?.ok || !Array.isArray(data.regions)) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        // Only keep regions that have at least one area — empty regions
        // would produce zero provider_areas rows and confuse the picker.
        setRegionOptions(
          data.regions.filter(
            (r) =>
              r.region_code &&
              Array.isArray(r.areas) &&
              r.areas.length > 0
          )
        );
      } catch (err) {
        setRegionOptions([]);
        setRegionsError(
          err instanceof Error ? err.message : "Failed to load regions"
        );
      } finally {
        setIsLoadingRegions(false);
      }
    };
    loadRegions();
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
        setCustomAreaKeys([]);
        // Region/locality inference is deferred to a separate effect that
        // waits for both `serviceAreas` (loaded here) and `regionOptions`
        // (the catalog fetch). Without both, mapping would yield zero
        // regions and clobber the provider's saved coverage.
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

  // Region → area expansion. `selectedAreas` becomes a DERIVED value
  // (union of all canonical areas inside the selected regions, plus
  // any custom localities). All downstream submit / count / payload
  // code keeps working with `selectedAreas` unchanged.
  //
  // Skipped while the edit-mode inference effect is still running so
  // the initial empty regions+localities state doesn't temporarily
  // clobber the freshly-loaded saved set.
  useEffect(() => {
    if (isEditMode && !hasInferredRegions) return;
    const seen = new Set<string>();
    const merged: string[] = [];
    const push = (s: string) => {
      const t = s.trim();
      if (!t) return;
      const k = t.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      merged.push(t);
    };
    for (const rc of selectedRegions) {
      const region = regionOptions.find((r) => r.region_code === rc);
      if (!region) continue;
      for (const a of region.areas) push(a);
    }
    for (const c of customLocalities) push(c);
    setSelectedAreas(merged);
    // Mark custom-locality keys so the existing pendingNewAreas filter
    // (which checks customAreaKeys.includes) picks them up at submit.
    setCustomAreaKeys(customLocalities.map((c) => areaKey(c)));
  }, [
    selectedRegions,
    customLocalities,
    regionOptions,
    isEditMode,
    hasInferredRegions,
  ]);

  // Edit-mode inference — once both the region catalog and the
  // provider's saved `selectedAreas` are loaded, derive:
  //   selectedRegions  = regions whose every active canonical_area is in
  //                       the provider's saved set (case-insensitive).
  //                       Conservative: only "fully covered" regions are
  //                       inferred to avoid silently shrinking coverage.
  //   customLocalities = saved areas not covered by any inferred region.
  // Runs only once per edit session (gated by hasInferredRegions, which
  // is declared above with the other Step 3 state).
  useEffect(() => {
    if (!isEditMode) return;
    if (hasInferredRegions) return;
    if (!hasLoadedEditProfile) return;
    if (regionOptions.length === 0) return;
    const norm = (v: string) => v.trim().toLowerCase();
    const savedSet = new Set(selectedAreas.map(norm).filter(Boolean));
    if (savedSet.size === 0) {
      setHasInferredRegions(true);
      return;
    }
    const inferredRegions: string[] = [];
    const coveredByInferred = new Set<string>();
    for (const region of regionOptions) {
      const regionKeys = region.areas.map(norm).filter(Boolean);
      if (regionKeys.length === 0) continue;
      const everyAreaSaved = regionKeys.every((k) => savedSet.has(k));
      if (!everyAreaSaved) continue;
      inferredRegions.push(region.region_code);
      for (const k of regionKeys) coveredByInferred.add(k);
      if (inferredRegions.length >= MAX_REGIONS) break;
    }
    setSelectedRegions(inferredRegions);
    const leftovers = selectedAreas.filter(
      (a) => !coveredByInferred.has(norm(a))
    );
    setCustomLocalities(leftovers);
    setHasInferredRegions(true);
  }, [
    isEditMode,
    hasInferredRegions,
    hasLoadedEditProfile,
    regionOptions,
    selectedAreas,
  ]);

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

  const filteredCategories = useMemo<
    Array<{ value: string; display: string; isAlias: boolean; canonical: string }>
  >(() => {
    const q = categoryKey(catQuery);
    const selectedKeys = toCategoryLookup(selectedCategories);

    // Single dedup set used by both the canonical and alias pushes. Key
    // mirrors the render-side React key in the suggestion list, so a chip
    // that survives this Set is guaranteed unique on render. Prevents the
    // "two children with the same key" warning when the API or local state
    // produces duplicate canonical names (e.g. case-only differences) or
    // when an alias label collides with another alias.
    const seenKeys = new Set<string>();
    const dedupKey = (isAlias: boolean, value: string) =>
      `${isAlias ? "alias" : "canon"}:${value.toLowerCase()}`;
    const out: Array<{
      value: string;
      display: string;
      isAlias: boolean;
      canonical: string;
    }> = [];

    // Canonical entries — drop already-selected, then push only if unseen.
    for (const item of categories) {
      if (selectedKeys.has(categoryKey(item))) continue;
      const key = dedupKey(false, item);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      out.push({ value: item, display: item, isAlias: false, canonical: item });
    }

    // Default view (no query) — show ONLY canonical chips. Aliases stay
    // hidden until the provider actively searches; they would otherwise
    // flood the chip list and obscure the canonical service taxonomy.
    if (!q) return out;

    // Search view — alias entries join the pool, displayed as
    // "alias (canonical)" so the provider sees the underlying service.
    // Aliases whose canonical is already selected, or whose label collides
    // with a selected canonical, are filtered out so MAX_CATEGORIES=1
    // cannot be bypassed by picking canonical + its alias.
    for (const opt of aliasOptions) {
      if (selectedKeys.has(categoryKey(opt.canonical))) continue;
      if (selectedKeys.has(categoryKey(opt.label))) continue;
      const key = dedupKey(true, opt.label);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      out.push({
        value: opt.label,
        display: `${opt.label} (${opt.canonical})`,
        isAlias: true,
        canonical: opt.canonical,
      });
    }

    return out.filter((opt) => categoryKey(opt.value).includes(q));
  }, [categories, catQuery, selectedCategories, aliasOptions]);

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
    selectedRegions.length === MIN_REGIONS &&
    !isSubmitting &&
    !showSuccessCelebration &&
    !showEditSuccessModal;
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

    const normalizedInput = normalizeCategoryInput(category);
    if (!normalizedInput) return;
    const inputKey = categoryKey(normalizedInput);

    // Alias-aware path. If the picked value is a known alias, route the
    // canonical into selectedCategories AND auto-add the alias label into
    // selectedWorkTags[canonicalKey]. Never adds to customCategoryKeys, so
    // the submit path will not flag it as a pending category request.
    const aliasHit = aliasLookup.get(inputKey);
    if (aliasHit) {
      const canonical = normalizeCategoryInput(aliasHit.canonical);
      const canonicalKey = categoryKey(canonical);

      // Snapshot guard against MAX_CATEGORIES — same UX as the canonical
      // path. Closure value is the just-rendered state the user saw when
      // they clicked, which is correct in normal event flow.
      const isCanonicalSelected = hasCategoryKey(selectedCategories, canonicalKey);
      if (!isCanonicalSelected && selectedCategories.length >= MAX_CATEGORIES) {
        return;
      }

      setSelectedCategories((prev) => {
        if (hasCategoryKey(prev, canonicalKey)) return prev;
        if (prev.length >= MAX_CATEGORIES) return prev;
        return [...prev, canonical];
      });
      setSelectedWorkTags((prev) => {
        const current = prev[canonicalKey] || [];
        if (current.includes(aliasHit.label)) return prev;
        return { ...prev, [canonicalKey]: [...current, aliasHit.label] };
      });
      // Clear the typed query so:
      //   1. the input no longer shows the search term ("Dance") that
      //      conceptually resolved into a different label;
      //   2. noMatch derives from an empty q → false → "+ Add as new"
      //      cannot fire on a value that was actually a known alias.
      setCatQuery("");
      return;
    }

    // Canonical / unknown path — preserved verbatim from prior behaviour.
    setSelectedCategories((prev) => {
      if (hasCategoryKey(prev, inputKey)) {
        setCustomCategoryKeys((existingKeys) => existingKeys.filter((item) => item !== inputKey));
        // Drop any tag picks tied to a category that's being deselected so
        // we never ship orphan tags in the payload.
        setSelectedWorkTags((wt) => {
          if (!wt[inputKey]) return wt;
          const next = { ...wt };
          delete next[inputKey];
          return next;
        });
        return removeCategoryKey(prev, inputKey);
      }
      if (prev.length >= MAX_CATEGORIES) {
        return prev;
      }
      return [...prev, normalizedInput];
    });
  };

  const addArea = (area: string) => {
    setSubmitError("");
    setSuccess(null);
    setAreasLimitError("");
    const normalizedArea = normalizeAreaInput(area);
    const normalizedAreaKey = areaKey(normalizedArea);
    setSelectedAreas((prev) => {
      if (prev.some((item) => areaKey(item) === normalizedAreaKey)) return prev;
      if (prev.length >= MAX_AREAS) {
        setAreasLimitError("Max 5 areas allowed");
        return prev;
      }
      return [...prev, normalizedArea];
    });
    setCustomAreaKeys((prev) => prev.filter((item) => item !== normalizedAreaKey));
    setAreaSearch("");
    setShowAreaSuggestions(false);
  };

  const removeCategory = (category: string) => {
    const key = categoryKey(category);
    setCustomCategoryKeys((prev) => prev.filter((item) => item !== key));
    setSelectedCategories((prev) => removeCategoryKey(prev, key));
    // Mirror toggleCategory's cleanup so the X button doesn't leave orphans.
    setSelectedWorkTags((wt) => {
      if (!wt[key]) return wt;
      const next = { ...wt };
      delete next[key];
      return next;
    });
  };

  // Tag derivation per category. If any row for this canonical has
  // alias_type IN ('work_tag','local_name'), use ONLY those. Otherwise fall
  // back to all aliases for the category — matches the user spec for
  // partially-populated `alias_type` data.
  const getWorkTagsForCategory = (category: string): string[] => {
    const key = categoryKey(category);
    const rows = workTagsByCanonical[key] || [];
    if (rows.length === 0) return [];
    const strict = rows
      .filter(
        (r) => r.aliasType === "work_tag" || r.aliasType === "local_name"
      )
      .map((r) => r.tag);
    return strict.length > 0 ? strict : rows.map((r) => r.tag);
  };

  const toggleWorkTag = (category: string, tag: string) => {
    const key = categoryKey(category);
    setSelectedWorkTags((prev) => {
      const current = prev[key] || [];
      const next = current.includes(tag)
        ? current.filter((t) => t !== tag)
        : [...current, tag];
      return { ...prev, [key]: next };
    });
  };

  const removeArea = (area: string) => {
    setAreasLimitError("");
    const key = areaKey(area);
    setCustomAreaKeys((prev) => prev.filter((item) => item !== key));
    setSelectedAreas((prev) => prev.filter((item) => areaKey(item) !== key));
  };

  const handleAddCustomArea = () => {
    if (isMaxAreasReached) {
      setAreasLimitError("Max 5 areas allowed");
      return;
    }
    if (!canAddCustomArea) return;
    const pendingArea = normalizedAreaQuery;
    const pendingAreaKey = areaKey(pendingArea);
    addArea(pendingArea);
    setCustomAreaKeys((prev) => (prev.includes(pendingAreaKey) ? prev : [...prev, pendingAreaKey]));
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

    // Belt-and-braces: if the typed value is actually a known alias, divert
    // to the alias-resolved path so it never becomes a pending category
    // request. The canAddCustomCategory gate already excludes aliases via
    // filteredCategories, but this guards against a race during initial
    // alias load and against any future filter drift.
    if (aliasLookup.has(key)) {
      toggleCategory(pending);
      setCatQuery("");
      return;
    }

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
  };

  const handleSubmit = async () => {
    if (!canSubmit || !/^\d{10}$/.test(phone)) return;

    // Pledge gate — NEW-registration path only. Edit mode (provider_update
    // flow below) skips this entirely so existing / imported / legacy
    // providers can keep saving changes without re-accepting. The submit
    // button is intentionally still enabled when the box is unchecked
    // (canSubmit excludes pledgeAccepted) so the user gets a clear inline
    // message instead of a silently-disabled button.
    if (!isEditMode && !pledgeAccepted) {
      setPledgeError(
        "Please accept the Provider Responsibility Pledge to continue."
      );
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");
    setSuccess(null);

    try {
      if (isEditMode) {
        // Provider self-update path. This does NOT use provider_register (insert)
        // semantics and must send real arrays, not JSON.stringify strings. The
        // server resolves provider_id from the session phone for ownership.
        const updateRes = await fetch("/api/provider/update", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim().toUpperCase(),
            categories: uniqueCategoryValues(selectedCategories),
            areas: selectedAreas,
          }),
        });
        const updateData = (await parseJsonSafe(updateRes)) as
          | { ok?: boolean; error?: string; message?: string }
          | null;
        if (!updateRes.ok || updateData?.ok !== true) {
          throw new Error(
            updateData?.error || updateData?.message || "Failed to save changes"
          );
        }

        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event(PROVIDER_PROFILE_UPDATED_EVENT));
        }

        setShowEditSuccessModal(true);
        popConfetti();
        window.setTimeout(() => {
          router.push("/provider/dashboard");
        }, 1800);
        return;
      }

      const pendingNewCategories = selectedCategories.filter((category) =>
        customCategoryKeys.includes(categoryKey(category))
      );
      const pendingNewAreas = selectedAreas.filter((area) =>
        customAreaKeys.includes(areaKey(area))
      );
      const customCategory = pendingNewCategories[0] || "";
      const payload = {
        action: "provider_register",
        phone,
        name: name.trim().toUpperCase(),
        categories: JSON.stringify(uniqueCategoryValues(selectedCategories)),
        areas: JSON.stringify(selectedAreas),
        pendingNewCategories: JSON.stringify(pendingNewCategories),
        pendingNewAreas: JSON.stringify(pendingNewAreas),
        customCategory,
        // MVP: ship tag picks on the wire. Backend currently ignores unknown
        // fields — when DB persistence lands the route reads this directly.
        // Edit-mode path doesn't reach this payload.
        workTags: JSON.stringify(selectedWorkTags),
        requiresAdminApproval:
          pendingNewCategories.length > 0 || pendingNewAreas.length > 0 ? "true" : "false",
        // Provider Responsibility Pledge — version only. The server
        // generates and stores pledge_accepted_at itself; we deliberately
        // do NOT send a client-side timestamp.
        pledgeVersion: PROVIDER_PLEDGE_VERSION,
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
        // Backend returns 409 { error: "already_registered" } when the phone already
        // exists in providers. The register-entry guard handles this for new signups;
        // in edit mode it can still fire, but this form must not surface that message.
        if (
          data?.error === "already_registered" ||
          data?.message === "already_registered"
        ) {
          showSuccessToast("You are already registered. Redirecting to dashboard...");
          setTimeout(() => {
            router.push("/provider/dashboard");
          }, 1200);
          return;
        }
        throw new Error(data?.error || data?.message || "Failed to submit registration");
      }

      setSuccess(data ?? { ok: true, status: "success" });
      const hasPendingApproval =
        String(data?.pendingApproval || data?.provider?.PendingApproval || "no").trim().toLowerCase() ===
        "yes";
      const hasPendingAreaReview = Boolean(data?.requestedNewAreas?.length);
      const requiresAdminApproval = hasPendingApproval || hasPendingAreaReview;
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
            (hasPendingApproval ? "Pending Admin Approval" : "Active"),
        };
        window.localStorage.setItem("kk_provider_profile", JSON.stringify(fallbackProfile));
        window.dispatchEvent(new Event(PROVIDER_PROFILE_UPDATED_EVENT));

        try {
          const profileResponse = await fetch(
            `/api/kk?action=get_provider_by_phone&phone=${encodeURIComponent(phone)}`,
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
                      ? "You can choose only one main service category"
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
                      filteredCategories.map((option) => {
                        // For aliases the "selected" state tracks the resolved
                        // canonical, but those rows are pre-filtered when the
                        // canonical is already selected, so this stays false in
                        // the alias case — kept for symmetry with the canonical
                        // path.
                        const selected = hasCategoryKey(
                          selectedCategories,
                          categoryKey(option.canonical)
                        );
                        const disabled = !selected && totalSelectedServices >= MAX_CATEGORIES;
                        return (
                          <button
                            key={`${option.isAlias ? "alias" : "canon"}:${option.value}`}
                            type="button"
                            onClick={() => toggleCategory(option.value)}
                            disabled={disabled}
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                              selected
                                ? "border-green-700 bg-green-700 text-white"
                                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                            } disabled:cursor-not-allowed disabled:opacity-60`}
                          >
                            {option.display}
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
                    {selectedCategories.map((category) => {
                      // Show alias-derived work tags inline so the provider
                      // sees what they actually picked. After an alias-pick
                      // the chip reads e.g. "dance teacher (hobby classes)"
                      // instead of just the canonical. Empty when the
                      // canonical was picked directly with no tags toggled.
                      const tags = selectedWorkTags[categoryKey(category)] || [];
                      const displayLabel =
                        tags.length > 0
                          ? `${tags.join(", ")} (${category})`
                          : category;
                      return (
                        <button
                          key={category}
                          type="button"
                          onClick={() => removeCategory(category)}
                          className="inline-flex items-center gap-2 rounded-full border border-green-700 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-800"
                        >
                          {displayLabel}
                          {customCategoryKeys.includes(categoryKey(category)) ? (
                            <span className="rounded bg-green-700 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                              NEW
                            </span>
                          ) : null}
                          <span aria-hidden="true">x</span>
                        </button>
                      );
                    })}
                    </div>
                  ) : null}
                  {/* Work-tag chips, one section per selected category that
                      has tags. Hidden in edit mode (decision 7) and hidden
                      for categories with no tag rows so the UI stays quiet
                      for plain categories. */}
                  {!isEditMode && totalSelectedServices > 0 ? (
                    <div className="mt-3 space-y-3">
                      {selectedCategories.map((category) => {
                        const tags = getWorkTagsForCategory(category);
                        if (tags.length === 0) return null;
                        const key = categoryKey(category);
                        const selectedTags = new Set(
                          selectedWorkTags[key] || []
                        );
                        return (
                          <div key={`tags-${key}`}>
                            <p className="mb-1 text-xs text-slate-500">
                              Work tags for{" "}
                              <span className="font-semibold text-slate-700">
                                {category}
                              </span>
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {tags.map((tag) => {
                                const isSelected = selectedTags.has(tag);
                                return (
                                  <button
                                    key={`${key}-${tag}`}
                                    type="button"
                                    onClick={() => toggleWorkTag(category, tag)}
                                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                                      isSelected
                                        ? "border-green-700 bg-green-700 text-white"
                                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                                    }`}
                                  >
                                    {tag}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
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
                  <label className="block text-sm font-semibold text-slate-700">
                    Step 3: Service regions — choose {MIN_REGIONS}
                  </label>
                  <span className="text-xs font-medium text-slate-500">
                    {selectedRegions.length}/{MAX_REGIONS}
                  </span>
                </div>
                <p className="mb-3 text-xs text-slate-500">
                  Pick exactly {MIN_REGIONS} regions you cover. We'll
                  expand each into the areas inside it for matching.
                </p>
                {isLoadingRegions ? (
                  <p className="text-xs text-slate-500">Loading regions…</p>
                ) : null}
                {regionsError ? (
                  <p className="text-xs text-red-600">Error: {regionsError}</p>
                ) : null}
                {!isLoadingRegions && !regionsError && regionOptions.length === 0 ? (
                  <p className="text-xs text-slate-500">No regions available.</p>
                ) : null}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {regionOptions.map((region) => {
                    const isSelected = selectedRegions.includes(region.region_code);
                    const isAtMax =
                      !isSelected && selectedRegions.length >= MAX_REGIONS;
                    const areaPreview = region.areas.slice(0, 6).join(" · ");
                    const moreCount = Math.max(0, region.areas.length - 6);
                    return (
                      <div
                        key={region.region_code}
                        className={`rounded-2xl border p-4 shadow-sm transition ${
                          isSelected
                            ? "border-emerald-500 bg-emerald-50/70"
                            : "border-slate-200 bg-white"
                        } ${isAtMax ? "opacity-60" : ""}`}
                      >
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-xs font-bold text-slate-600">
                            {region.region_code}
                          </span>
                          <h3 className="text-sm font-semibold text-slate-900">
                            {region.region_name || "—"}
                          </h3>
                        </div>
                        <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                          {region.areas.length} area
                          {region.areas.length === 1 ? "" : "s"}
                        </p>
                        <p className="mt-2 text-xs leading-relaxed text-slate-700">
                          {areaPreview}
                          {moreCount > 0 ? (
                            <span className="text-slate-400">
                              {" "}
                              · +{moreCount} more
                            </span>
                          ) : null}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            if (!canAccessAreas) {
                              nudgeSelectCategory();
                              return;
                            }
                            setSelectedRegions((prev) => {
                              if (prev.includes(region.region_code)) {
                                return prev.filter(
                                  (rc) => rc !== region.region_code
                                );
                              }
                              if (prev.length >= MAX_REGIONS) return prev;
                              return [...prev, region.region_code];
                            });
                          }}
                          disabled={isAtMax || showSuccessCelebration}
                          className={`mt-3 inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-bold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                            isSelected
                              ? "bg-emerald-600 text-white hover:bg-emerald-700"
                              : "border border-[#003d20] text-[#003d20] hover:bg-[#003d20]/5"
                          }`}
                        >
                          {isSelected ? "Selected ✓" : "Pick Region"}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Custom locality — preserves the provider → queue →
                    admin approval lifecycle even in the region-based UI.
                    Typed strings flow into pendingNewAreas at submit
                    (registration) or get caught by /api/provider/update's
                    enqueue (edit). */}
                <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-700">
                    Missing your locality?
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Add a custom locality (optional). Admin will review and
                    map it to a region for future matching. Custom
                    localities don't count toward your {MIN_REGIONS}-region
                    requirement.
                  </p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      value={customLocalityInput}
                      onChange={(e) => setCustomLocalityInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const v = customLocalityInput.trim();
                          if (!v) return;
                          const key = v.toLowerCase();
                          if (
                            customLocalities.some(
                              (c) => c.toLowerCase() === key
                            )
                          )
                            return;
                          setCustomLocalities((prev) => [...prev, v]);
                          setCustomLocalityInput("");
                        }
                      }}
                      placeholder="e.g. Demo Colony"
                      disabled={!canAccessAreas || showSuccessCelebration}
                      className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200 disabled:cursor-not-allowed disabled:bg-slate-100"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const v = customLocalityInput.trim();
                        if (!v) return;
                        const key = v.toLowerCase();
                        if (
                          customLocalities.some((c) => c.toLowerCase() === key)
                        )
                          return;
                        setCustomLocalities((prev) => [...prev, v]);
                        setCustomLocalityInput("");
                      }}
                      disabled={
                        !customLocalityInput.trim() ||
                        !canAccessAreas ||
                        showSuccessCelebration
                      }
                      className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Add locality
                    </button>
                  </div>
                  {customLocalities.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {customLocalities.map((loc) => (
                        <span
                          key={loc}
                          className="inline-flex items-center gap-2 rounded-full border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800"
                        >
                          {loc}
                          <span className="rounded bg-sky-700 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                            REVIEW
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setCustomLocalities((prev) =>
                                prev.filter(
                                  (c) =>
                                    c.toLowerCase() !== loc.toLowerCase()
                                )
                              )
                            }
                            aria-label={`Remove ${loc}`}
                            className="text-sky-700 hover:text-sky-900"
                          >
                            x
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              {!isEditMode ? (
                <div
                  data-testid="kk-pledge-card"
                  className="rounded-2xl border border-[#003d20]/15 bg-gradient-to-br from-orange-50/60 to-green-50/40 p-4 shadow-sm"
                >
                  <div className="flex items-center gap-2">
                    <span aria-hidden="true" className="text-base">🤝</span>
                    <p className="text-sm font-bold text-[#003d20]">
                      Provider Responsibility Pledge
                    </p>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    A quick read so we&apos;re on the same page.
                  </p>
                  <div className="mt-3 max-h-40 overflow-y-auto rounded-xl border border-white/60 bg-white p-3 text-xs leading-5 text-slate-600">
                    {PROVIDER_PLEDGE_TEXT.split(/\n\n+/).map((paragraph, idx) => (
                      <p
                        key={idx}
                        className={`mb-2 last:mb-0 ${
                          idx === 0 ? "font-semibold text-slate-700" : ""
                        }`}
                      >
                        {paragraph}
                      </p>
                    ))}
                  </div>
                  <label className="mt-3 flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={pledgeAccepted}
                      onChange={(e) => {
                        setPledgeAccepted(e.target.checked);
                        if (e.target.checked) setPledgeError(null);
                      }}
                      data-testid="kk-pledge-checkbox"
                      className="mt-0.5 h-4 w-4 cursor-pointer accent-[#003d20]"
                    />
                    <span className="text-xs font-semibold text-slate-800">
                      I have read and accept the Provider Responsibility Pledge.
                    </span>
                  </label>
                  <p
                    data-testid="kk-pledge-trust-line"
                    className="ml-6 mt-1 text-[11px] text-slate-500"
                  >
                    This helps keep Kaun Karega safe and trustworthy for everyone.
                  </p>
                  {pledgeError ? (
                    <p
                      data-testid="kk-pledge-error"
                      className="ml-6 mt-2 text-xs font-medium text-red-600"
                    >
                      {pledgeError}
                    </p>
                  ) : null}
                </div>
              ) : null}

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
                <p className="mt-1 text-slate-700">
                  {selectedAreas.length > 0
                    ? selectedAreas.map((area) =>
                        customAreaKeys.includes(areaKey(area)) ? `${area} (pending review)` : area
                      ).join(", ")
                    : "-"}
                </p>
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
              {success.requestedNewAreas?.length ? (
                <p className="mt-2 text-xs text-green-700">
                  Pending area review: {success.requestedNewAreas.join(", ")}
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
      <InAppToastStack toasts={toasts} onDismiss={dismissToast} />
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
      {showEditSuccessModal ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 px-4">
          <div className="w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-6 text-center shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-7 w-7"
                aria-hidden="true"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h2 className="mt-4 text-2xl font-bold tracking-wide text-emerald-700 md:text-3xl">
              Changes Saved Successfully
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-700">
              Your services and areas have been updated.
            </p>
            {selectedCategories.some((category) =>
              customCategoryKeys.includes(categoryKey(category))
            ) ? (
              <p className="mt-3 text-xs text-slate-500">
                New service requests will be reviewed by admin.
              </p>
            ) : null}
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
