"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type AreaSelectionProps = {
  selectedArea: string;
  onSelect: (area: string) => void;
  errorMessage?: string;
  showQuestionLabel?: boolean;
};

const POPULAR_1 = "Shastri Nagar";
const POPULAR_2 = "Sardarpura";
const LAST_AREA_KEY = "kk_last_area";
const MAX_SUGGESTIONS = 8;
const FALLBACK_AREAS = [
  "Shastri Nagar",
  "Sardarpura",
  "Pratap Nagar",
  "Pratap Nagar Jodhpur",
  "Kamla Nehru Nagar",
  "Choupasni Housing Board",
  "Ratanada",
  "Paota",
];

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

const isSameArea = (a: string, b: string) =>
  normalizeAreaValue(a).toLowerCase() === normalizeAreaValue(b).toLowerCase();

// Phase 1 Area Intelligence integration — see /api/area-intelligence/suggest.
// Critical contract: the value handed to `onSelect` (and therefore the
// submit payload) MUST be a canonical area present in `/api/areas`. The
// suggest endpoint may return labels that are aliases (e.g. "HC Road"),
// or canonicals that don't exist in the live `/api/areas` master list
// (e.g. placeholder seed data). Both classes are filtered/remapped here
// before they ever reach onSelect.
const AI_SUGGEST_DEBOUNCE_MS = 150;

type AiSuggestion = {
  type?: string;
  label?: string;
  canonical_area?: string | null;
  region_code?: string;
  region_name?: string;
};

