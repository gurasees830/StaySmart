import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { addDays, fromDateKey, startOfToday, toDateKey } from "../lib/utils";

type SearchState = {
  destination: string;
  checkIn: Date;
  checkOut: Date;
  adultCount: number;
  childCount: number;
};

type SearchContextValue = SearchState & {
  saveSearch: (patch: Partial<SearchState>) => void;
};

const STORAGE_KEY = "staysmart_search";
const SearchContext = createContext<SearchContextValue | undefined>(undefined);

const defaults = (): SearchState => ({
  destination: "",
  checkIn: addDays(startOfToday(), 1),
  checkOut: addDays(startOfToday(), 2),
  adultCount: 2,
  childCount: 0,
});

const load = (): SearchState => {
  const base = defaults();
  try {
    const raw = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
    if (!raw) return base;
    const checkIn = fromDateKey(raw.checkIn);
    const checkOut = fromDateKey(raw.checkOut);
    // Dates in the past are dropped so a stale session never books yesterday.
    const validIn = checkIn && checkIn >= startOfToday() ? checkIn : base.checkIn;
    const validOut = checkOut && checkOut > validIn ? checkOut : addDays(validIn, 1);
    return {
      destination: typeof raw.destination === "string" ? raw.destination : "",
      checkIn: validIn,
      checkOut: validOut,
      adultCount: Math.min(Math.max(Number(raw.adultCount) || 2, 1), 20),
      childCount: Math.min(Math.max(Number(raw.childCount) || 0, 0), 20),
    };
  } catch {
    return base;
  }
};

export const SearchContextProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<SearchState>(load);

  const saveSearch = useCallback((patch: Partial<SearchState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      if (next.checkOut <= next.checkIn) next.checkOut = addDays(next.checkIn, 1);
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...next, checkIn: toDateKey(next.checkIn), checkOut: toDateKey(next.checkOut) })
      );
      return next;
    });
  }, []);

  const value = useMemo(() => ({ ...state, saveSearch }), [state, saveSearch]);
  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
};

export const useSearchContext = () => {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error("useSearchContext must be used inside SearchContextProvider");
  return ctx;
};
