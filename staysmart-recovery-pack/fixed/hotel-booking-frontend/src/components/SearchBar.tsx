import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import DatePicker from "react-datepicker";
import { Building2, CalendarDays, MapPin, Minus, Plus, Search, Users } from "lucide-react";
import { useSearchContext } from "../contexts/SearchContext";
import { fetchLocationSuggestions } from "../lib/api";
import type { LocationSuggestion } from "../types";
import { addDays, cn, plural, startOfToday } from "../lib/utils";

const Stepper = ({ label, hint, value, min, max, onChange }: { label: string; hint: string; value: number; min: number; max: number; onChange: (v: number) => void }) => (
  <div className="flex items-center justify-between gap-6 py-2">
    <div>
      <p className="text-sm font-medium text-slate-900">{label}</p>
      <p className="text-xs text-slate-500">{hint}</p>
    </div>
    <div className="flex items-center gap-3">
      <button type="button" className="rounded-full border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={`Fewer ${label.toLowerCase()}`}>
        <Minus className="h-4 w-4" />
      </button>
      <span className="w-5 text-center text-sm font-semibold">{value}</span>
      <button type="button" className="rounded-full border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={`More ${label.toLowerCase()}`}>
        <Plus className="h-4 w-4" />
      </button>
    </div>
  </div>
);

type Props = { variant?: "hero" | "compact"; onSearched?: () => void };

