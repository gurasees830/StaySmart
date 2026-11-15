import { useState } from "react";
import { Link } from "react-router-dom";
import { Camera, CheckCircle2, MapPin, Navigation } from "lucide-react";
import type { Hotel } from "../types";
import { cn, formatINR, googlePhotoIndex, isGooglePhoto, shortPlace } from "../lib/utils";
import HotelImage from "./HotelImage";
import StarRating from "./StarRating";
import GoogleAttribution from "./GoogleAttribution";

export const PhotoBadge = ({ hotel, className }: { hotel: Hotel; className?: string }) => {
  if (hotel.imageSource === "property" || hotel.imageSource === "mixed") {
    return (
      <span className={cn("inline-flex items-center gap-1 rounded-full bg-emerald-600/90 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur", className)}>
        <CheckCircle2 className="h-3 w-3" /> Property photos
      </span>
    );
  }
  if (hotel.imageSource === "representative") {
    return (
      <span
        className={cn("inline-flex items-center gap-1 rounded-full bg-slate-900/60 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur", className)}
        title="This property has not published photos yet. The image shows a similar hotel."
      >
        <Camera className="h-3 w-3" /> Representative photo
      </span>
    );
  }
  return null;
};

export const PriceTag = ({ hotel, compact = false }: { hotel: Hotel; compact?: boolean }) => (
  <div className="text-right">
    {!compact && <p className="text-xs text-slate-500">{hotel.priceSource === "estimated" ? "Est. from" : "From"}</p>}
    <p className="text-xl font-bold text-slate-900">{formatINR(hotel.pricePerNight)}</p>
    <p className="text-xs text-slate-500">per night</p>
  </div>
);

type Props = { hotel: Hotel; variant?: "list" | "grid"; className?: string };

const HotelCard = ({ hotel, variant = "grid", className }: Props) => {
  const href = `/detail/${hotel._id}`;
  const place = shortPlace(hotel);
  const [shown, setShown] = useState(-1);
  const shownUrl = hotel.imageUrls?.[shown];
  // Google requires the photo's author + "Google Maps" next to Places photos.
  const googleCredit = isGooglePhoto(shownUrl) ? (
    <GoogleAttribution hotelId={hotel._id} photoIndex={googlePhotoIndex(shownUrl)} className="absolute bottom-2 left-2" />
  ) : null;

  if (variant === "list") {
    return (
      <article className={cn("card group flex flex-col overflow-hidden transition hover:shadow-medium sm:flex-row", className)}>
        <div className="relative sm:w-72 sm:shrink-0">
          <Link to={href} className="block h-full" aria-label={hotel.name}>
            <HotelImage urls={hotel.imageUrls || []} alt={hotel.name} onResolvedIndex={setShown} className="h-52 w-full sm:h-full sm:min-h-[220px]" imgClassName="transition duration-500 group-hover:scale-105" />
          </Link>
          <PhotoBadge hotel={hotel} className="pointer-events-none absolute left-3 top-3" />
          {googleCredit}
        </div>
        <div className="flex flex-1 flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StarRating rating={hotel.starRating} source={hotel.starRatingSource} showLabel />
                {hotel.type?.slice(0, 2).map((t) => (
                  <span key={t} className="chip bg-primary-50 text-primary-700">
                    {t}
                  </span>
                ))}
              </div>
              <h3 className="mt-1.5 text-lg font-bold leading-snug text-slate-900">
                <Link to={href} className="hover:text-primary-700">
                  {hotel.name}
                </Link>
              </h3>
              <p className="mt-1 flex items-center gap-1 text-sm text-slate-600">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="truncate">{place}</span>
                {typeof hotel.distanceKm === "number" && (
                  <span className="ml-1 inline-flex items-center gap-0.5 whitespace-nowrap text-primary-700">
                    <Navigation className="h-3 w-3" /> {hotel.distanceKm} km
                  </span>
                )}
              </p>
            </div>
            <div className="hidden sm:block">
              <PriceTag hotel={hotel} />
            </div>
          </div>
          <p className="line-clamp-2 text-sm leading-relaxed text-slate-600">{hotel.description}</p>
          {hotel.facilities?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {hotel.facilities.slice(0, 4).map((f) => (
                <span key={f} className="chip">
                  {f}
                </span>
              ))}
              {hotel.facilities.length > 4 && <span className="chip">+{hotel.facilities.length - 4} more</span>}
            </div>
          )}
          <div className="mt-auto flex items-end justify-between gap-3 pt-1">
            <div className="sm:hidden">
              <PriceTag hotel={hotel} compact />
            </div>
            <Link to={href} className="btn-primary ml-auto">
              View details
            </Link>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className={cn("card group flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-medium", className)}>
      <div className="relative">
        <Link to={href} className="block" aria-label={hotel.name}>
          <HotelImage urls={hotel.imageUrls || []} alt={hotel.name} onResolvedIndex={setShown} className="aspect-[4/3] w-full" imgClassName="transition duration-500 group-hover:scale-105" />
        </Link>
        <PhotoBadge hotel={hotel} className="pointer-events-none absolute left-3 top-3" />
        {googleCredit}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <StarRating rating={hotel.starRating} source={hotel.starRatingSource} />
        <h3 className="mt-1.5 line-clamp-1 font-bold text-slate-900">
          <Link to={href} className="hover:text-primary-700">
            {hotel.name}
          </Link>
        </h3>
        <p className="mt-0.5 line-clamp-1 flex items-center gap-1 text-sm text-slate-600">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" /> {place}
        </p>
        <div className="mt-auto flex items-end justify-between pt-4">
          <div>
            <span className="text-lg font-bold text-slate-900">{formatINR(hotel.pricePerNight)}</span>
            <span className="text-xs text-slate-500"> / night{hotel.priceSource === "estimated" ? " (est.)" : ""}</span>
          </div>
          <Link to={href} className="text-sm font-semibold text-primary-600 hover:text-primary-700">
            View →
          </Link>
        </div>
      </div>
    </article>
  );
};

export const HotelCardSkeleton = ({ variant = "grid" }: { variant?: "list" | "grid" }) =>
  variant === "list" ? (
    <div className="card flex flex-col overflow-hidden sm:flex-row">
      <div className="skeleton h-52 rounded-none sm:h-auto sm:w-72" />
      <div className="flex-1 space-y-3 p-5">
        <div className="skeleton h-4 w-32" />
        <div className="skeleton h-6 w-2/3" />
        <div className="skeleton h-4 w-1/2" />
        <div className="skeleton h-12 w-full" />
      </div>
    </div>
  ) : (
    <div className="card overflow-hidden">
      <div className="skeleton aspect-[4/3] rounded-none" />
      <div className="space-y-2 p-4">
        <div className="skeleton h-4 w-24" />
        <div className="skeleton h-5 w-3/4" />
        <div className="skeleton h-4 w-1/2" />
      </div>
    </div>
  );

export default HotelCard;
