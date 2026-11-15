import mongoose from "mongoose";

/**
 * Google Places API (New) helpers.
 *
 * Google's terms allow storing only the place ID; photos and their author
 * attributions are fetched live for every display (nothing is cached here
 * beyond de-duplicating identical in-flight requests).
 *
 * Billing (per Google's pricing page):
 *   - Place Details with field mask `photos` only -> "Place Details Essentials
 *     (IDs Only)": free, unlimited.
 *   - Photo media (/v1/{photo}/media) -> "Place Details Photos": 1,000 free per
 *     month, then $7 / 1,000. Guarded by PLACES_PHOTO_MONTHLY_LIMIT.
 */

const API = "https://places.googleapis.com/v1";
const key = () => process.env.GOOGLE_PLACES_API_KEY || "";
export const isPlacesConfigured = () => Boolean(key());

export type GooglePhoto = {
  name: string;
  widthPx: number;
  heightPx: number;
  authorAttributions?: { displayName?: string; uri?: string; photoUri?: string }[];
  googleMapsUri?: string;
};

const monthKey = (sku: string) => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}:${sku}`;
};

/** Atomically counts one billable call; false when this month's limit is used up. */
export async function consumeBudget(sku: string, limit: number): Promise<boolean> {
  const col = mongoose.connection.collection("googleusage");
  const id = monthKey(sku);
  const updated = await col.findOneAndUpdate({ _id: id as any, count: { $lt: limit } }, { $inc: { count: 1 } }, { returnDocument: "after" });
  if (updated) return true;
  try {
    await col.insertOne({ _id: id as any, count: 1 });
    return limit > 0;
  } catch {
    // Exists already and is at the limit (or a concurrent insert won the race).
    const retry = await col.findOneAndUpdate({ _id: id as any, count: { $lt: limit } }, { $inc: { count: 1 } }, { returnDocument: "after" });
    return Boolean(retry);
  }
}

export async function usageThisMonth() {
  const col = mongoose.connection.collection("googleusage");
  const prefix = monthKey("").replace(/:$/, "");
  const docs = await col.find({ _id: { $regex: `^${prefix}:` } as any }).toArray();
  return Object.fromEntries(docs.map((d: any) => [String(d._id).split(":")[1], d.count]));
}

const inFlight = new Map<string, Promise<GooglePhoto[]>>();

/** Live photo list for a place (free IDs-only Place Details call). */
export function getPlacePhotos(placeId: string): Promise<GooglePhoto[]> {
  if (!isPlacesConfigured() || !/^[A-Za-z0-9_-]{10,}$/.test(placeId)) return Promise.resolve([]);
  const existing = inFlight.get(placeId);
  if (existing) return existing;
  const promise = (async () => {
    const res = await fetch(`${API}/places/${placeId}`, {
      headers: { "X-Goog-Api-Key": key(), "X-Goog-FieldMask": "photos" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const json: any = await res.json();
    return Array.isArray(json.photos) ? (json.photos as GooglePhoto[]) : [];
  })()
    .catch(() => [] as GooglePhoto[])
    .finally(() => setTimeout(() => inFlight.delete(placeId), 500));
  inFlight.set(placeId, promise);
  return promise;
}

/** Short-lived image URL for one photo (billable, budget-guarded). */
export async function getPhotoUri(photoName: string, maxWidthPx: number): Promise<string | null> {
  const limit = Number(process.env.PLACES_PHOTO_MONTHLY_LIMIT ?? 950);
  if (!(await consumeBudget("photo", limit))) return null;
  const width = Math.min(Math.max(Math.round(maxWidthPx), 100), 1600);
  const res = await fetch(`${API}/${photoName}/media?maxWidthPx=${width}&skipHttpRedirect=true`, {
    headers: { "X-Goog-Api-Key": key() },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const json: any = await res.json();
  return typeof json.photoUri === "string" ? json.photoUri : null;
}