export default function AreaSelection({
  selectedArea,
  onSelect,
  errorMessage,
  showQuestionLabel = true,
}: AreaSelectionProps) {
  const [lastUsedArea, setLastUsedArea] = useState("");
  const [showAreaInput, setShowAreaInput] = useState(false);
  const [typedArea, setTypedArea] = useState("");
  const [allowedAreas, setAllowedAreas] = useState<string[]>([]);
  const [loadingAreas, setLoadingAreas] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showAllMode, setShowAllMode] = useState(false);
  const [inputError, setInputError] = useState("");
  // Area Intelligence cache. `aiLabels` keeps insertion order for the
  // dropdown; `aiCanonicalByLabel` is the lookup that maps a clicked
  // label back to the canonical area string we should submit.
  // Empty array = "no AI suggestions available, fall through to the
  // existing client-side filter against allowedAreas".
  const [aiLabels, setAiLabels] = useState<string[]>([]);
  const [aiCanonicalByLabel, setAiCanonicalByLabel] = useState<
    Map<string, string>
  >(new Map());
  // Original user input that differs (case/spelling) from the canonical
  // area finally selected. Shown beneath the "Selected area" chip so the
  // user sees the canonical their request will use. Cleared on every
  // direct (chip / suggestion) selection.
  const [aliasInput, setAliasInput] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputShellRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const blurTimerRef = useRef<number | null>(null);

  // Compact chip sizing — matches the Step 2 timing-tile polish on the
  // homepage so both step blocks share a visual rhythm. Padding +
  // font dropped from px-4 py-2 text-sm to px-3 py-1.5 text-xs; the
  // border + selected/idle palette is unchanged so the selected-state
  // meaning is preserved.
  const chipClass = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-xs font-semibold transition border whitespace-nowrap ${
      active
        ? "bg-[#1B5E20] text-white border-[#1B5E20] shadow-sm"
        : "border-[#1B5E20] text-[#1B5E20] bg-white hover:bg-[#1B5E20]/10"
    }`;

  const typedChipActive = useMemo(() => {
    if (!selectedArea) return false;
    if (lastUsedArea && isSameArea(selectedArea, lastUsedArea)) return false;
    if (isSameArea(selectedArea, POPULAR_1)) return false;
    if (isSameArea(selectedArea, POPULAR_2)) return false;
    return true;
  }, [lastUsedArea, selectedArea]);

  const filteredSuggestions = useMemo(() => {
    const pool = allowedAreas.length > 0 ? allowedAreas : FALLBACK_AREAS;
    const trimmed = typedArea.trim();
    const q = normalizeAreaValue(trimmed).toLowerCase();

    // Show-All returns the FULL canonical list (no MAX_SUGGESTIONS slice)
    // so the user can scroll through every area /api/areas serves.
    // Ordering is whatever `/api/areas` returned. The dropdown's
    // max-height + overflow keeps it usable on small viewports.
    // Bypasses the AI path — Show All is an intentional "browse the full
    // master list" affordance, not a fuzzy-search request.
    if (showAllMode) {
      return pool;
    }

    // Default threshold for normal typing
    if (q.length < 2) return [];

    // Area Intelligence path: when the AI returned at least one
    // safety-gated suggestion, surface those instead of the client
    // filter. Empty AI result falls through to the client filter so
    // existing canonical-only matches still appear during loading or
    // when the AI table is incomplete.
    if (aiLabels.length > 0) {
      return aiLabels.slice(0, MAX_SUGGESTIONS);
    }

    return pool
      .filter((area) =>
        normalizeAreaValue(area).toLowerCase().includes(q)
      )
      .slice(0, MAX_SUGGESTIONS);
  }, [typedArea, allowedAreas, showAllMode, aiLabels]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const area = window.localStorage.getItem(LAST_AREA_KEY) || "";
    setLastUsedArea(normalizeAreaValue(area));
  }, []);

  useEffect(() => {
    if (!showAreaInput || !inputRef.current) return;
    inputRef.current.focus();
  }, [showAreaInput]);

  useEffect(() => {
    if (!showAreaInput || allowedAreas.length > 0) return;
    const controller = new AbortController();
    setLoadingAreas(true);
    fetch(`/api/areas`, { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        const areas = Array.isArray(data?.areas)
          ? data.areas.filter(
              (value: unknown): value is string => typeof value === "string"
            )
          : [];
        setAllowedAreas(areas);
      })
      .catch(() => setAllowedAreas([]))
      .finally(() => setLoadingAreas(false));
    return () => controller.abort();
  }, [showAreaInput, allowedAreas.length]);

  // Area Intelligence suggestions — debounced, AbortController-guarded.
  // Only fires when:
  //   - the area input is visible
  //   - the user has typed ≥ 2 chars
  //   - the /api/areas master list is loaded (we need it as the safety
  //     gate; without it we can't tell which AI suggestions are safe).
  // A suggestion is kept only if its resolved canonical (alias → its
  // canonical_area; canonical → its own label) appears in allowedAreas
  // case-insensitively. Region suggestions are dropped entirely; the
  // submit pipeline has no concept of a region today.
  useEffect(() => {
    if (!showAreaInput) return;
    const q = typedArea.trim();
    if (q.length < 2 || allowedAreas.length === 0) {
      setAiLabels([]);
      setAiCanonicalByLabel(new Map());
      return;
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      fetch(
        `/api/area-intelligence/suggest?query=${encodeURIComponent(q)}`,
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
            // Safety gate: never surface a label that would submit a
            // string the live matching layer (provider_areas) can't see.
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
          // Silent fallback — the client filter against allowedAreas will
          // take over via `filteredSuggestions` below.
          setAiLabels([]);
          setAiCanonicalByLabel(new Map());
        });
    }, AI_SUGGEST_DEBOUNCE_MS);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [showAreaInput, typedArea, allowedAreas]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        inputShellRef.current &&
        !inputShellRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
        setShowAllMode(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current !== null) {
        window.clearTimeout(blurTimerRef.current);
      }
    };
  }, []);

  const storeSelection = (area: string) => {
    const normalized = normalizeAreaValue(area);
    if (!normalized) return;
    setShowSuggestions(false);
    setShowAllMode(false);
    setInputError("");
    setAliasInput("");
    onSelect(normalized);
  };

  const handleTypeAreaClick = () => {
    setShowAreaInput(true);
    setInputError("");
    setShowAllMode(false);
    setShowSuggestions(true);
    if (typedChipActive && !typedArea.trim()) {
      setTypedArea(selectedArea);
    }
  };

  const handleInputChange = (value: string) => {
    if (blurTimerRef.current !== null) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    setTypedArea(value);
    // Only turn off showAllMode once we start actually filtering (length >= 2)
    if (value.trim().length >= 2) {
      setShowAllMode(false);
    }
    if (inputError) setInputError("");
    // Immediately trigger visibility logic
    setShowSuggestions(true);
  };

  const handleInputFocus = () => {
    if (blurTimerRef.current !== null) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    setShowSuggestions(true);
  };

  const handleInputBlur = () => {
    if (blurTimerRef.current !== null) {
      window.clearTimeout(blurTimerRef.current);
    }
    // Delay close to allow suggestion selection to fire first
    blurTimerRef.current = window.setTimeout(() => {
      setShowSuggestions(false);
      setShowAllMode(false);
      blurTimerRef.current = null;
    }, 250);
  };

  const handleUseTypedArea = () => {
    const normalized = normalizeAreaValue(typedArea);
    if (!normalized) {
      setInputError("Area required");
      return;
    }
    const pool = allowedAreas.length > 0 ? allowedAreas : FALLBACK_AREAS;
    const matchedKnownArea = pool.find(
      (area) => area.toLowerCase() === normalized.toLowerCase()
    );
    if (!matchedKnownArea) {
      setInputError(
        "We don’t serve this exact area yet. Please select the nearest area from the list."
      );
      setShowAllMode(true);
      setShowSuggestions(true);
      return;
    }
    // Track the user's original input only when it differs from the
    // canonical we resolved to (case / spacing variations). Identical
    // values clear the alias hint so the confirmation card stays clean.
    const typedTrimmed = typedArea.trim().replace(/\s+/g, " ");
    setAliasInput(
      typedTrimmed && typedTrimmed.toLowerCase() !== matchedKnownArea.toLowerCase()
        ? typedTrimmed
        : ""
    );
    setTypedArea("");
    setShowSuggestions(false);
    setShowAllMode(false);
    setInputError("");
    onSelect(matchedKnownArea);
  };

  const handleShowAllAreas = () => {
    // Clear any typed text + lingering error so the full canonical list
    // is what the user actually sees. Without this, leftover text in the
    // input keeps the filter active and Show-All looks broken.
    setTypedArea("");
    setInputError("");
    setShowAllMode(true);
    setShowSuggestions(true);
    inputRef.current?.focus();
  };

  const handleSuggestionSelect = (clickedLabel: string) => {
    // When the clicked entry is an Area Intelligence alias suggestion,
    // submit its canonical (not the alias text). Plain canonicals and
    // client-filter results map to themselves.
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
    setShowAllMode(false);
    setInputError("");
    // When the user picked an alias label that resolved to a different
    // canonical, surface that in the existing "Matched from …" hint on
    // the confirmation card. Same field, same semantics as the existing
    // typed-and-confirmed flow.
    if (
      aiCanonical &&
      clickedLabel.trim().toLowerCase() !== aiCanonical.trim().toLowerCase()
    ) {
      setAliasInput(clickedLabel.trim());
    } else {
      setAliasInput("");
    }
    inputRef.current?.blur();
    onSelect(normalized);
  };

  const renderDropdown = showSuggestions && filteredSuggestions.length > 0;
  const noMatchesFound =
    showSuggestions &&
    typedArea.trim().length >= 2 &&
    filteredSuggestions.length === 0 &&
    !loadingAreas;

  useEffect(() => {
    if (!renderDropdown) return;
    const id = requestAnimationFrame(() => {
      dropdownRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(id);
  }, [renderDropdown]);

  return (
    <div className="w-full">
      {showQuestionLabel ? (
        <p className="mb-2 text-sm font-semibold text-[#111827]">
          Where do you need it?
        </p>
      ) : null}
      <div className="flex flex-wrap gap-x-1.5 gap-y-1.5">
        {lastUsedArea ? (
          <button
            type="button"
            onClick={() => storeSelection(lastUsedArea)}
            className={chipClass(isSameArea(selectedArea, lastUsedArea))}
          >
            {`Last used: ${lastUsedArea}`}
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => storeSelection(POPULAR_1)}
          className={chipClass(isSameArea(selectedArea, POPULAR_1))}
        >
          {POPULAR_1}
        </button>

        <button
          type="button"
          onClick={() => storeSelection(POPULAR_2)}
          className={chipClass(isSameArea(selectedArea, POPULAR_2))}
        >
          {POPULAR_2}
        </button>

        <button
          type="button"
          onClick={handleTypeAreaClick}
          className={chipClass(typedChipActive)}
        >
          Type your area
        </button>
      </div>

      {showAreaInput && (
        <div ref={inputShellRef} className="relative mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
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
                setShowAllMode(false);
              }
            }}
            placeholder="Type your area"
            className="w-full rounded-lg border border-emerald-200 px-3 py-2 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 sm:w-auto sm:min-w-[220px] sm:flex-1"
          />
          <button
            type="button"
            onClick={handleUseTypedArea}
            disabled={!normalizeAreaValue(typedArea)}
            className="w-full rounded-lg border border-[#1B5E20] px-3 py-2 text-sm font-semibold text-[#1B5E20] transition hover:bg-[#1B5E20]/10 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            Use this area
          </button>

          {loadingAreas ? (
            <p className="w-full text-xs text-slate-500">Loading suggestions...</p>
          ) : null}

          {renderDropdown ? (
            <div
              ref={dropdownRef}
              // Position below the input on every breakpoint. The previous
              // `bottom-full mb-2` mobile rule put the dropdown above the
              // input, which clipped offscreen when the input sat near the
              // top of the viewport — perceived as "suggestions don't
              // appear". `top-full` + a margin keeps it on-screen and lets
              // the keyboard's space below the input host it cleanly.
              // max-h-80 (~20rem / ~7-8 rows) keeps Show-All scrollable
              // without dominating the viewport. Internal scroll via
              // overflow-y-auto.
              className="absolute left-0 right-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg"
            >
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

          {noMatchesFound ? (
            <div className="w-full rounded-lg border border-amber-200 bg-amber-50 p-2">
              <p className="text-xs text-amber-800">
                No matching area found. Try nearest area or{" "}
                <button
                  type="button"
                  onClick={handleShowAllAreas}
                  className="font-bold underline"
                >
                  Show all areas
                </button>
                .
              </p>
            </div>
          ) : null}

          {inputError ? (
            <div className="w-full flex items-center gap-3">
              <p className="text-xs text-red-600">{inputError}</p>
              <button
                type="button"
                onClick={handleShowAllAreas}
                className="text-xs font-semibold text-[#1B5E20] underline underline-offset-2 hover:text-[#154b1a]"
              >
                Show all areas
              </button>
            </div>
          ) : null}
          {!inputError && renderDropdown ? (
            <p className="w-full text-xs text-slate-500">
              Try selecting: {filteredSuggestions.slice(0, 3).join(", ")}
            </p>
          ) : null}
        </div>
      )}

      {/* Selection confirmation — visible whenever an area is chosen,
          regardless of source (preset chip, last-used, dropdown
          suggestion, or typed-and-confirmed). The matched-to line shows
          only when the user's original input differs from the canonical
          resolved area. Mobile-clean: stacks vertically, truncates long
          area names. */}
      {selectedArea ? (
        <div
          className="mt-3 flex flex-col gap-1 rounded-2xl border border-[#1B5E20] bg-[#1B5E20]/10 px-3 py-2 sm:flex-row sm:items-center sm:gap-2"
          aria-live="polite"
        >
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-[#1B5E20]/80 sm:text-xs">
            Selected area
          </span>
          <span className="min-w-0 truncate text-sm font-bold text-[#1B5E20] sm:text-base">
            {selectedArea}
          </span>
          {aliasInput &&
          aliasInput.toLowerCase() !== selectedArea.toLowerCase() ? (
            <span className="min-w-0 truncate text-[11px] text-[#1B5E20]/80 sm:ml-auto sm:text-xs">
              Matched from “{aliasInput}”
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
