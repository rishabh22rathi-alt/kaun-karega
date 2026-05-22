"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Minimal, public-only geo context. Lives at the page level (homepage and
// request-flow each wrap themselves with PublicGeoProvider) rather than at
// the app shell, so admin and provider routes are unaffected. Cross-page
// persistence is via a shared cookie + localStorage backing store, so
// navigating between the two pages preserves the user's selection even
// though each page mounts its own provider instance.
//
// Future scale: when /api/cities returns multiple cities across multiple
// states, this same context already handles the cascade. When a CitySelector
// at the app-shell level finally lands (Phase 1.3+), this hook can be
// rewritten to delegate to that broader context with zero call-site
// changes — every consumer goes through `usePublicGeo()`.

const COOKIE_NAME = "kk_geo";
const STORAGE_KEY = "kk_geo";
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

export type City = {
  city_code: string;
  city_name: string;
  state: string;
  country: string;
  is_default: boolean;
};

type StoredGeo = { state: string; city: string };

type CitiesResponse = {
  ok?: boolean;
  cities?: City[];
  default_city_code?: string;
};

export type PublicGeoState = {
  isLoading: boolean;
  cities: City[];
  states: string[];               // derived, deduped, ordered
  selectedState: string;
  selectedCityCode: string;
  selectedCityName: string;
  defaultCityCode: string;
  citiesForState: (state: string) => City[];
  setState: (state: string) => void;
  setCityCode: (cityCode: string) => void;
};

const PublicGeoContext = createContext<PublicGeoState | null>(null);

// ───────────────────────────────────────────────────────────────────────────
// Storage helpers — defensive: every read swallows errors and returns null.
// A user with cookies disabled OR localStorage disabled still gets the
// default city; the cascade just doesn't persist across navigations.
// ───────────────────────────────────────────────────────────────────────────

function readCookie(): StoredGeo | null {
  if (typeof document === "undefined") return null;
  try {
    const raw = document.cookie
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${COOKIE_NAME}=`));
    if (!raw) return null;
    const value = decodeURIComponent(raw.slice(COOKIE_NAME.length + 1));
    const parsed = JSON.parse(value) as Partial<StoredGeo>;
    if (typeof parsed?.state !== "string" || typeof parsed?.city !== "string") {
      return null;
    }
    return { state: parsed.state, city: parsed.city };
  } catch {
    return null;
  }
}

function writeCookie(geo: StoredGeo): void {
  if (typeof document === "undefined") return;
  try {
    const isProd = typeof window !== "undefined" && window.location.protocol === "https:";
    const secure = isProd ? "; Secure" : "";
    const value = encodeURIComponent(JSON.stringify(geo));
    document.cookie = `${COOKIE_NAME}=${value}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
  } catch {
    // Cookie write failed — localStorage still mirrors the value.
  }
}

function readStorage(): StoredGeo | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredGeo>;
    if (typeof parsed?.state !== "string" || typeof parsed?.city !== "string") {
      return null;
    }
    return { state: parsed.state, city: parsed.city };
  } catch {
    return null;
  }
}

function writeStorage(geo: StoredGeo): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(geo));
  } catch {
    // Quota or disabled — cookie still mirrors the value.
  }
}

// Persist to both surfaces. Cookie wins on next SSR (server can read it);
// localStorage wins on quota-disabled browsers where cookies failed.
function persist(geo: StoredGeo): void {
  writeCookie(geo);
  writeStorage(geo);
}

// ───────────────────────────────────────────────────────────────────────────
// Provider
// ───────────────────────────────────────────────────────────────────────────

