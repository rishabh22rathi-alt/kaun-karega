"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LocateFixed } from "lucide-react";

import { usePublicGeo } from "@/lib/cities/publicGeoContext";

type AreaSelectionProps = {
  selectedArea: string;
  onSelect: (area: string) => void;
  errorMessage?: string;
  showQuestionLabel?: boolean;
  // Opt-in: render the "Search across all Jodhpur" toggle. Default false so
  // existing consumers (homepage) are unchanged. When the user turns it on,
  // the normal area picker is replaced by a single "All Jodhpur" chip and
  // onScopeChange('all_jodhpur') fires (onSelect receives "All Jodhpur").
  allowAllJodhpur?: boolean;
  onScopeChange?: (scope: "region" | "all_jodhpur") => void;
};

const MAX_SUGGESTIONS = 8;
const AI_SUGGEST_DEBOUNCE_MS = 150;
// Two popular-region chips at most. Combined with the optional last-used
// chip, the row holds at most 3 entries — matches the homepage spec and
// keeps the row single-line on mobile without scrolling. Source order
// for popular regions is whatever /api/area-intelligence/regions returns
// (region_code ASC by Phase 1.1).
const MAX_POPULAR_REGION_CHIPS = 2;
// Fallback-panel default count. When typing finds no match we surface
// up to this many region chips collapsed; the "Show more regions" toggle
// expands to the full active-region set for the city. Initial cap keeps
// a 25-region city compact on mobile.
const REGIONS_COLLAPSED_COUNT = 6;

// City-scoped storage key for the last-used area. A user who picks
// Sardarpura in JOD and then switches to JAI should not see Sardarpura as
// "Last used" in JAI — the key is suffixed with the city code so each
// city carries its own memory.
const LAST_AREA_KEY_PREFIX = "kk_last_area:";
const lastAreaKeyFor = (cityCode: string) =>
  cityCode ? `${LAST_AREA_KEY_PREFIX}${cityCode}` : "";

