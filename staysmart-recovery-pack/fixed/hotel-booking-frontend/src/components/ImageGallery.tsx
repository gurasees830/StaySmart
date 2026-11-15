import { useCallback, useEffect, useMemo, useState } from "react";
import { Camera, CheckCircle2, ChevronLeft, ChevronRight, Expand, X } from "lucide-react";
import type { Hotel, ImageCredit } from "../types";
import { cn, displayableImages, googlePhotoIndex, isGooglePhoto, thumbUrl } from "../lib/utils";
import HotelImage from "./HotelImage";
import GoogleAttribution from "./GoogleAttribution";

const CreditLine = ({ credit }: { credit?: ImageCredit }) => {
  if (!credit) return null;
  const parts = [credit.author && `Photo: ${credit.author}`, credit.license, credit.source].filter(Boolean);
  return (
    <p className="truncate text-xs text-slate-500">
      {credit.pageUrl ? (
        <a href={credit.pageUrl} target="_blank" rel="noreferrer" className="hover:text-slate-700 hover:underline">
          {parts.join(" · ")}
        </a>
      ) : (
        parts.join(" · ")
      )}
    </p>
  );
};

const ImageGallery = ({ hotel }: { hotel: Hotel }) => {
  // Keep each photo's credit aligned with it, and drop Google photos when this
  // month's Google photo budget is used up.
  const items = useMemo(() => {
    const allowed = new Set(displayableImages(hotel.imageUrls || []));
    return (hotel.imageUrls || []).map((url, i) => ({ url, credit: hotel.imageCredits?.[i] })).filter((x) => allowed.has(x.url));
  }, [hotel.imageUrls, hotel.imageCredits]);
  const urls = useMemo(() => items.map((x) => x.url), [items]);
  const credits = items.map((x) => x.credit);
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const count = urls.length;

  const go = useCallback((delta: number) => setIndex((i) => (count ? (i + delta + count) % count : 0)), [count]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "Escape") setLightbox(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [lightbox, go]);

  const credit = credits[index];
  const isRepresentative = credit?.kind === "representative";
  const currentUrl = urls[index];
  const creditLine = isGooglePhoto(currentUrl) ? (
    <GoogleAttribution variant="line" hotelId={hotel._id} photoIndex={googlePhotoIndex(currentUrl)} />
  ) : (
    <CreditLine credit={credit} />
  );

  return (
    <div className="space-y-3">
      <div className="group relative overflow-hidden rounded-2xl bg-slate-200">
        <HotelImage urls={urls} start={index} alt={`${hotel.name} photo ${index + 1}`} size="full" eager className="aspect-[16/9] w-full sm:aspect-[2/1]" />
        {count > 0 && (
          <>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/50 to-transparent" />
            <div className="absolute left-4 top-4 flex flex-wrap gap-2">
              {isRepresentative ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-900/70 px-3 py-1 text-xs font-medium text-white backdrop-blur" title="This property has not published photos; this is a real photo of a similar hotel.">
                  <Camera className="h-3.5 w-3.5" /> Representative photo
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600/90 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Photo of this property
                </span>
              )}
            </div>
            <button
              onClick={() => setLightbox(true)}
              className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow hover:bg-white"
            >
              <Expand className="h-3.5 w-3.5" /> View all {count} photos
            </button>
            {count > 1 && (
              <>
                <button onClick={() => go(-1)} className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 text-slate-800 opacity-0 shadow transition group-hover:opacity-100" aria-label="Previous photo">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button onClick={() => go(1)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 text-slate-800 opacity-0 shadow transition group-hover:opacity-100" aria-label="Next photo">
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            )}
            <span className="absolute bottom-4 right-4 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white">
              {index + 1} / {count}
            </span>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="scrollbar-thin flex gap-2 overflow-x-auto pb-1">
          {urls.map((url, i) => (
            <button
              key={url + i}
              onClick={() => setIndex(i)}
              className={cn("relative h-16 w-24 shrink-0 overflow-hidden rounded-lg ring-2 transition sm:h-20 sm:w-32", i === index ? "ring-primary-600" : "ring-transparent opacity-80 hover:opacity-100")}
              aria-label={`Show photo ${i + 1}`}
            >
              <img src={thumbUrl(url, "card")} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-0.5">
        {creditLine}
        {isRepresentative && (
          <p className="text-xs text-amber-700">This property hasn't published photos yet, so we show real photos of similar hotels. Check the property's own website for its rooms.</p>
        )}
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-[90] flex flex-col bg-black/95 animate-fade-in" role="dialog" aria-label={`${hotel.name} photos`}>
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <p className="truncate text-sm font-medium">
              {hotel.name} · {index + 1} / {count}
            </p>
            <button onClick={() => setLightbox(false)} className="rounded-full p-2 hover:bg-white/10" aria-label="Close photos">
              <X className="h-6 w-6" />
            </button>
          </div>
          <div className="relative flex flex-1 items-center justify-center px-4">
            <img key={urls[index]} src={thumbUrl(urls[index], "full")} alt={`${hotel.name} photo ${index + 1}`} referrerPolicy="no-referrer" className="max-h-[78vh] max-w-full rounded-lg object-contain animate-scale-in" />
            {count > 1 && (
              <>
                <button onClick={() => go(-1)} className="absolute left-4 rounded-full bg-white/10 p-3 text-white hover:bg-white/20" aria-label="Previous photo">
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button onClick={() => go(1)} className="absolute right-4 rounded-full bg-white/10 p-3 text-white hover:bg-white/20" aria-label="Next photo">
                  <ChevronRight className="h-6 w-6" />
                </button>
              </>
            )}
          </div>
          <div className="px-4 py-3 text-center [&_p]:text-slate-300">
            {creditLine}
            {isRepresentative && <p className="text-xs">Representative photo of a similar hotel</p>}
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageGallery;