export function PublicGeoProvider({ children }: { children: ReactNode }) {
  const [cities, setCities] = useState<City[]>([]);
  const [defaultCityCode, setDefaultCityCode] = useState<string>("");
  const [selectedState, setSelectedStateRaw] = useState<string>("");
  const [selectedCityCode, setSelectedCityCodeRaw] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Fetch the city catalogue once. /api/cities is 5-min cached server-side
  // (Phase 1.1), so this is cheap; the fetch is the only data dependency
  // the cascade needs.
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/cities", { signal: ctrl.signal })
      .then((res) => res.json())
      .then((data: CitiesResponse) => {
        if (ctrl.signal.aborted) return;
        const list = Array.isArray(data?.cities) ? data.cities : [];
        const def = String(data?.default_city_code ?? "").trim();
        setCities(list);
        setDefaultCityCode(def);

        // Hydrate selection in priority order: cookie → localStorage → default.
        // Each source must validate against the live cities list — a stale
        // city_code from a deleted/deactivated city falls through to default
        // rather than silently breaking the cascade.
        const fromCookie = readCookie();
        const fromStorage = fromCookie ?? readStorage();
        const valid = (s: StoredGeo | null) => {
          if (!s) return null;
          const found = list.find(
            (c) => c.city_code === s.city && c.state === s.state
          );
          return found ? s : null;
        };
        const hydrated = valid(fromStorage);
        if (hydrated) {
          setSelectedStateRaw(hydrated.state);
          setSelectedCityCodeRaw(hydrated.city);
        } else {
          const defCity = list.find((c) => c.city_code === def);
          if (defCity) {
            setSelectedStateRaw(defCity.state);
            setSelectedCityCodeRaw(defCity.city_code);
            persist({ state: defCity.state, city: defCity.city_code });
          }
        }
        setIsLoading(false);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        // /api/cities failed — leave selection empty. Consumers render a
        // "Could not load locations" message via isLoading + cities.length.
        setIsLoading(false);
      });
    return () => ctrl.abort();
  }, []);

  const states = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of cities) {
      if (!seen.has(c.state)) {
        seen.add(c.state);
        out.push(c.state);
      }
    }
    // Default-city's state floats to the top; the rest stay in catalogue
    // order (the API already orders `is_default DESC, city_name ASC`).
    const defCity = cities.find((c) => c.city_code === defaultCityCode);
    if (defCity) {
      const i = out.indexOf(defCity.state);
      if (i > 0) {
        out.splice(i, 1);
        out.unshift(defCity.state);
      }
    }
    return out;
  }, [cities, defaultCityCode]);

  const citiesForState = useCallback(
    (state: string) => cities.filter((c) => c.state === state),
    [cities]
  );

  const selectedCityName = useMemo(() => {
    const c = cities.find((c) => c.city_code === selectedCityCode);
    return c?.city_name ?? "";
  }, [cities, selectedCityCode]);

  // State change cascades to the first city in that state. Cascade rule
  // lives here, not in consumers, so the cookie always reflects a coherent
  // (state, city) pair.
  const setState = useCallback(
    (next: string) => {
      if (!next || next === selectedState) return;
      const firstCityInState = cities.find((c) => c.state === next);
      if (!firstCityInState) return;
      setSelectedStateRaw(next);
      setSelectedCityCodeRaw(firstCityInState.city_code);
      persist({ state: next, city: firstCityInState.city_code });
    },
    [cities, selectedState]
  );

  const setCityCode = useCallback(
    (next: string) => {
      if (!next || next === selectedCityCode) return;
      const found = cities.find((c) => c.city_code === next);
      if (!found) return;
      setSelectedStateRaw(found.state);
      setSelectedCityCodeRaw(found.city_code);
      persist({ state: found.state, city: found.city_code });
    },
    [cities, selectedCityCode]
  );

  const value = useMemo<PublicGeoState>(
    () => ({
      isLoading,
      cities,
      states,
      selectedState,
      selectedCityCode,
      selectedCityName,
      defaultCityCode,
      citiesForState,
      setState,
      setCityCode,
    }),
    [
      isLoading,
      cities,
      states,
      selectedState,
      selectedCityCode,
      selectedCityName,
      defaultCityCode,
      citiesForState,
      setState,
      setCityCode,
    ]
  );

  return (
    <PublicGeoContext.Provider value={value}>
      {children}
    </PublicGeoContext.Provider>
  );
}

// Throws when called outside a PublicGeoProvider. Loud failure beats
// silent default-only behavior: any new page using AreaSelection must
// remember to wrap itself.
export function usePublicGeo(): PublicGeoState {
  const ctx = useContext(PublicGeoContext);
  if (!ctx) {
    throw new Error(
      "usePublicGeo must be called inside <PublicGeoProvider>. Wrap the page in PublicGeoProvider from lib/cities/publicGeoContext."
    );
  }
  return ctx;
}
