import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
export const formatINR = (value: number | undefined | null) => inr.format(Math.round(Number(value) || 0));

export const formatNumber = (value: number) => new Intl.NumberFormat("en-IN").format(value || 0);

export const formatDate = (value: string | Date | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) => {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", opts);
};

/** yyyy-mm-dd in local time (what date inputs and the API expect). */
export const toDateKey = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const fromDateKey = (key?: string | null) => {
  if (!key) return null;
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const addDays = (d: Date, days: number) => {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
};

export const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export const nightsBetween = (checkIn?: Date | null, checkOut?: Date | null) => {
  if (!checkIn || !checkOut) return 0;
  const a = Date.UTC(checkIn.getFullYear(), checkIn.getMonth(), checkIn.getDate());
  const b = Date.UTC(checkOut.getFullYear(), checkOut.getMonth(), checkOut.getDate());
  return Math.max(0, Math.round((b - a) / 86400000));
};

export const plural = (n: number, word: string, pluralWord = `${word}s`) => `${n} ${n === 1 ? word : pluralWord}`;

export const hotelAddress = (hotel: { city?: string; location?: { address?: { street?: string; locality?: string; state?: string; zipCode?: string } } }) => {
  const a = hotel.location?.address || {};
  return [a.street, a.locality, hotel.city, a.state, a.zipCode].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(", ");
};

export const shortPlace = (hotel: { city?: string; location?: { address?: { locality?: string; state?: string } } }) => {
  const a = hotel.location?.address || {};
  return [a.locality, hotel.city, a.state].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(", ");
};

/**
 * Smaller version of an image for cards. Wikimedia only serves standard
 * thumbnail widths (330/500/960/1280); other widths fail with HTTP 400.
 */
// ---- Google Maps photos (served live by the API at /api/gphoto/<hotelId>/<n>)
let googlePhotosEnabled = true;
export const setGooglePhotosEnabled = (enabled: boolean) => {
  googlePhotosEnabled = enabled;
};
export const isGooglePhoto = (url?: string) => Boolean(url && url.startsWith("/api/gphoto/"));
export const googlePhotoIndex = (url?: string) => (isGooglePhoto(url) ? Number(url!.split("/").pop()) : -1);
/** Image list to try, without Google photos when this month's photo budget is used up. */
export const displayableImages = (urls: string[]) => (googlePhotosEnabled ? urls : urls.filter((u) => !isGooglePhoto(u)));
/** Google's terms forbid showing Places photos on a non-Google map (ours is OpenStreetMap). */
export const mapSafeImage = (urls?: string[]) => (urls || []).find((u) => !isGooglePhoto(u));

export const thumbUrl = (url: string | undefined, size: "card" | "full" = "card") => {
  if (!url) return "";
  if (isGooglePhoto(url)) {
    // One size for every use, so the browser re-uses the cached redirect and
    // each photo is fetched (and billed) once rather than once per size.
    const base = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
    return `${base}${url}?w=1024`;
  }
  // Self-hosted media (/media/wm/<key>.jpg with a <key>_500.jpg card copy).
  if (url.startsWith("/media/") || url.startsWith("/uploads/")) {
    const base = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
    const sized = size === "card" && /^\/media\/wm\/[a-f0-9]+\.jpg$/.test(url) ? url.replace(/\.jpg$/, "_500.jpg") : url;
    return `${base}${sized}`;
  }
  if (/upload\.wikimedia\.org|thumb\.wikimedia\.org/.test(url) && /\/\d+px-/.test(url)) {
    return url.replace(/\/\d+px-/, size === "card" ? "/500px-" : "/1280px-");
  }
  if (/images\.unsplash\.com/.test(url)) {
    return url.replace(/([?&])w=\d+/, `$1w=${size === "card" ? 720 : 1600}`);
  }
  if (/staticflickr\.com/.test(url) && size === "card") {
    return url.replace(/_b\.jpg$/, "_z.jpg");
  }
  if (/res\.cloudinary\.com/.test(url)) {
    return size === "card" ? url.replace("/upload/", "/upload/w_720,c_fill,q_auto,f_auto/") : url;
  }
  if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || /staticflickr\.com|images\.unsplash\.com|wikimedia\.org/.test(url)) {
    return url;
  }
  // Photos from hotels' own websites go through the backend's caching proxy,
  // which survives hotlink protection and burst rate limits on those sites.
  if (/^https?:\/\//.test(url)) {
    const base = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
    return `${base}/img?u=${encodeURIComponent(url)}`;
  }
  return url;
};

export const errorMessage = (error: unknown, fallback = "Something went wrong") =>
  error instanceof Error && error.message ? error.message : fallback;

export const initials = (first?: string, last?: string) =>
  `${(first || "").charAt(0)}${(last || "").charAt(0)}`.toUpperCase() || "U";