const SearchBar = ({ variant = "hero", onSearched }: Props) => {
  const search = useSearchContext();
  const navigate = useNavigate();
  const [destination, setDestination] = useState(search.destination);
  const [checkIn, setCheckIn] = useState<Date>(search.checkIn);
  const [checkOut, setCheckOut] = useState<Date>(search.checkOut);
  const [adultCount, setAdultCount] = useState(search.adultCount);
  const [childCount, setChildCount] = useState(search.childCount);
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [guestsOpen, setGuestsOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const guestsRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDestination(search.destination), [search.destination]);

  // Debounced autocomplete with request cancellation.
  useEffect(() => {
    if (!showSuggestions) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const results = await fetchLocationSuggestions(destination.trim(), controller.signal);
        setSuggestions(results);
        setHighlight(-1);
      } catch {
        if (!controller.signal.aborted) setSuggestions([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [destination, showSuggestions]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setShowSuggestions(false);
      if (guestsRef.current && !guestsRef.current.contains(e.target as Node)) setGuestsOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const runSearch = (dest: string) => {
    search.saveSearch({ destination: dest, checkIn, checkOut, adultCount, childCount });
    setShowSuggestions(false);
    const params = new URLSearchParams();
    if (dest.trim()) params.set("destination", dest.trim());
    navigate(`/search${params.toString() ? `?${params}` : ""}`);
    onSearched?.();
  };

  const choose = (s: LocationSuggestion) => {
    if (s.type === "hotel" && s.hotelId) {
      search.saveSearch({ checkIn, checkOut, adultCount, childCount });
      setShowSuggestions(false);
      navigate(`/detail/${s.hotelId}`);
      return;
    }
    const value = s.type === "area" ? s.area || s.label : s.city;
    setDestination(value);
    runSearch(value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || !suggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, -1));
    } else if (e.key === "Enter" && highlight >= 0) {
      e.preventDefault();
      choose(suggestions[highlight]);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    runSearch(destination);
  };

  const hero = variant === "hero";

  return (
    <form
      onSubmit={onSubmit}
      className={cn(
        "grid gap-2 rounded-2xl bg-white p-2 text-left shadow-large",
        hero ? "lg:grid-cols-[1.6fr_1fr_1fr_1fr_auto]" : "md:grid-cols-[1.6fr_1fr_1fr_1fr_auto]"
      )}
      role="search"
    >
      <div ref={boxRef} className="relative">
        <label className="flex h-full items-center gap-3 rounded-xl px-3 py-2 hover:bg-slate-50">
          <MapPin className="h-5 w-5 shrink-0 text-primary-600" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-xs font-semibold text-slate-500">Where to?</span>
            <input
              value={destination}
              onChange={(e) => {
                setDestination(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onKeyDown={onKeyDown}
              placeholder="City, area or hotel name"
              className="w-full bg-transparent text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none"
              aria-label="Destination"
              aria-autocomplete="list"
              aria-expanded={showSuggestions}
              autoComplete="off"
              data-testid="destination-input"
            />
          </span>
        </label>
        {showSuggestions && (suggestions.length > 0 || loading) && (
          <ul className="absolute left-0 right-0 top-full z-50 mt-2 max-h-96 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-large" role="listbox">
            {loading && suggestions.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Searching...</li>}
            {!destination.trim() && suggestions.length > 0 && (
              <li className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Popular destinations</li>
            )}
            {suggestions.map((s, i) => (
              <li key={`${s.type}-${s.label}-${i}`} role="option" aria-selected={highlight === i}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(s)}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left", highlight === i ? "bg-primary-50" : "hover:bg-slate-50")}
                >
                  <span className={cn("rounded-lg p-2", s.type === "hotel" ? "bg-amber-50 text-amber-600" : "bg-primary-50 text-primary-600")}>
                    {s.type === "hotel" ? <Building2 className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{s.label}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {s.type === "hotel" ? `Hotel · ${[s.city, s.state].filter(Boolean).join(", ")}` : s.type === "area" ? `Area · ${s.state}` : `City · ${s.state}`}
                    </span>
                  </span>
                  {typeof s.count === "number" && <span className="whitespace-nowrap text-xs text-slate-500">{plural(s.count, "hotel")}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-slate-50">
        <CalendarDays className="h-5 w-5 shrink-0 text-primary-600" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs font-semibold text-slate-500">Check-in</span>
          <DatePicker
            selected={checkIn}
            onChange={(date: Date | null) => {
              if (!date) return;
              setCheckIn(date);
              if (checkOut <= date) setCheckOut(addDays(date, 1));
            }}
            selectsStart
            startDate={checkIn}
            endDate={checkOut}
            minDate={startOfToday()}
            maxDate={addDays(startOfToday(), 365)}
            dateFormat="EEE, d MMM"
            className="w-full bg-transparent text-sm font-medium text-slate-900 focus:outline-none"
            ariaLabelledBy="Check-in date"
          />
        </span>
      </label>

      <label className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-slate-50">
        <CalendarDays className="h-5 w-5 shrink-0 text-primary-600" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs font-semibold text-slate-500">Check-out</span>
          <DatePicker
            selected={checkOut}
            onChange={(date: Date | null) => date && setCheckOut(date)}
            selectsEnd
            startDate={checkIn}
            endDate={checkOut}
            minDate={addDays(checkIn, 1)}
            maxDate={addDays(checkIn, 30)}
            dateFormat="EEE, d MMM"
            className="w-full bg-transparent text-sm font-medium text-slate-900 focus:outline-none"
            ariaLabelledBy="Check-out date"
          />
        </span>
      </label>

      <div ref={guestsRef} className="relative">
        <button type="button" onClick={() => setGuestsOpen((v) => !v)} className="flex h-full w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-slate-50" aria-expanded={guestsOpen}>
          <Users className="h-5 w-5 shrink-0 text-primary-600" />
          <span className="flex flex-col">
            <span className="text-xs font-semibold text-slate-500">Guests</span>
            <span className="text-sm font-medium text-slate-900">
              {plural(adultCount, "adult")}
              {childCount > 0 ? `, ${plural(childCount, "child", "children")}` : ""}
            </span>
          </span>
        </button>
        {guestsOpen && (
          <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-4 shadow-large">
            <Stepper label="Adults" hint="Age 13+" value={adultCount} min={1} max={10} onChange={setAdultCount} />
            <Stepper label="Children" hint="Age 0–12" value={childCount} min={0} max={10} onChange={setChildCount} />
            <button type="button" className="btn-primary mt-2 w-full" onClick={() => setGuestsOpen(false)}>
              Done
            </button>
          </div>
        )}
      </div>

      <button type="submit" className="btn-primary h-full min-h-[52px] rounded-xl px-6 text-base" data-testid="search-button">
        <Search className="h-5 w-5" />
        <span>Search</span>
      </button>
    </form>
  );
};

export default SearchBar;