function toTitleCase(str: string) {
  return str
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function normalizeAreaValue(area: string): string {
  const singleSpaced = area.trim().replace(/\s+/g, " ");
  if (!singleSpaced) return "";
  return toTitleCase(singleSpaced);
}

// City-level phrases that must NOT be treated as a normal area. They route
// to the virtual "Search across all Jodhpur" option instead. The bare city
// name is also matched dynamically against the selected city.
const CITY_LEVEL_TERMS = new Set([
  "jodhpur",
  "all jodhpur",
  "whole jodhpur",
  "full jodhpur",
]);

export function isCityLevelTerm(value: string, cityName = ""): boolean {
  const v = value.trim().replace(/\s+/g, " ").toLowerCase();
  if (!v) return false;
  if (CITY_LEVEL_TERMS.has(v)) return true;
  const city = cityName.trim().toLowerCase();
  return Boolean(city) && v === city;
}

// Animated bold placeholder examples for the area input (regions/localities
// only). Cycled with a typewriter effect when the input is idle + empty.
const AREA_TW_HINTS = [
  "Sardarpura",
  "Shastri Nagar",
  "Ratanada",
  "Paota",
  "Mandore",
  "Pal Road",
  "Basni",
  "Kudi Bhagtasni",
  "Chopasni",
];
const AREA_TW_TYPE_MS = 90;
const AREA_TW_DELETE_MS = 45;
const AREA_TW_PAUSE_COMPLETE_MS = 1600;
const AREA_TW_PAUSE_BETWEEN_MS = 420;

// Area Intelligence integration — same safety contract as before the
// cascade rebuild: the value handed to `onSelect` (and therefore the
// submit payload) MUST be a canonical area present in `/api/areas` for
// the currently-selected city. AI suggestions that aren't in that set
// are dropped before they reach the user.
type AiSuggestion = {
  type?: string;
  label?: string;
  canonical_area?: string | null;
  region_code?: string;
  region_name?: string;
};

// Shape of one row from /api/area-intelligence/regions for the selected
// city. `areas` is the canonical-area names that belong to this region —
// already city-scoped (Phase 1.1) and active-filtered server-side.
type RegionOption = {
  region_code: string;
  region_name: string;
  areas: string[];
  city_code?: string;
};

type DetectStatus =
  | "idle"
  | "pending"
  | "success"
  | "permission_denied"
  | "unsupported"
  | "no_match"
  | "city_mismatch"
  | "error";

type DetectSuggestion = {
  detectedArea: string;
  regionCode: string;
  regionName: string;
  message: string;
};

export default function AreaSelection({
  selectedArea,
  onSelect,
  errorMessage,
  showQuestionLabel = true,
  allowAllJodhpur = false,
  onScopeChange,
}: AreaSelectionProps) {
  const {
    isLoading: geoLoading,
    cities,
    states,
    selectedState,
    selectedCityCode,
    selectedCityName,
    citiesForState,
    setState,
    setCityCode,
  } = usePublicGeo();

  const [typedArea, setTypedArea] = useState("");
  const [allowedAreas, setAllowedAreas] = useState<string[]>([]);
  const [loadingAreas, setLoadingAreas] = useState(false);
  const [areasError, setAreasError] = useState<string>("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [inputError, setInputError] = useState("");
  // Region chip data. Populated from /api/area-intelligence/regions on
  // every city change. Empty array while loading or on fetch failure —
  // the chip row is hidden in both cases (graceful degradation: the
  // cascade + input continue to work without chips).
  const [regions, setRegions] = useState<RegionOption[]>([]);
  // City-scoped last-used area for the leading "Last used: …" chip.
  // Empty when the user has never selected an area in the active city,
  // or when the stored value no longer matches the canonical catalogue
  // (e.g. admin removed the area).
  const [lastUsedArea, setLastUsedArea] = useState<string>("");
  // Collapsed/expanded toggle for the no-match fallback panel's region
  // list. Shared by both fallback variants (typing-time amber + Use-button
  // red) because at most one renders at a time per the suppression rule.
  const [regionsExpanded, setRegionsExpanded] = useState<boolean>(false);
  // Area Intelligence cache for the active city. `aiLabels` keeps insertion
  // order for the dropdown; `aiCanonicalByLabel` maps a clicked label back
  // to the canonical area string we should submit.
  const [aiLabels, setAiLabels] = useState<string[]>([]);
  const [aiCanonicalByLabel, setAiCanonicalByLabel] = useState<
    Map<string, string>
  >(new Map());
  const [detectStatus, setDetectStatus] = useState<DetectStatus>("idle");
  const [detectSuggestion, setDetectSuggestion] =
    useState<DetectSuggestion | null>(null);
  const [detectMessage, setDetectMessage] = useState("");
  // Original user input that differs (case/spelling) from the canonical
  // area finally selected. Shown beneath the "Selected area" chip.
  const [aliasInput, setAliasInput] = useState("");
  // "Search across all Jodhpur" toggle (only when allowAllJodhpur). When on,
  // the area picker is replaced by a single "All Jodhpur" chip.
  const [allCity, setAllCity] = useState(false);
  // Animated bold placeholder (typewriter overlay) for the area input.
  const [twText, setTwText] = useState("");
  const [twCaretOn, setTwCaretOn] = useState(true);
  const [isHydrated, setIsHydrated] = useState(false);
  const [areaInputFocused, setAreaInputFocused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const twTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const twCaretIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const twWordIdx = useRef(0);
  const twCharIdx = useRef(0);
  const twPhase = useRef<"typing" | "paused" | "deleting">("typing");

  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputShellRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const blurTimerRef = useRef<number | null>(null);

  // ── Cities-for-state options ───────────────────────────────────────────
  const cityOptions = useMemo(
    () => (selectedState ? citiesForState(selectedState) : []),
    [selectedState, citiesForState]
  );

  // ── Fetch /api/areas?city= when the active city changes ────────────────
  // Re-fetch on every city change. The previous "fetch only when the input
  // becomes visible" gate is gone — the input is always visible now and
  // the cascade can change the underlying catalogue at any moment.
  useEffect(() => {
    // No city yet → bail without clearing state. Initial state is [] and
    // selectedCityCode only goes empty → set during loading, so a stale
    // value can never be displayed.
    if (!selectedCityCode) return;
    const ctrl = new AbortController();
    // Legitimate effect-driven UI flags: the loading hint must show
    // for the duration of the in-flight fetch, and prior errors must
    // clear before the new request resolves. React 19's set-state-in-
    // effect rule flags these conservatively; the ref-guarded fetch
    // can't cascade — there's no second render path that re-enters
    // this effect synchronously.
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoadingAreas(true);
    setAreasError("");
    /* eslint-enable react-hooks/set-state-in-effect */
    fetch(`/api/areas?city=${encodeURIComponent(selectedCityCode)}`, {
      signal: ctrl.signal,
      // Bypass browser HTTP cache. Server-side cache is bounded by
      // CACHE_TTL_MS + invalidateAreasCacheByCity() on admin writes;
      // adding no-store here removes the only remaining staleness
      // layer (the browser's own cache) so admin edits are visible
      // on the next homepage fetch without a hard refresh.
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((data) => {
        const areas = Array.isArray(data?.areas)
          ? data.areas.filter(
              (value: unknown): value is string => typeof value === "string"
            )
          : [];
        setAllowedAreas(areas);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setAllowedAreas([]);
        setAreasError("Could not load areas for this city.");
      })
      .finally(() => setLoadingAreas(false));
    return () => ctrl.abort();
  }, [selectedCityCode]);

  // ── Fetch /api/area-intelligence/regions?city= for the chip row ────────
  // Independent of the /api/areas fetch above: regions carry the
  // grouping needed for the quick-select chips, whereas /api/areas is
  // the flat canonical catalogue used to gate AI suggestions. Fetching
  // both in parallel keeps the chip row available as soon as it can be.
  // Failures fall back to "no chips" — the rest of the picker still works.
  useEffect(() => {
    // Same bail-without-clear pattern as the areas fetch above.
    if (!selectedCityCode) return;
    const ctrl = new AbortController();
    fetch(
      `/api/area-intelligence/regions?city=${encodeURIComponent(
        selectedCityCode
      )}`,
      { signal: ctrl.signal, cache: "no-store" }
    )
      .then((res) => res.json())
      .then((data: { ok?: boolean; regions?: RegionOption[] }) => {
        if (ctrl.signal.aborted) return;
        if (!data?.ok || !Array.isArray(data.regions)) {
          setRegions([]);
          return;
        }
        // Drop regions with no active areas — a chip that opens an empty
        // dropdown is hostile UX. Phase 1.1 already filters by city +
        // active=true server-side, so this is a defensive client gate.
        setRegions(
          data.regions.filter(
            (r) =>
              r?.region_code &&
              r?.region_name &&
              Array.isArray(r.areas) &&
              r.areas.length > 0
          )
        );
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setRegions([]);
      });
    return () => ctrl.abort();
  }, [selectedCityCode]);

  // ── Read city-scoped last-used area on city change ────────────────────
  // Validates against allowedAreas at render time (see chip rendering
  // below) so a stale value from a since-removed canonical area silently
  // drops the chip instead of letting the user submit a string the
  // matching layer no longer recognises.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!selectedCityCode) return;
    try {
      const stored = window.localStorage.getItem(
        lastAreaKeyFor(selectedCityCode)
      );
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLastUsedArea(normalizeAreaValue(stored ?? ""));
    } catch {
      // localStorage disabled — no last-used memory, just hide the chip.
      setLastUsedArea("");
    }
  }, [selectedCityCode]);

  // Persist last-used on every successful selection, keyed to the city
  // the selection was made in. Called from every onSelect path inside
  // this component (typed-and-confirmed, AI suggest pick, region chip,
  // last-used chip). Empty selections (cascade reset) are skipped.
  const persistLastUsed = (area: string) => {
    if (!area || !selectedCityCode) return;
    setLastUsedArea(area);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(lastAreaKeyFor(selectedCityCode), area);
    } catch {
      // Quota / disabled — selection still succeeds; just no memory.
    }
  };

  // ── AI suggest — debounced, AbortController-guarded, city-scoped ──────
  // Fires only when allowedAreas is loaded (we use it as the safety gate)
  // AND the user has typed ≥ 2 chars. Region-type suggestions are dropped
  // because the submit pipeline has no concept of a region.
  useEffect(() => {
    if (!selectedCityCode) return;
    const q = typedArea.trim();
    // Below the trigger threshold → leave the cache as-is. The render path
    // already gates display on typedArea.length via filteredSuggestions, so
    // stale aiLabels are never shown to the user. Avoids a sync setState in
    // an effect body (react-hooks/set-state-in-effect).
    if (q.length < 2 || allowedAreas.length === 0) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      fetch(
        `/api/area-intelligence/suggest?query=${encodeURIComponent(
          q
        )}&city=${encodeURIComponent(selectedCityCode)}`,
        { signal: ctrl.signal, cache: "no-store" }
      )
        .then((res) => res.json())
        .then((data: { ok?: boolean; suggestions?: AiSuggestion[] }) => {
          if (ctrl.signal.aborted) return;
          if (!data?.ok || !Array.isArray(data.suggestions)) {
            setAiLabels([]);
            setAiCanonicalByLabel(new Map());
            return;
          }
          const allowedSet = new Set(
            allowedAreas.map((a) => a.trim().toLowerCase())
          );
          const labels: string[] = [];
          const map = new Map<string, string>();
          const seenLabels = new Set<string>();
          for (const s of data.suggestions) {
            if (s?.type === "region") continue;
            const label = String(s?.label ?? "").trim();
            if (!label) continue;
            const canonical =
              s?.type === "alias"
                ? String(s?.canonical_area ?? "").trim()
                : label;
            if (!canonical) continue;
            if (!allowedSet.has(canonical.toLowerCase())) continue;
            const labelKey = label.toLowerCase();
            if (seenLabels.has(labelKey)) continue;
            seenLabels.add(labelKey);
            labels.push(label);
            map.set(labelKey, canonical);
          }
          setAiLabels(labels);
          setAiCanonicalByLabel(map);
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === "AbortError") return;
          // Silent fallback — the client filter against allowedAreas takes
          // over via `filteredSuggestions` below.
          setAiLabels([]);
          setAiCanonicalByLabel(new Map());
        });
    }, AI_SUGGEST_DEBOUNCE_MS);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [selectedCityCode, typedArea, allowedAreas]);

  // ── Click-outside closes the dropdown ──────────────────────────────────
  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        inputShellRef.current &&
        !inputShellRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // ── Animated placeholder: hydration + reduced-motion detection ─────────
  useEffect(() => {
    // Client-only flags; the change-listener callback below is event-driven.
    /* eslint-disable react-hooks/set-state-in-effect */
    setIsHydrated(true);
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    /* eslint-enable react-hooks/set-state-in-effect */
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  // ── Animated placeholder: typewriter loop ──────────────────────────────
  // Runs ONLY when the input is idle (hydrated, not focused, empty, a city is
  // selected) and the user has not requested reduced motion. It writes to a
  // separate `twText` overlay state — never to `typedArea` — so it cannot
  // interfere with typing, suggestions, or any other control.
  useEffect(() => {
    const shouldAnimate =
      isHydrated &&
      !reducedMotion &&
      !areaInputFocused &&
      typedArea.trim() === "" &&
      Boolean(selectedCityCode);

    const stopAll = () => {
      if (twTimerRef.current) {
        clearTimeout(twTimerRef.current);
        twTimerRef.current = null;
      }
      if (twCaretIntervalRef.current) {
        clearInterval(twCaretIntervalRef.current);
        twCaretIntervalRef.current = null;
      }
    };

    if (!shouldAnimate) {
      stopAll();
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setTwText("");
      setTwCaretOn(true);
      return;
    }

    twCharIdx.current = 0;
    twPhase.current = "typing";
    setTwText("");
    twCaretIntervalRef.current = setInterval(
      () => setTwCaretOn((v) => !v),
      530
    );

    function tick() {
      const word = AREA_TW_HINTS[twWordIdx.current % AREA_TW_HINTS.length];
      if (twPhase.current === "typing") {
        if (twCharIdx.current < word.length) {
          twCharIdx.current += 1;
          setTwText(word.slice(0, twCharIdx.current));
          twTimerRef.current = setTimeout(tick, AREA_TW_TYPE_MS);
        } else {
          twPhase.current = "paused";
          twTimerRef.current = setTimeout(tick, AREA_TW_PAUSE_COMPLETE_MS);
        }
      } else if (twPhase.current === "paused") {
        twPhase.current = "deleting";
        twTimerRef.current = setTimeout(tick, 0);
      } else {
        if (twCharIdx.current > 0) {
          twCharIdx.current -= 1;
          setTwText(word.slice(0, twCharIdx.current));
          twTimerRef.current = setTimeout(tick, AREA_TW_DELETE_MS);
        } else {
          twWordIdx.current = (twWordIdx.current + 1) % AREA_TW_HINTS.length;
          twPhase.current = "typing";
          twTimerRef.current = setTimeout(tick, AREA_TW_PAUSE_BETWEEN_MS);
        }
      }
    }

    twTimerRef.current = setTimeout(tick, AREA_TW_PAUSE_BETWEEN_MS);
    return stopAll;
  }, [isHydrated, reducedMotion, areaInputFocused, typedArea, selectedCityCode]);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current !== null) {
        window.clearTimeout(blurTimerRef.current);
      }
    };
  }, []);

  // ── Cascade reset: when city changes, drop the typed/selected area ─────
  // Avoids the "Sardarpura selected, then switched to Jaipur, submit still
  // sends Sardarpura" foot-gun. Empty string round-trips through onSelect
  // so the parent page's `selectedArea` state clears too.
  // Cascade reset on real city changes. This IS a legitimate effect-driven
  // state reset (the alternative — remounting via key — would lose
  // unrelated UI state like focus and the input shell's blur timer). The
  // ref-guard ensures we only fire on actual transitions, not on first
  // mount, so cascading-render risk is bounded.
  const prevCityRef = useRef<string>(selectedCityCode);
  useEffect(() => {
    if (prevCityRef.current && prevCityRef.current !== selectedCityCode) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setTypedArea("");
      setAliasInput("");
      setInputError("");
      setShowSuggestions(false);
      setAiLabels([]);
      setAiCanonicalByLabel(new Map());
      setDetectStatus("idle");
      setDetectSuggestion(null);
      setDetectMessage("");
      setRegionsExpanded(false);
      if (selectedArea) onSelect("");
      /* eslint-enable react-hooks/set-state-in-effect */
    }
    prevCityRef.current = selectedCityCode;
  }, [selectedCityCode, selectedArea, onSelect]);

  // ── Suggestion list (the actual rows the dropdown renders) ─────────────
  const filteredSuggestions = useMemo(() => {
    const pool = allowedAreas;
    const trimmed = typedArea.trim();
    const q = normalizeAreaValue(trimmed).toLowerCase();

    // Default threshold for normal typing
    if (q.length < 2) return [];

    // Never surface the bare city name (e.g. "Jodhpur") or any city-level
    // phrase as a normal area — those route to "Search across all Jodhpur".
    const notCityLevel = (label: string) =>
      !isCityLevelTerm(label, selectedCityName);

    // Prefer AI suggestions when present (they handle alias → canonical
    // mapping inside the city's catalogue). Fall back to client-side
    // substring filtering of `allowedAreas` when AI is empty / loading.
    if (aiLabels.length > 0) {
      return aiLabels.filter(notCityLevel).slice(0, MAX_SUGGESTIONS);
    }

    return pool
      .filter((area) =>
        normalizeAreaValue(area).toLowerCase().includes(q)
      )
      .filter(notCityLevel)
      .slice(0, MAX_SUGGESTIONS);
  }, [typedArea, allowedAreas, aiLabels, selectedCityName]);

  // City-level intent: the user typed the city name or an "all/whole/full
  // jodhpur" phrase. Only request-flow (allowAllJodhpur) offers the all-city
  // option; elsewhere the bare city is simply suppressed from suggestions.
  const cityLevelIntent = useMemo(() => {
    const q = normalizeAreaValue(typedArea).toLowerCase();
    return q.length >= 2 && isCityLevelTerm(q, selectedCityName);
  }, [typedArea, selectedCityName]);
  const showAllJodhpurOption = allowAllJodhpur && cityLevelIntent;

  const renderDropdown =
    showSuggestions && (filteredSuggestions.length > 0 || showAllJodhpurOption);
  const noMatchesFound =
    showSuggestions &&
    typedArea.trim().length >= 2 &&
    filteredSuggestions.length === 0 &&
    !showAllJodhpurOption &&
    !loadingAreas;

  useEffect(() => {
    if (!renderDropdown) return;
    const id = requestAnimationFrame(() => {
      dropdownRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(id);
  }, [renderDropdown]);

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleInputChange = (value: string) => {
    if (blurTimerRef.current !== null) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    setTypedArea(value);
    if (inputError) setInputError("");
    setShowSuggestions(true);
  };

  const handleInputFocus = () => {
    if (blurTimerRef.current !== null) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    setAreaInputFocused(true);
    setShowSuggestions(true);
  };

  const handleInputBlur = () => {
    setAreaInputFocused(false);
    if (blurTimerRef.current !== null) {
      window.clearTimeout(blurTimerRef.current);
    }
    blurTimerRef.current = window.setTimeout(() => {
      setShowSuggestions(false);
      blurTimerRef.current = null;
    }, 250);
  };

  const handleUseTypedArea = () => {
    const normalized = normalizeAreaValue(typedArea);
    if (!normalized) {
      setInputError("Area required");
      return;
    }
    // City-level input ("Jodhpur", "all jodhpur", …) never resolves to a real
    // area. Route it to all-city search where available; otherwise ask for a
    // specific area instead of submitting the bare city as a region.
    if (isCityLevelTerm(normalized, selectedCityName)) {
      if (allowAllJodhpur) {
        handleToggleAllCity(true);
      } else {
        setInputError(
          `Please pick a specific area in ${selectedCityName || "the selected city"}.`
        );
        setShowSuggestions(true);
      }
      return;
    }
    const matchedKnownArea = allowedAreas.find(
      (area) => area.toLowerCase() === normalized.toLowerCase()
    );
    if (!matchedKnownArea) {
      setInputError(
        `We don't serve this exact area in ${selectedCityName || "the selected city"} yet. Please pick from the list.`
      );
      setShowSuggestions(true);
      return;
    }
    const typedTrimmed = typedArea.trim().replace(/\s+/g, " ");
    setAliasInput(
      typedTrimmed && typedTrimmed.toLowerCase() !== matchedKnownArea.toLowerCase()
        ? typedTrimmed
        : ""
    );
    setTypedArea("");
    setShowSuggestions(false);
    setInputError("");
    persistLastUsed(matchedKnownArea);
    onSelect(matchedKnownArea);
  };

  // ── Region chip click ──────────────────────────────────────────────────
  // Region selection is terminal. Clicking any region chip — popular row
  // or fallback panel — finalises the selection on the region name itself,
  // regardless of whether the region has one, many, or zero canonical
  // areas inside it. No more "fill input + open suggestions" friction.
  //
  // The matching layer later resolves whether the persisted string is a
  // region or a canonical area; the onSelect(area: string) contract stays
  // string-based, so parent pages (page.tsx, request-flow/page.tsx) need
  // no changes.
  const handleRegionChipClick = (region: RegionOption) => {
    const regionName = normalizeAreaValue(region.region_name);
    if (!regionName) return;
    if (blurTimerRef.current !== null) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    setTypedArea("");
    setShowSuggestions(false);
    setInputError("");
    setAliasInput("");
    setAiLabels([]);
    setAiCanonicalByLabel(new Map());
    inputRef.current?.blur();
    persistLastUsed(regionName);
    onSelect(regionName);
  };

  const handleSuggestionSelect = (clickedLabel: string) => {
    // Defensive: city-level labels are filtered out of the suggestion list,
    // but if one is ever clicked, route it to all-city search.
    if (isCityLevelTerm(clickedLabel, selectedCityName)) {
      if (allowAllJodhpur) handleToggleAllCity(true);
      return;
    }
    const labelKey = clickedLabel.trim().toLowerCase();
    const aiCanonical = aiCanonicalByLabel.get(labelKey);
    const submitString = aiCanonical || clickedLabel;
    const normalized = normalizeAreaValue(submitString);
    if (!normalized) return;
    if (blurTimerRef.current !== null) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    setTypedArea("");
    setShowSuggestions(false);
    setInputError("");
    if (
      aiCanonical &&
      clickedLabel.trim().toLowerCase() !== aiCanonical.trim().toLowerCase()
    ) {
      setAliasInput(clickedLabel.trim());
    } else {
      setAliasInput("");
    }
    inputRef.current?.blur();
    persistLastUsed(normalized);
    onSelect(normalized);
  };

  const handleDetectArea = () => {
    if (!selectedCityCode) return;
    if (
      typeof window === "undefined" ||
      !("geolocation" in navigator) ||
      !navigator.geolocation
    ) {
      setDetectStatus("unsupported");
      setDetectSuggestion(null);
      setDetectMessage("Location detection is not available on this device.");
      return;
    }

    setDetectStatus("pending");
    setDetectSuggestion(null);
    setDetectMessage("");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const res = await fetch("/api/area-intelligence/detect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            body: JSON.stringify({
              cityCode: selectedCityCode,
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            }),
          });
          const data = (await res.json().catch(() => null)) as
            | {
                ok?: boolean;
                detectedArea?: unknown;
                regionCode?: unknown;
                regionName?: unknown;
                cityCode?: unknown;
                message?: unknown;
              }
            | null;

          if (!res.ok || !data?.ok) {
            setDetectStatus("no_match");
            setDetectSuggestion(null);
            setDetectMessage(
              typeof data?.message === "string"
                ? data.message
                : "We could not confidently detect your area. Please type manually."
            );
            return;
          }

          const responseCity = String(data.cityCode ?? selectedCityCode)
            .trim()
            .toUpperCase();
          if (responseCity && responseCity !== selectedCityCode) {
            setDetectStatus("city_mismatch");
            setDetectSuggestion(null);
            setDetectMessage(
              "Detected location seems outside the selected city. Please type your area manually."
            );
            return;
          }

          const detectedArea = normalizeAreaValue(String(data.detectedArea ?? ""));
          const regionName = normalizeAreaValue(String(data.regionName ?? ""));
          const regionCode = String(data.regionCode ?? "").trim();
          const selectable =
            detectedArea ||
            (regions.some(
              (region) =>
                region.region_name.toLowerCase() === regionName.toLowerCase()
            )
              ? regionName
              : "");

          if (!selectable || !regionCode) {
            setDetectStatus("no_match");
            setDetectSuggestion(null);
            setDetectMessage(
              "We could not confidently detect your area. Please type manually."
            );
            return;
          }

          setDetectStatus("success");
          setDetectSuggestion({
            detectedArea: selectable,
            regionCode,
            regionName,
            message:
              typeof data.message === "string" && data.message.trim()
                ? data.message.trim()
                : `You seem near ${selectable}`,
          });
          setDetectMessage("");
        } catch {
          setDetectStatus("no_match");
          setDetectSuggestion(null);
          setDetectMessage(
            "We could not confidently detect your area. Please type manually."
          );
        }
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setDetectStatus("permission_denied");
          setDetectMessage(
            "Location permission was denied. Please type your area manually."
          );
        } else {
          setDetectStatus("no_match");
          setDetectMessage(
            "We could not confidently detect your area. Please type manually."
          );
        }
        setDetectSuggestion(null);
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 }
    );
  };

  const handleUseDetectedArea = () => {
    if (!detectSuggestion) return;
    const detectedArea = normalizeAreaValue(detectSuggestion.detectedArea);
    if (!detectedArea) return;
    setTypedArea("");
    setShowSuggestions(false);
    setInputError("");
    setAliasInput("");
    inputRef.current?.blur();
    persistLastUsed(detectedArea);
    onSelect(detectedArea);
  };

  // ── All-Jodhpur toggle ──────────────────────────────────────────────────
  const handleToggleAllCity = (next: boolean) => {
    setAllCity(next);
    if (next) {
      // Clear any in-progress typing so re-opening the picker starts fresh.
      setTypedArea("");
      setShowSuggestions(false);
      setInputError("");
      onScopeChange?.("all_jodhpur");
      onSelect("All Jodhpur");
    } else {
      onScopeChange?.("region");
      onSelect("");
    }
  };

  // Highlighted "Search across all Jodhpur" tile, surfaced near the popular
  // region chips so the user never has to type "jodhpur" to discover it.
  const renderAllJodhpurTile = () => (
    <button
      type="button"
      onClick={() => handleToggleAllCity(true)}
      data-testid="all-jodhpur-tile"
      className="mt-3 flex w-full items-center justify-between gap-3 rounded-xl border-2 border-[#1B5E20] bg-[#1B5E20]/10 px-3 py-2.5 text-left transition hover:bg-[#1B5E20]/15 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
    >
      <span className="flex flex-col">
        <span className="text-sm font-bold text-[#1B5E20]">
          Search across all Jodhpur
        </span>
        <span className="text-[11px] text-[#1B5E20]/80">
          Show providers who cover the whole city
        </span>
      </span>
      <span className="shrink-0 rounded-full bg-[#1B5E20] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
        City-wide
      </span>
    </button>
  );

  // When all-city is selected, replace the entire area picker with a single
  // confirmation chip + an escape hatch back to specific-area selection.
  if (allowAllJodhpur && allCity) {
    return (
      <div className="w-full">
        <div
          className="flex flex-col gap-1 rounded-2xl border border-[#1B5E20] bg-[#1B5E20]/10 px-3 py-2.5"
          data-testid="all-jodhpur-chip"
          aria-live="polite"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[#1B5E20]/80">
            Selected area/region
          </span>
          <span className="text-sm font-bold text-[#1B5E20] sm:text-base">
            All Jodhpur
          </span>
          <span className="text-xs text-[#1B5E20]/80">
            We&rsquo;ll show providers who cover all of Jodhpur.
          </span>
        </div>
        <button
          type="button"
          onClick={() => handleToggleAllCity(false)}
          data-testid="all-jodhpur-clear"
          className="mt-2 text-xs font-semibold text-[#1B5E20] underline underline-offset-2 hover:text-[#0f3d15]"
        >
          Choose a specific area instead
        </button>
        {errorMessage ? (
          <p className="mt-2 text-xs text-red-600">{errorMessage}</p>
        ) : null}
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────
  const selectClass =
    "rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60";
  const detectMessageClass =
    detectStatus === "permission_denied" || detectStatus === "city_mismatch"
      ? "mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800"
      : "mt-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-medium text-red-700";

  return (
    <div className="w-full">
      {showQuestionLabel ? (
        <p className="mb-2 text-sm font-semibold text-[#111827]">
          Where do you need it?
        </p>
      ) : null}

      {/* State + City cascade */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="geo-state">
          State
        </label>
        <select
          id="geo-state"
          value={selectedState}
          onChange={(e) => setState(e.target.value)}
          disabled={geoLoading || states.length === 0}
          className={selectClass}
        >
          {geoLoading || states.length === 0 ? (
            <option value="">Loading…</option>
          ) : (
            states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))
          )}
        </select>

        <label className="sr-only" htmlFor="geo-city">
          City
        </label>
        <select
          id="geo-city"
          value={selectedCityCode}
          onChange={(e) => setCityCode(e.target.value)}
          disabled={geoLoading || cityOptions.length === 0}
          className={selectClass}
        >
          {geoLoading || cityOptions.length === 0 ? (
            <option value="">Loading…</option>
          ) : (
            cityOptions.map((c) => (
              <option key={c.city_code} value={c.city_code}>
                {c.city_name}
              </option>
            ))
          )}
        </select>

        <button
          type="button"
          onClick={handleDetectArea}
          disabled={
            geoLoading || !selectedCityCode || detectStatus === "pending"
          }
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#1B5E20] bg-white px-3 py-2 text-sm font-semibold text-[#1B5E20] transition hover:bg-[#1B5E20]/10 focus:border-[#1B5E20] focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/25 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          data-testid="detect-my-area"
        >
          <LocateFixed className="h-4 w-4" aria-hidden="true" />
          {detectStatus === "pending" ? "Detecting..." : "Detect my area"}
        </button>
      </div>

      {!geoLoading && cities.length === 0 ? (
        <p className="mt-2 text-xs text-red-600">
          Could not load locations. Please retry.
        </p>
      ) : null}

      {detectStatus === "success" && detectSuggestion ? (
        <div
          className="mt-3 rounded-lg border border-[#1B5E20]/25 bg-[#1B5E20]/10 p-3"
          data-testid="detect-area-suggestion"
          aria-live="polite"
        >
          <p className="text-sm font-semibold text-[#1B5E20]">
            {detectSuggestion.message} / {detectSuggestion.regionCode}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleUseDetectedArea}
              className="rounded-lg border border-[#1B5E20] bg-[#1B5E20] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#174f1b] focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/25"
            >
              Use this area
            </button>
            <button
              type="button"
              onClick={handleDetectArea}
              className="rounded-lg border border-[#F59E0B]/40 bg-white px-3 py-2 text-sm font-semibold text-[#92400E] transition hover:bg-[#F59E0B]/10 focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/25"
            >
              Try again
            </button>
          </div>
        </div>
      ) : null}

      {detectStatus !== "idle" &&
      detectStatus !== "pending" &&
      detectStatus !== "success" &&
      detectMessage ? (
        <p
          className={detectMessageClass}
          data-testid="detect-area-message"
          aria-live="polite"
        >
          {detectMessage}
        </p>
      ) : null}

      {/* All-Jodhpur tile — always visible (request-flow only) so the
          city-wide option is a first-class choice next to popular regions,
          not something the user must type "jodhpur" to discover. */}
      {allowAllJodhpur ? renderAllJodhpurTile() : null}

      {/* Quick-select chip row — capped at 3 entries:
          1. "Last used: X" (city-scoped; rendered only when the stored
             value still resolves to a canonical area in the current
             city's catalogue).
          2-3. Two popular regions from /api/area-intelligence/regions.
          The row is hidden entirely while regions are still loading AND
          no last-used chip is available, so the "Popular regions"
          caption never sits over an empty row. */}
      {(() => {
        // Last-used is valid if it still matches EITHER an active
        // canonical area OR an active region in the current city's
        // catalogue. Region-chip selections persist the region name; the
        // region branch keeps those chips alive across reloads.
        const lastUsedValid =
          lastUsedArea &&
          (allowedAreas.some(
            (a) => a.toLowerCase() === lastUsedArea.toLowerCase()
          ) ||
            regions.some(
              (r) => r.region_name.toLowerCase() === lastUsedArea.toLowerCase()
            ))
            ? lastUsedArea
            : "";
        const popularChips = regions.slice(0, MAX_POPULAR_REGION_CHIPS);
        if (!lastUsedValid && popularChips.length === 0) return null;
        return (
          <div className="mt-3">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Popular regions
            </p>
            <div className="flex flex-wrap gap-1.5">
              {lastUsedValid ? (
                <button
                  type="button"
                  onClick={() => {
                    setTypedArea("");
                    setShowSuggestions(false);
                    setInputError("");
                    setAliasInput("");
                    inputRef.current?.blur();
                    persistLastUsed(lastUsedValid);
                    onSelect(lastUsedValid);
                  }}
                  className="rounded-full border border-[#1B5E20] bg-[#1B5E20]/10 px-3 py-1.5 text-xs font-semibold text-[#1B5E20] transition hover:bg-[#1B5E20]/20 whitespace-nowrap"
                >
                  {`Last used: ${lastUsedValid}`}
                </button>
              ) : null}
              {popularChips.map((region) => (
                <button
                  key={region.region_code}
                  type="button"
                  onClick={() => handleRegionChipClick(region)}
                  className="rounded-full border border-[#1B5E20] bg-white px-3 py-1.5 text-xs font-semibold text-[#1B5E20] transition hover:bg-[#1B5E20]/10 whitespace-nowrap"
                >
                  {region.region_name}
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Always-visible area input */}
      <div
        ref={inputShellRef}
        className="relative mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
      >
        {(() => {
          // Show the animated overlay only when the input is idle + empty and
          // the typewriter has text. Otherwise the (bold) native placeholder
          // shows — including the reduced-motion fallback.
          const showTwOverlay =
            isHydrated &&
            !areaInputFocused &&
            typedArea.trim() === "" &&
            twText !== "";
          return (
            <div className="relative w-full sm:flex-1 sm:min-w-[220px]">
              <input
                ref={inputRef}
                type="text"
                value={typedArea}
                onChange={(e) => handleInputChange(e.target.value)}
                onFocus={handleInputFocus}
                onBlur={handleInputBlur}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleUseTypedArea();
                  }
                  if (event.key === "Escape") {
                    setShowSuggestions(false);
                  }
                }}
                placeholder={showTwOverlay ? "" : "Type your area..."}
                disabled={geoLoading || !selectedCityCode}
                data-testid="area-input"
                className="w-full rounded-lg border border-emerald-200 px-3 py-2 text-sm text-slate-800 placeholder:font-bold placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
              />
              {showTwOverlay ? (
                <div
                  aria-hidden="true"
                  data-testid="area-input-typewriter"
                  className="pointer-events-none absolute inset-0 flex items-center px-3"
                >
                  <span className="text-sm font-bold text-slate-600">
                    {twText}
                    <span
                      className="ml-px"
                      style={{
                        opacity: twCaretOn ? 1 : 0,
                        transition: "opacity 50ms",
                      }}
                    >
                      |
                    </span>
                  </span>
                </div>
              ) : null}
            </div>
          );
        })()}
        <button
          type="button"
          onClick={handleUseTypedArea}
          disabled={!normalizeAreaValue(typedArea) || !selectedCityCode}
          className="w-full rounded-lg border border-[#1B5E20] px-3 py-2 text-sm font-semibold text-[#1B5E20] transition hover:bg-[#1B5E20]/10 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          Use this area
        </button>

        {loadingAreas ? (
          <p className="w-full text-xs text-slate-500">Loading suggestions...</p>
        ) : null}
        {!loadingAreas && areasError ? (
          <p className="w-full text-xs text-red-600">{areasError}</p>
        ) : null}

        {renderDropdown ? (
          <div
            ref={dropdownRef}
            className="absolute left-0 right-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg"
          >
            {showAllJodhpurOption ? (
              <button
                type="button"
                data-testid="all-jodhpur-suggestion"
                onMouseDown={(event) => {
                  event.preventDefault();
                  handleToggleAllCity(true);
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  handleToggleAllCity(true);
                }}
                className="block w-full border-b border-slate-100 bg-[#1B5E20]/5 px-3 py-2.5 text-left text-sm font-semibold text-[#1B5E20] transition hover:bg-[#1B5E20]/10"
              >
                Search across all Jodhpur
              </button>
            ) : null}
            {filteredSuggestions.map((area) => (
              <button
                key={area}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  handleSuggestionSelect(area);
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  handleSuggestionSelect(area);
                }}
                className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50 last:border-b-0"
              >
                {area}
              </button>
            ))}
          </div>
        ) : null}

        {noMatchesFound && !inputError ? (
          <div className="w-full rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="mb-2 text-xs font-semibold text-amber-900">
              No exact area found. Choose your nearest region:
            </p>
            {regions.length > 0 ? (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {(regionsExpanded
                    ? regions
                    : regions.slice(0, REGIONS_COLLAPSED_COUNT)
                  ).map((region) => (
                    <button
                      key={region.region_code}
                      type="button"
                      onMouseDown={(event) => {
                        // Prevent the input's blur-close from firing before
                        // the chip click registers (mirrors the suggestion
                        // dropdown's mouseDown handler).
                        event.preventDefault();
                        handleRegionChipClick(region);
                      }}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        handleRegionChipClick(region);
                      }}
                      className="rounded-full border border-[#1B5E20] bg-white px-3 py-1.5 text-xs font-semibold text-[#1B5E20] transition hover:bg-[#1B5E20]/10 whitespace-nowrap"
                    >
                      {region.region_name}
                    </button>
                  ))}
                </div>
                {regions.length > REGIONS_COLLAPSED_COUNT ? (
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      // mouseDown + preventDefault so the input's blur
                      // doesn't close the parent panel before the toggle
                      // registers (the panel depends on showSuggestions
                      // which the blur timer clears).
                      event.preventDefault();
                      setRegionsExpanded((v) => !v);
                    }}
                    className="mt-2 inline-block text-[11px] font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-900"
                  >
                    {regionsExpanded
                      ? "Show fewer regions"
                      : "Show more regions"}
                  </button>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-amber-800">
                No regions available for the selected city.
              </p>
            )}
          </div>
        ) : null}

        {inputError ? (
          <div className="w-full rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="mb-2 text-xs font-semibold text-red-700">
              {inputError}
            </p>
            {regions.length > 0 ? (
              <>
                <p className="mb-1.5 text-[11px] text-red-700">
                  Choose your nearest region:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(regionsExpanded
                    ? regions
                    : regions.slice(0, REGIONS_COLLAPSED_COUNT)
                  ).map((region) => (
                    <button
                      key={region.region_code}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        handleRegionChipClick(region);
                      }}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        handleRegionChipClick(region);
                      }}
                      className="rounded-full border border-[#1B5E20] bg-white px-3 py-1.5 text-xs font-semibold text-[#1B5E20] transition hover:bg-[#1B5E20]/10 whitespace-nowrap"
                    >
                      {region.region_name}
                    </button>
                  ))}
                </div>
                {regions.length > REGIONS_COLLAPSED_COUNT ? (
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      setRegionsExpanded((v) => !v);
                    }}
                    className="mt-2 inline-block text-[11px] font-semibold text-red-700 underline underline-offset-2 hover:text-red-800"
                  >
                    {regionsExpanded
                      ? "Show fewer regions"
                      : "Show more regions"}
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
        {!inputError && renderDropdown ? (
          <p className="w-full text-xs text-slate-500">
            Try selecting: {filteredSuggestions.slice(0, 3).join(", ")}
          </p>
        ) : null}
      </div>

      {/* Selection confirmation — visible whenever an area is chosen */}
      {selectedArea ? (
        <div
          className="mt-3 flex flex-col gap-1 rounded-2xl border border-[#1B5E20] bg-[#1B5E20]/10 px-3 py-2 sm:flex-row sm:items-center sm:gap-2"
          aria-live="polite"
        >
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-[#1B5E20]/80 sm:text-xs">
            Selected area/region
          </span>
          <span className="min-w-0 truncate text-sm font-bold text-[#1B5E20] sm:text-base">
            {selectedArea}
          </span>
          {aliasInput &&
          aliasInput.toLowerCase() !== selectedArea.toLowerCase() ? (
            <span className="min-w-0 truncate text-[11px] text-[#1B5E20]/80 sm:ml-auto sm:text-xs">
              Matched from &ldquo;{aliasInput}&rdquo;
            </span>
          ) : null}
        </div>
      ) : null}

      {errorMessage ? (
        <p className="mt-2 text-xs text-red-600">{errorMessage}</p>
      ) : null}
    </div>
  );
}
