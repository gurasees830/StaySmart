import { useEffect, useMemo, useState } from "react";
import { Building2 } from "lucide-react";
import { cn, displayableImages, isGooglePhoto, thumbUrl } from "../lib/utils";

type HotelImageProps = {
  urls: string[];
  alt: string;
  size?: "card" | "full";
  className?: string;
  imgClassName?: string;
  start?: number;
  onResolvedIndex?: (index: number) => void;
  eager?: boolean;
};

/**
 * Shows the first image of `urls` that actually loads. For each URL it tries
 * the resized version first, then the original, then moves on to the next
 * photo; if nothing loads it shows a neutral placeholder instead of a broken
 * image icon.
 */
const HotelImage = ({ urls, alt, size = "card", className, imgClassName, start = 0, onResolvedIndex, eager }: HotelImageProps) => {
  const candidates = useMemo(() => {
    const list: { src: string; index: number }[] = [];
    const ordered = [...urls.slice(start), ...urls.slice(0, start)];
    const allowed = new Set(displayableImages(urls));
    ordered.forEach((url, i) => {
      if (!url || !allowed.has(url)) return;
      const index = (i + start) % urls.length;
      const resized = thumbUrl(url, size);
      list.push({ src: resized, index });
      // Google photos have no "original" to fall back to.
      if (resized !== url && !isGooglePhoto(url)) list.push({ src: url, index });
    });
    return list;
  }, [urls, size, start]);

  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setAttempt(0);
    setLoaded(false);
  }, [candidates]);

  const current = candidates[attempt];

  if (!current) {
    return (
      <div className={cn("flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200", className)} role="img" aria-label={`${alt} (no photo available)`}>
        <div className="flex flex-col items-center gap-1 text-slate-400">
          <Building2 className="h-10 w-10" />
          <span className="text-xs font-medium">Photo not available</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden bg-slate-200", className)}>
      {!loaded && <div className="absolute inset-0 animate-pulse bg-slate-200" />}
      <img
        key={current.src}
        src={current.src}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        referrerPolicy="no-referrer"
        className={cn("h-full w-full object-cover transition-opacity duration-300", loaded ? "opacity-100" : "opacity-0", imgClassName)}
        onLoad={(e) => {
          // Some hosts answer with a 1x1 pixel instead of an error.
          if ((e.currentTarget.naturalWidth || 0) < 40) {
            setAttempt((a) => a + 1);
            return;
          }
          setLoaded(true);
          onResolvedIndex?.(current.index);
        }}
        onError={() => {
          setLoaded(false);
          setAttempt((a) => a + 1);
        }}
      />
    </div>
  );
};

export default HotelImage;
