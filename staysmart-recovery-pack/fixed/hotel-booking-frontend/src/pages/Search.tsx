import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "react-query";
import { List, Map as MapIcon, SearchX, SlidersHorizontal, X } from "lucide-react";
import SearchBar from "../components/SearchBar";
import FiltersPanel, { Filters } from "../components/FiltersPanel";
import HotelCard, { HotelCardSkeleton } from "../components/HotelCard";
import Pagination from "../components/Pagination";
import { EmptyState, ErrorState, Spinner } from "../components/Spinner";
import { searchHotels } from "../lib/api";
import { SORT_OPTIONS } from "../lib/constants";
import { useSearchContext } from "../contexts/SearchContext";
import { cn, errorMessage, formatNumber, mapSafeImage, shortPlace } from "../lib/utils";

const MapView = lazy(() => import("../components/MapView"));

const PAGE_SIZE = 12;

const Search = () => {
  const [params, setParams] = useSearchParams();
  const search = useSearchContext();
  const [showFilters, setShowFilters] = useState(false);
  const [view, setView] = useState<"list" | "map">("list");
  const [activeId, setActiveId] = useState<string | null>(null);

  const destination = params.get("destination") || "";
  const page = Math.max(Number(params.get("page")) || 1, 1);
  const sortOption = params.get("sortOption") || "relevance";
  const filters: Filters = useMemo(
    () => ({
      stars: params.getAll("stars"),
      types: params.getAll("types"),
      facilities: params.getAll("facilities"),
      minPrice: params.get("minPrice") || "",
      maxPrice: params.get("maxPrice") || "",
      photos: params.get("photos") || "",
    }),
    [params]
  );

  // Keep the search box in sync when arriving from a link like /search?destination=Goa
  useEffect(() => {
    if (destination !== search.destination) search.saveSearch({ destination });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination]);

  const queryParams = {
    destination,
    page: String(page),
    pageSize: String(PAGE_SIZE),
    sortOption,
    stars: filters.stars,
    types: filters.types,
    facilities: filters.facilities,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    photos: filters.photos,
  };

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery(["search", queryParams], ({ signal }) => searchHotels(queryParams, signal), {
    keepPreviousData: true,
  });

  const update = (patch: Record<string, string | string[] | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      next.delete(key);
      if (Array.isArray(value)) value.forEach((v) => next.append(key, v));
      else if (value) next.set(key, value);
    }
    if (resetPage) next.delete("page");
    setParams(next);
  };

  const setFilters = (f: Filters) =>
    update({ stars: f.stars, types: f.types, facilities: f.facilities, minPrice: f.minPrice, maxPrice: f.maxPrice, photos: f.photos });

  const resetFilters = () => update({ stars: [], types: [], facilities: [], minPrice: null, maxPrice: null, photos: null });

  const goToPage = (p: number) => {
    update({ page: String(p) }, false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const hotels = data?.data || [];
  const total = data?.pagination.total ?? 0;

  const markers = hotels
    .filter((h) => h.location?.latitude && h.location?.longitude)
    .map((h) => ({
      id: h._id,
      lat: h.location!.latitude!,
      lng: h.location!.longitude!,
      title: h.name,
      subtitle: shortPlace(h),
      price: h.pricePerNight,
      href: `/detail/${h._id}`,
      imageUrl: mapSafeImage(h.imageUrls),
    }));

  return (
    <div>
      <div className="relative z-30 border-b border-slate-200 bg-gradient-to-r from-primary-700 to-indigo-700 py-6">
        <div className="container-page">
          <SearchBar variant="compact" />
        </div>
      </div>

      <div className="container-page py-8">
        <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
          {/* Filters (desktop) */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-1 scrollbar-thin">
              <FiltersPanel filters={filters} onChange={setFilters} onReset={resetFilters} />
            </div>
          </aside>

          <section>
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">
                  {destination ? `Hotels in ${destination}` : "All hotels in India"}
                </h1>
                <p className="mt-1 flex items-center gap-2 text-sm text-slate-600">
                  {isLoading ? "Searching..." : `${formatNumber(total)} ${total === 1 ? "property" : "properties"} found`}
                  {isFetching && !isLoading && <Spinner className="h-4 w-4" />}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button className="btn-secondary lg:hidden" onClick={() => setShowFilters(true)}>
                  <SlidersHorizontal className="h-4 w-4" /> Filters
                </button>
                <select
                  value={sortOption}
                  onChange={(e) => update({ sortOption: e.target.value === "relevance" ? null : e.target.value })}
                  className="input w-auto py-2"
                  aria-label="Sort results"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <div className="flex rounded-lg border border-slate-300 bg-white p-0.5">
                  <button onClick={() => setView("list")} className={cn("rounded-md p-2", view === "list" ? "bg-primary-600 text-white" : "text-slate-600 hover:bg-slate-100")} aria-label="List view" aria-pressed={view === "list"}>
                    <List className="h-4 w-4" />
                  </button>
                  <button onClick={() => setView("map")} className={cn("rounded-md p-2", view === "map" ? "bg-primary-600 text-white" : "text-slate-600 hover:bg-slate-100")} aria-label="Map view" aria-pressed={view === "map"}>
                    <MapIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {isError ? (
              <ErrorState message={errorMessage(error, "Could not load hotels")} onRetry={() => refetch()} />
            ) : isLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 4 }, (_, i) => (
                  <HotelCardSkeleton key={i} variant="list" />
                ))}
              </div>
            ) : hotels.length === 0 ? (
              <EmptyState
                icon={<SearchX className="h-8 w-8" />}
                title="No hotels match your search"
                description={destination ? `We couldn't find hotels for “${destination}” with these filters. Try another spelling, a nearby city, or fewer filters.` : "Try removing some filters."}
                action={
                  <button className="btn-primary" onClick={resetFilters}>
                    Clear filters
                  </button>
                }
              />
            ) : view === "map" ? (
              <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
                <Suspense fallback={<div className="skeleton h-[600px] rounded-2xl" />}>
                  <MapView markers={markers} activeId={activeId} onMarkerClick={setActiveId} className="h-[600px]" />
                </Suspense>
                <div className="max-h-[600px] space-y-3 overflow-y-auto pr-1 scrollbar-thin">
                  {hotels.map((h) => (
                    <div key={h._id} onMouseEnter={() => setActiveId(h._id)} className={cn("rounded-2xl transition", activeId === h._id && "ring-2 ring-amber-400")}>
                      <HotelCard hotel={h} />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className={cn("space-y-4 transition-opacity", isFetching && "opacity-60")}>
                {hotels.map((hotel) => (
                  <HotelCard key={hotel._id} hotel={hotel} variant="list" className="animate-fade-in" />
                ))}
              </div>
            )}

            {data && data.pagination.pages > 1 && (
              <div className="mt-8">
                <Pagination page={page} pages={data.pagination.pages} onPageChange={goToPage} />
              </div>
            )}
            {data && hotels.length > 0 && (
              <p className="mt-6 text-center text-xs text-slate-500">
                Prices marked “est.” are typical rates for the property's category and city. Confirm the final tariff with the hotel.
              </p>
            )}
          </section>
        </div>
      </div>

      {/* Filters (mobile drawer) */}
      {showFilters && (
        <div className="fixed inset-0 z-[70] lg:hidden" role="dialog" aria-label="Filters">
          <div className="absolute inset-0 bg-slate-900/50 animate-fade-in" onClick={() => setShowFilters(false)} />
          <div className="absolute inset-y-0 right-0 w-full max-w-sm overflow-y-auto bg-slate-50 p-4 shadow-large animate-slide-up">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Filters</h2>
              <button onClick={() => setShowFilters(false)} className="rounded-lg p-2 hover:bg-slate-200" aria-label="Close filters">
                <X className="h-5 w-5" />
              </button>
            </div>
            <FiltersPanel filters={filters} onChange={setFilters} onReset={resetFilters} />
            <button className="btn-primary mt-4 w-full" onClick={() => setShowFilters(false)}>
              Show {formatNumber(total)} results
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Search;
