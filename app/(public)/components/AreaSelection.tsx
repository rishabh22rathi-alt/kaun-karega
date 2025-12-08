"use client";

"use client";
import { useEffect, useMemo, useRef, useState } from "react";

type AreaSelectionProps = {
  selectedArea: string;
  onSelect: (area: string) => void;
  areas: string[];
  popularAreas: string[];
};

const GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

function capitalizeWords(str: string) {
  return str
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export default function AreaSelection({ selectedArea, onSelect, areas, popularAreas }: AreaSelectionProps) {
  const [detecting, setDetecting] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const storeAndSelect = (area: string) => {
    const fixed = capitalizeWords(area);
    onSelect(fixed);
    if (typeof window !== "undefined") {
      localStorage.setItem("kk_last_area", fixed);
    }
    setSearchOpen(false);
    setSearchInput("");
  };

  const chipClass = (active: boolean) =>
    `rounded-full px-4 py-2 text-sm font-semibold transition border whitespace-nowrap ${
      active
        ? "bg-[#1B5E20] text-white border-[#1B5E20] shadow-sm"
        : "border-[#1B5E20] text-[#1B5E20] bg-white hover:bg-[#1B5E20]/10"
    }`;

  const lastUsedArea = useMemo(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("kk_last_area") || "";
  }, []);

  const primarySuggestion = lastUsedArea || popularAreas[0] || "";
  const secondarySuggestion = popularAreas.length > 1 ? popularAreas[1] : "";

  const handleDetect = () => {
    if (!navigator.geolocation) return;
    setDetecting(true);
    setLocationDenied(false);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const params = new URLSearchParams({
            latlng: `${pos.coords.latitude},${pos.coords.longitude}`,
            key: "YOUR_GOOGLE_MAPS_API_KEY",
          });
          const res = await fetch(`${GOOGLE_GEOCODE_URL}?${params.toString()}`);
          const data = await res.json();
          const component = data?.results?.[0]?.address_components?.find((c: any) =>
            c.types.includes("sublocality") || c.types.includes("locality")
          );
          const detected = component?.long_name || component?.short_name;
          if (detected) {
            storeAndSelect(detected);
          }
        } catch (err) {
          console.error("Failed to detect area", err);
        } finally {
          setDetecting(false);
        }
      },
      () => {
        setDetecting(false);
        setLocationDenied(true);
      }
    );
  };

  const filteredAreas = useMemo(() => {
    const val = searchInput.trim().toLowerCase();
    if (!val) return [];
    return areas.filter((area) => area.toLowerCase().includes(val));
  }, [areas, searchInput]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="w-full">
      <p className="text-sm font-semibold text-[#111827] mb-2">Where do you need it?</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleDetect}
          className={chipClass(selectedArea === "Auto-detect")}
          disabled={detecting}
        >
          {detecting ? "Detecting..." : locationDenied ? "Detect location" : "Auto-detect area"}
        </button>

        {primarySuggestion ? (
          <button
            type="button"
            onClick={() => storeAndSelect(primarySuggestion)}
            className={chipClass(selectedArea === primarySuggestion)}
          >
            {lastUsedArea ? `Last used: ${primarySuggestion}` : primarySuggestion}
          </button>
        ) : null}

        {secondarySuggestion ? (
          <button
            type="button"
            onClick={() => storeAndSelect(secondarySuggestion)}
            className={chipClass(selectedArea === secondarySuggestion)}
          >
            {secondarySuggestion}
          </button>
        ) : null}

        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setSearchOpen((prev) => !prev)}
            className={chipClass(
              !!selectedArea &&
                selectedArea !== primarySuggestion &&
                selectedArea !== secondarySuggestion
            )}
          >
            {searchOpen || searchInput
              ? searchInput
              : selectedArea && selectedArea !== primarySuggestion && selectedArea !== secondarySuggestion
              ? selectedArea
              : "Type your area"}
          </button>

          {searchOpen && (
            <div className="absolute left-0 right-0 top-full z-30 mt-2 rounded-2xl border border-emerald-100 bg-white p-3 shadow-xl min-w-[240px]">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(capitalizeWords(e.target.value))}
                placeholder="Type your area"
                className="w-full rounded-lg border border-emerald-200 px-3 py-2 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              />

              {searchInput.trim() !== "" && (
                <div className="mt-2 max-h-48 overflow-y-auto">
                  {filteredAreas.length > 0 ? (
                    <ul className="divide-y divide-emerald-50">
                      {filteredAreas.map((area) => (
                        <li key={area}>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-emerald-50"
                            onClick={() => storeAndSelect(area)}
                          >
                            {area}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <button
                      type="button"
                      className="mt-2 w-full rounded-lg border border-dashed border-emerald-200 px-3 py-2 text-left text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
                      onClick={() => storeAndSelect(searchInput)}
                    >
                      Add new area: {searchInput}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
