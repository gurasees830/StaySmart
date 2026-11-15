import { lazy, Suspense, useState } from "react";
import { useQuery } from "react-query";
import { Crosshair, Loader2, LocateFixed, MapPin } from "lucide-react";
import HotelCard from "../components/HotelCard";
import { EmptyState, ErrorState } from "../components/Spinner";
import { fetchNearbyHotels, fetchPopularDestinations } from "../lib/api";
import { HOTEL_TYPES } from "../lib/constants";
import { cn, errorMessage, mapSafeImage, shortPlace } from "../lib/utils";

const MapView = lazy(() => import("../components/MapView"));
const RADII = [2, 5, 10, 25, 50];

type Origin = { lat: number; lng: number; label: string };

const NearMe = () => {
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [radiusKm, setRadiusKm] = useState(5);
  const [type, setType] = useState("");
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const { data: cities } = useQuery("popular-destinations-near", () => fetchPopularDestinations(16), { staleTime: 10 * 60 * 1000 });

  const nearby = useQuery(
    ["nearby", origin?.lat, origin?.lng, radiusKm, type],
    () => fetchNearbyHotels({ lat: origin!.lat, lng: origin!.lng, radiusKm, types: type ? [type] : undefined, limit: 80 }),
    { enabled: Boolean(origin), keepPreviousData: true }
  );

  const locate = () => {
    setGeoError("");
    if (!navigator.geolocation) {
      setGeoError("Your browser does not support location. Pick a city below instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: "your location" });
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setGeoError(err.code === err.PERMISSION_DENIED ? "Location permission was denied. Allow it in your browser, or pick a city below." : "Could not get your location. Pick a city below instead.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  };

  const hotels = nearby.data?.data || [];
  const markers = hotels
    .filter((h) => h.location?.latitude && h.location?.longitude)
    .map((h) => ({ id: h._id, lat: h.location!.latitude!, lng: h.location!.longitude!, title: h.name, subtitle: `${shortPlace(h)} · ${h.distanceKm} km`, price: h.pricePerNight, href: `/detail/${h._id}`, imageUrl: mapSafeImage(h.imageUrls) }));

  return (
    <div className="container-page py-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Hotels near {origin ? origin.label : "you"}</h1>
          <p className="mt-1 text-slate-600">See the closest stays on a live map, sorted by distance.</p>
        </div>
        <button onClick={locate} className="btn-primary py-3" disabled={locating}>
          {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />} {origin?.label === "your location" ? "Refresh my location" : "Use my location"}
        </button>
      </div>

      {geoError && <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{geoError}</p>}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-700">Or explore around:</span>
        {(cities || []).filter((c) => c.latitude && c.longitude).map((c) => (
          <button
            key={c.label}
            onClick={() => setOrigin({ lat: c.latitude!, lng: c.longitude!, label: c.city })}
            className={cn("rounded-full border px-3 py-1 text-sm transition", origin?.label === c.city ? "border-primary-600 bg-primary-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}
          >
            {c.city}
          </button>
        ))}
      </div>

      {origin && (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-slate-300 bg-white p-0.5">
            {RADII.map((r) => (
              <button key={r} onClick={() => setRadiusKm(r)} className={cn("rounded-md px-3 py-1.5 text-sm font-medium", radiusKm === r ? "bg-primary-600 text-white" : "text-slate-600 hover:bg-slate-100")}>
                {r} km
              </button>
            ))}
          </div>
          <select value={type} onChange={(e) => setType(e.target.value)} className="input w-auto py-2" aria-label="Property type">
            <option value="">All property types</option>
            {HOTEL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <span className="text-sm text-slate-600">{nearby.isFetching ? "Searching..." : `${hotels.length} ${hotels.length === 1 ? "hotel" : "hotels"} within ${radiusKm} km`}</span>
        </div>
      )}

      <div className="mt-6">
        {!origin ? (
          <EmptyState icon={<Crosshair className="h-8 w-8" />} title="Share your location to begin" description="We use it only to find hotels around you — it isn't stored." action={<button onClick={locate} className="btn-primary"><MapPin className="h-4 w-4" /> Use my location</button>} />
        ) : nearby.isError ? (
          <ErrorState message={errorMessage(nearby.error, "Could not load nearby hotels")} onRetry={() => nearby.refetch()} />
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
            <Suspense fallback={<div className="skeleton h-[560px] rounded-2xl" />}>
              <MapView markers={markers} userLocation={[origin.lat, origin.lng]} activeId={activeId} onMarkerClick={setActiveId} className="h-[420px] lg:h-[640px]" zoom={13} />
            </Suspense>
            <div className="max-h-[640px] space-y-3 overflow-y-auto pr-1 scrollbar-thin">
              {nearby.isLoading && <div className="skeleton h-64 rounded-2xl" />}
              {!nearby.isLoading && hotels.length === 0 && (
                <EmptyState title="No hotels in this radius" description="Try a larger radius or another property type." action={<button className="btn-primary" onClick={() => setRadiusKm(Math.min(50, radiusKm * 2 > 50 ? 50 : RADII.find((r) => r > radiusKm) || 50))}>Search wider</button>} />
              )}
              {hotels.map((h) => (
                <div key={h._id} onMouseEnter={() => setActiveId(h._id)} className={cn("rounded-2xl transition", activeId === h._id && "ring-2 ring-amber-400")}>
                  <HotelCard hotel={h} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default NearMe;
