"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type AreaSelectionProps = {
  selectedArea: string;
  onSelect: (area: string) => void;
  errorMessage?: string;
};

const POPULAR_1 = "Shastri Nagar";
const POPULAR_2 = "Sardarpura";
const LAST_AREA_KEY = "kk_last_area";

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

export default function AreaSelection({
  selectedArea,
  onSelect,
  errorMessage,
}: AreaSelectionProps) {
  const [lastUsedArea, setLastUsedArea] = useState("");
  const [showAreaInput, setShowAreaInput] = useState(false);
  const [typedArea, setTypedArea] = useState("");
  const [allowedAreas, setAllowedAreas] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [inputError, setInputError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputShellRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef(false);

  const storeSelection = (area: string) => {
    const normalized = normalizeAreaValue(area);
    if (!normalized) return;
    selectedRef.current = true;
    setShowDropdown(false);
    setSuggestions([]);
    setInputError("");
    onSelect(normalized);
  };

  const chipClass = (active: boolean) =>
    `rounded-full px-4 py-2 text-sm font-semibold transition border whitespace-nowrap ${
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const area = window.localStorage.getItem(LAST_AREA_KEY) || "";
    setLastUsedArea(normalizeAreaValue(area));
  }, []);

  useEffect(() => {
    if (!showAreaInput || !inputRef.current) return;
    inputRef.current.focus();
  }, [showAreaInput]);

  const fetchSuggestions = async (query: string, signal?: AbortSignal) => {
    const response = await fetch(`/api/areas?q=${encodeURIComponent(query)}`, {
      signal,
    });
    const data = await response.json();
    return Array.isArray(data?.areas)
      ? data.areas.filter((value: unknown) => typeof value === "string")
      : [];
  };

  useEffect(() => {
    if (!showAreaInput || allowedAreas.length > 0) return;
    const controller = new AbortController();
    fetchSuggestions("", controller.signal)
      .then((areas) => setAllowedAreas(areas))
      .catch(() => setAllowedAreas([]));
    return () => controller.abort();
  }, [showAreaInput, allowedAreas.length]);

  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current = false;
      return;
    }
    if (!showAreaInput) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    const query = typedArea.trim();
    if (!query) {
      setSuggestions([]);
      setShowDropdown(false);
      setLoadingSuggestions(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setLoadingSuggestions(true);
        const nextSuggestions = await fetchSuggestions(
          query,
          controller.signal
        );
        if (selectedRef.current) {
          return;
        }
        setSuggestions(nextSuggestions);
        setShowDropdown(nextSuggestions.length > 0);
      } catch (error: any) {
        if (error?.name !== "AbortError") {
          setSuggestions([]);
          setShowDropdown(false);
        }
      } finally {
        setLoadingSuggestions(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [showAreaInput, typedArea]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        inputShellRef.current &&
        !inputShellRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const handleTypeAreaClick = () => {
    setShowAreaInput(true);
    setInputError("");
    if (typedChipActive && !typedArea.trim()) {
      setTypedArea(selectedArea);
    }
  };

  const handleUseTypedArea = () => {
    const normalized = normalizeAreaValue(typedArea);
    if (!normalized) {
      setInputError("Area required");
      return;
    }
    const matchedKnownArea = allowedAreas.find(
      (area) => area.toLowerCase() === normalized.toLowerCase()
    );
    if (!matchedKnownArea) {
      setInputError(
        "We don\u2019t serve this exact area yet. Please select the nearest area from the list."
      );
      setShowDropdown(true);
      if (suggestions.length === 0) {
        setLoadingSuggestions(true);
        fetchSuggestions("")
          .then((nextSuggestions) => {
            setSuggestions(nextSuggestions.slice(0, 8));
            setShowDropdown(true);
          })
          .catch(() => {
            setSuggestions([]);
            setShowDropdown(true);
          })
          .finally(() => setLoadingSuggestions(false));
      }
      return;
    }
    selectedRef.current = true;
    setTypedArea(matchedKnownArea);
    setShowDropdown(false);
    setSuggestions([]);
    setInputError("");
    onSelect(matchedKnownArea);
  };

  const handleShowAllAreas = () => {
    setLoadingSuggestions(true);
    fetchSuggestions("")
      .then((nextSuggestions) => {
        setSuggestions(nextSuggestions.slice(0, 8));
        setShowDropdown(true);
      })
      .catch(() => {
        setSuggestions([]);
        setShowDropdown(true);
      })
      .finally(() => setLoadingSuggestions(false));
  };

  const handleSuggestionSelect = (area: string) => {
    const normalized = normalizeAreaValue(area);
    if (!normalized) return;
    selectedRef.current = true;
    setTypedArea(normalized);
    setShowDropdown(false);
    setSuggestions([]);
    inputRef.current?.blur();
    setInputError("");
    onSelect(normalized);
  };

  return (
    <div className="w-full">
      <p className="mb-2 text-sm font-semibold text-[#111827]">
        Where do you need it?
      </p>
      <div className="flex flex-wrap gap-2">
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
        <div ref={inputShellRef} className="relative mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={typedArea}
            onChange={(e) => {
              setTypedArea(e.target.value);
              if (inputError) setInputError("");
            }}
            onBlur={() => {
              window.setTimeout(() => {
                if (selectedRef.current) return;
                setShowDropdown(false);
              }, 200);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleUseTypedArea();
              }
              if (event.key === "Escape") {
                setShowDropdown(false);
              }
            }}
            placeholder="Type your area"
            className="min-w-[220px] flex-1 rounded-lg border border-emerald-200 px-3 py-2 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
          <button
            type="button"
            onClick={handleUseTypedArea}
            disabled={!normalizeAreaValue(typedArea)}
            className="rounded-lg border border-[#1B5E20] px-3 py-2 text-sm font-semibold text-[#1B5E20] transition hover:bg-[#1B5E20]/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Use this area
          </button>
          {loadingSuggestions ? (
            <p className="w-full text-xs text-slate-500">Loading suggestions...</p>
          ) : null}
          {showDropdown &&
          suggestions.length > 0 &&
          typedArea.trim().length >= 2 ? (
            <div className="absolute left-0 right-0 z-50 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg bottom-full mb-2 md:bottom-auto md:top-full md:mb-0 md:mt-2">
              {suggestions.map((area) => (
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
          {!inputError && showDropdown && suggestions.length > 0 ? (
            <p className="w-full text-xs text-slate-500">
              Try selecting: {suggestions.slice(0, 3).join(", ")}
            </p>
          ) : null}
        </div>
      )}

      {errorMessage ? (
        <p className="mt-2 text-xs text-red-600">{errorMessage}</p>
      ) : null}
    </div>
  );
}
