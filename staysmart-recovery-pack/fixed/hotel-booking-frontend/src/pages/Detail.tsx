import { lazy, Suspense, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "react-query";
import DatePicker from "react-datepicker";
import {
  BadgeCheck,
  BedDouble,
  Building,
  CalendarDays,
  Car,
  Check,
  ChevronRight,
  Clock,
  CreditCard,
  ExternalLink,
  Globe,
  Info,
  Loader2,
  Mail,
  MapPin,
  Navigation,
  Phone,
  Route,
  Users,
} from "lucide-react";
import ImageGallery from "../components/ImageGallery";
import StarRating from "../components/StarRating";
import HotelCard from "../components/HotelCard";
import { ErrorState, PageSpinner } from "../components/Spinner";
import { useSearchContext } from "../contexts/SearchContext";
import { useAppContext } from "../contexts/AppContext";
import { fetchHotelById, fetchSimilarHotels } from "../lib/api";
import { addDays, errorMessage, formatINR, hotelAddress, nightsBetween, plural, startOfToday } from "../lib/utils";
import type { Hotel } from "../types";

const MapView = lazy(() => import("../components/MapView"));

type RouteInfo = { coords: [number, number][]; distanceKm: number; minutes: number; from: [number, number] };

const BookingWidget = ({ hotel }: { hotel: Hotel }) => {
  const search = useSearchContext();
  const { isLoggedIn, config } = useAppContext();
  const navigate = useNavigate();
  const [checkIn, setCheckIn] = useState(search.checkIn);
  const [checkOut, setCheckOut] = useState(search.checkOut);
  const [adults, setAdults] = useState(Math.min(search.adultCount, Math.max(hotel.adultCount, 1) * 4));
  const [children, setChildren] = useState(search.childCount);
  const nights = nightsBetween(checkIn, checkOut);
  const total = nights * hotel.pricePerNight;
  const rooms = Math.max(1, Math.ceil(adults / Math.max(hotel.adultCount || 2, 1)));

  const book = () => {
    search.saveSearch({ checkIn, checkOut, adultCount: adults, childCount: children });
    const target = `/hotel/${hotel._id}/booking`;
    if (!isLoggedIn) navigate("/sign-in", { state: { from: target, reason: "booking" } });
    else navigate(target);
  };

  return (
    <div className="card p-5 shadow-medium">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-2xl font-bold text-slate-900">{formatINR(hotel.pricePerNight)}</p>
          <p className="text-sm text-slate-500">per night{hotel.priceSource === "estimated" ? " · estimated rate" : ""}</p>
        </div>
        <StarRating rating={hotel.starRating} source={hotel.starRatingSource} size="md" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <label className="rounded-lg border border-slate-300 px-3 py-2">
          <span className="flex items-center gap-1 text-xs font-semibold text-slate-500">
            <CalendarDays className="h-3.5 w-3.5" /> Check-in
          </span>
          <DatePicker
            selected={checkIn}
            onChange={(d: Date | null) => {
              if (!d) return;
              setCheckIn(d);
              if (checkOut <= d) setCheckOut(addDays(d, 1));
            }}
            minDate={startOfToday()}
            maxDate={addDays(startOfToday(), 365)}
            selectsStart
            startDate={checkIn}
            endDate={checkOut}
            dateFormat="d MMM yyyy"
            className="w-full text-sm font-medium focus:outline-none"
          />
        </label>
        <label className="rounded-lg border border-slate-300 px-3 py-2">
          <span className="flex items-center gap-1 text-xs font-semibold text-slate-500">
            <CalendarDays className="h-3.5 w-3.5" /> Check-out
          </span>
          <DatePicker
            selected={checkOut}
            onChange={(d: Date | null) => d && setCheckOut(d)}
            minDate={addDays(checkIn, 1)}
            maxDate={addDays(checkIn, 30)}
            selectsEnd
            startDate={checkIn}
            endDate={checkOut}
            dateFormat="d MMM yyyy"
            className="w-full text-sm font-medium focus:outline-none"
          />
        </label>
        <label className="rounded-lg border border-slate-300 px-3 py-2">
          <span className="flex items-center gap-1 text-xs font-semibold text-slate-500">
            <Users className="h-3.5 w-3.5" /> Adults
          </span>
          <select value={adults} onChange={(e) => setAdults(Number(e.target.value))} className="w-full bg-transparent text-sm font-medium focus:outline-none">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="rounded-lg border border-slate-300 px-3 py-2">
          <span className="flex items-center gap-1 text-xs font-semibold text-slate-500">
            <Users className="h-3.5 w-3.5" /> Children
          </span>
          <select value={children} onChange={(e) => setChildren(Number(e.target.value))} className="w-full bg-transparent text-sm font-medium focus:outline-none">
            {Array.from({ length: 7 }, (_, i) => i).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      {rooms > 1 && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Rooms here sleep up to {hotel.adultCount} adults — you may need {rooms} rooms. Mention it in your special requests.
        </p>
      )}
      <div className="mt-4 space-y-2 border-t border-slate-200 pt-4 text-sm">
        <div className="flex justify-between text-slate-600">
          <span>
            {formatINR(hotel.pricePerNight)} × {plural(nights, "night")}
          </span>
          <span>{formatINR(total)}</span>
        </div>
        <div className="flex justify-between text-base font-bold text-slate-900">
          <span>Total</span>
          <span>{formatINR(total)}</span>
        </div>
      </div>
      <button onClick={book} className="btn-primary mt-4 w-full py-3 text-base" disabled={nights < 1}>
        {isLoggedIn ? "Reserve now" : "Sign in to book"}
      </button>
      <p className="mt-2 text-center text-xs text-slate-500">
        {config?.payments.razorpay === false ? "Reserve now and pay at the hotel" : "Pay online with UPI or card, or pay at the hotel"}
      </p>
      {hotel.contact?.website && (
        <a href={hotel.contact.website} target="_blank" rel="noreferrer" className="btn-secondary mt-3 w-full">
          <Globe className="h-4 w-4" /> Official website <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
};

const Detail = () => {
  const { hotelId = "" } = useParams();
  const { showToast } = useAppContext();
  const { data: hotel, isLoading, isError, error, refetch } = useQuery(["hotel", hotelId], () => fetchHotelById(hotelId), { enabled: Boolean(hotelId) });
  const { data: similar } = useQuery(["similar", hotelId], () => fetchSimilarHotels(hotelId), { enabled: Boolean(hotel) });
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [routing, setRouting] = useState(false);

  if (isLoading) return <PageSpinner label="Loading hotel details..." />;
  if (isError || !hotel) {
    return (
      <div className="container-page py-16">
        <ErrorState message={(error as any)?.status === 404 ? "This hotel could not be found." : errorMessage(error, "Could not load this hotel")} onRetry={() => refetch()} />
        <div className="mt-6 text-center">
          <Link to="/search" className="btn-primary">
            Browse hotels
          </Link>
        </div>
      </div>
    );
  }

  const lat = hotel.location?.latitude;
  const lng = hotel.location?.longitude;
  const hasCoords = typeof lat === "number" && typeof lng === "number";
  const address = hotelAddress(hotel);
  const googleMapsUrl = hasCoords
    ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${hotel.name} ${address}`)}`;

  const getDirections = () => {
    if (!hasCoords) return;
    if (!navigator.geolocation) {
      showToast({ title: "Location not available", description: "Your browser does not support location. Opening Google Maps instead.", type: "info" });
      window.open(googleMapsUrl, "_blank");
      return;
    }
    setRouting(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const from: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        try {
          const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${lng},${lat}?overview=full&geometries=geojson`);
          const json = await res.json();
          const r = json.routes?.[0];
          if (!r) throw new Error("No route");
          setRoute({
            from,
            coords: r.geometry.coordinates.map(([x, y]: [number, number]) => [y, x]),
            distanceKm: Math.round(r.distance / 100) / 10,
            minutes: Math.round(r.duration / 60),
          });
        } catch {
          showToast({ title: "Couldn't calculate a driving route", description: "Opening Google Maps directions instead.", type: "info" });
          window.open(googleMapsUrl, "_blank");
        } finally {
          setRouting(false);
        }
      },
      () => {
        setRouting(false);
        showToast({ title: "Location permission denied", description: "Allow location access to see directions, or use Google Maps.", type: "error" });
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const details = [
    hotel.rooms ? { icon: BedDouble, label: "Rooms", value: String(hotel.rooms) } : null,
    hotel.brand ? { icon: Building, label: "Brand", value: hotel.brand } : null,
    hotel.policies?.checkInTime ? { icon: Clock, label: "Check-in", value: hotel.policies.checkInTime } : { icon: Clock, label: "Check-in", value: "From 12:00 (typical – confirm with hotel)" },
    hotel.policies?.checkOutTime ? { icon: Clock, label: "Check-out", value: hotel.policies.checkOutTime } : { icon: Clock, label: "Check-out", value: "By 11:00 (typical – confirm with hotel)" },
    { icon: Users, label: "Room capacity", value: `${plural(hotel.adultCount, "adult")}${hotel.childCount ? ` + ${plural(hotel.childCount, "child", "children")}` : ""}` },
  ].filter(Boolean) as { icon: typeof Clock; label: string; value: string }[];

  return (
    <div className="container-page py-6">
      <nav className="mb-4 flex items-center gap-1 text-sm text-slate-500" aria-label="Breadcrumb">
        <Link to="/" className="hover:text-slate-700">
          Home
        </Link>
        <ChevronRight className="h-4 w-4" />
        <Link to={`/search?destination=${encodeURIComponent(hotel.city)}`} className="hover:text-slate-700">
          {hotel.city}
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="truncate text-slate-700">{hotel.name}</span>
      </nav>

      <div className="mb-5 animate-fade-in">
        <div className="flex flex-wrap items-center gap-2">
          <StarRating rating={hotel.starRating} source={hotel.starRatingSource} size="md" />
          {hotel.starRatingSource === "official" && (
            <span className="chip bg-emerald-50 text-emerald-700">
              <BadgeCheck className="h-3.5 w-3.5" /> Official {hotel.starRating}-star
            </span>
          )}
          {hotel.type.map((t) => (
            <span key={t} className="chip bg-primary-50 text-primary-700">
              {t}
            </span>
          ))}
        </div>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">{hotel.name}</h1>
        <p className="mt-2 flex items-start gap-1.5 text-slate-600">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" /> {address}
        </p>
      </div>

      <ImageGallery hotel={hotel} />

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="space-y-8">
          <section className="card p-6">
            <h2 className="text-xl font-bold text-slate-900">About this property</h2>
            <p className="mt-3 whitespace-pre-line leading-relaxed text-slate-700">{hotel.description}</p>
            {hotel.descriptionSource === "wikipedia" && hotel.descriptionUrl && (
              <a href={hotel.descriptionUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-primary-600 hover:underline">
                Source: Wikipedia <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            <dl className="mt-6 grid gap-4 sm:grid-cols-2">
              {details.map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-start gap-3 rounded-xl bg-slate-50 p-3">
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" />
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
                    <dd className="text-sm font-medium text-slate-900">{value}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </section>

          <section className="card p-6">
            <h2 className="text-xl font-bold text-slate-900">Facilities</h2>
            {hotel.facilities.length ? (
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {hotel.facilities.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-slate-700">
                    <span className="rounded-full bg-emerald-50 p-1 text-emerald-600">
                      <Check className="h-4 w-4" />
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-slate-600">This property hasn't published its facilities yet. Contact the hotel to confirm Wi-Fi, parking and meals.</p>
            )}
            {(hotel.policies?.smokingPolicy || hotel.policies?.petPolicy || hotel.policies?.cancellationPolicy) && (
              <div className="mt-5 space-y-1 border-t border-slate-100 pt-4 text-sm text-slate-700">
                {hotel.policies?.cancellationPolicy && <p><span className="font-semibold">Cancellation:</span> {hotel.policies.cancellationPolicy}</p>}
                {hotel.policies?.smokingPolicy && <p><span className="font-semibold">Smoking:</span> {hotel.policies.smokingPolicy}</p>}
                {hotel.policies?.petPolicy && <p><span className="font-semibold">Pets:</span> {hotel.policies.petPolicy}</p>}
              </div>
            )}
          </section>

          <section className="card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-bold text-slate-900">Location & directions</h2>
              <div className="flex gap-2">
                {hasCoords && (
                  <button className="btn-primary" onClick={getDirections} disabled={routing}>
                    {routing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Route className="h-4 w-4" />} Directions from my location
                  </button>
                )}
                <a href={googleMapsUrl} target="_blank" rel="noreferrer" className="btn-secondary">
                  <Navigation className="h-4 w-4" /> Google Maps
                </a>
              </div>
            </div>
            {route && (
              <p className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary-50 px-3 py-2 text-sm font-medium text-primary-800 animate-fade-in">
                <Car className="h-4 w-4" /> {route.distanceKm} km by road · about {route.minutes >= 60 ? `${Math.floor(route.minutes / 60)} h ${route.minutes % 60} min` : `${route.minutes} min`}
              </p>
            )}
            {hasCoords ? (
              <Suspense fallback={<div className="skeleton mt-4 h-80 rounded-2xl" />}>
                <MapView
                  className="mt-4 h-80"
                  zoom={15}
                  center={[lat!, lng!]}
                  markers={[{ id: hotel._id, lat: lat!, lng: lng!, title: hotel.name, subtitle: address, price: hotel.pricePerNight }]}
                  userLocation={route?.from}
                  route={route?.coords}
                  activeId={hotel._id}
                />
              </Suspense>
            ) : (
              <p className="mt-3 text-sm text-slate-600">Map location is not available for this property.</p>
            )}
            <p className="mt-3 text-sm text-slate-600">{address}</p>
          </section>

          <section className="card p-6">
            <h2 className="text-xl font-bold text-slate-900">Contact the property</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {hotel.contact?.phone && (
                <a href={`tel:${hotel.contact.phone.replace(/\s/g, "")}`} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50">
                  <Phone className="h-5 w-5 text-primary-600" />
                  <span className="text-sm font-medium">{hotel.contact.phone}</span>
                </a>
              )}
              {hotel.contact?.email && (
                <a href={`mailto:${hotel.contact.email}`} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50">
                  <Mail className="h-5 w-5 text-primary-600" />
                  <span className="truncate text-sm font-medium">{hotel.contact.email}</span>
                </a>
              )}
              {hotel.contact?.website && (
                <a href={hotel.contact.website} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50">
                  <Globe className="h-5 w-5 text-primary-600" />
                  <span className="truncate text-sm font-medium">{hotel.contact.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</span>
                </a>
              )}
              {!hotel.contact?.phone && !hotel.contact?.email && !hotel.contact?.website && (
                <p className="text-sm text-slate-600">No public contact details have been published for this property.</p>
              )}
            </div>
            {hotel.paymentMethods && hotel.paymentMethods.length > 0 && (
              <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-slate-700">
                <CreditCard className="h-4 w-4 text-slate-500" /> Accepts at the property:
                {hotel.paymentMethods.map((m) => (
                  <span key={m} className="chip">
                    {m}
                  </span>
                ))}
              </p>
            )}
          </section>

          {hotel.sourceUrl && (
            <p className="text-xs text-slate-500">
              Listing data:{" "}
              <a href={hotel.sourceUrl} target="_blank" rel="noreferrer" className="underline hover:text-slate-700">
                OpenStreetMap
              </a>{" "}
              contributors (ODbL).{hotel.priceSource === "estimated" ? " The nightly price is an estimate for this category of hotel in this city." : ""}
              {hotel.starRatingSource === "estimated" ? " Star category is estimated." : ""}
            </p>
          )}
        </div>

        <aside>
          <div className="sticky top-24">
            <BookingWidget hotel={hotel} />
          </div>
        </aside>
      </div>

      {similar && similar.length > 0 && (
        <section className="mt-14">
          <h2 className="section-title">More stays in {hotel.city}</h2>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {similar.map((h) => (
              <HotelCard key={h._id} hotel={h} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default Detail;
