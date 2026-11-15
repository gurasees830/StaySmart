/**
 * Match StaySmart hotels to their Google Maps listing so the app can show the
 * hotel's real photos (fetched live; see src/routes/google-photos.ts).
 *
 * For each hotel that has no photos of its own yet:
 *   1. Places Autocomplete (New) near the hotel's coordinates. A suggestion is
 *      accepted only if it is a lodging, its name matches ours, and it lies
 *      within a short distance of our location ("Jai Mahal Palace" must not
 *      match "Hotel Jai Maa Palace" next door).
 *   2. Place Details with field mask `photos` (free) to see whether Google has
 *      photos of it.
 * Only the place ID (+ how many photos it has) is stored - Google's terms
 * allow storing place IDs, not photos.
 *
 * Billing: Autocomplete Requests = 10,000 free / month, then $2.83 / 1,000.
 * The script stops at PLACES_MATCH_MONTHLY_LIMIT (default 9,000) and resumes
 * next month (or after you raise the limit).
 *
 * Usage: node scripts/match-google-places.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { MongoClient } = require("mongodb");

const KEY = process.env.GOOGLE_PLACES_API_KEY;
const LIMIT = Number(process.env.PLACES_MATCH_MONTHLY_LIMIT ?? 9000);
const API = "https://places.googleapis.com/v1";
if (!KEY) {
  console.error("GOOGLE_PLACES_API_KEY is not set in .env");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) =>
  String(s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const GENERIC = new Set(
  (
    "hotel hotels the and by of at in a an de la le n inn inns resort resorts spa lodge lodging guest house guesthouse home homes " +
    "homestay stay stays residency residence rooms room suites suite boutique international grand deluxe luxury comforts comfort premier " +
    "premium executive regency plaza new hostel villa villas cottage cottages tourist bungalow camp camps retreat india indian " +
    "collection o oyo townhouse treebo trend fabhotel fab capital flagship spot on silverkey super hotel's pvt ltd private limited annex annexe " +
    "near opp opposite road marg station airport"
  ).split(" ")
);
const LODGING = /(lodging|hotel|motel|hostel|guest_house|bed_and_breakfast|inn|resort|campground|cottage|farmstay|extended_stay)/;

const lev = (a, b) => {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1)
    for (let j = 1; j <= b.length; j += 1)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
};
const tokenMatch = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && lev(a, b) <= (a.length >= 7 ? 2 : 1));

function coreTokens(name, placeWords) {
  return norm(name.split(",")[0])
    .split(" ")
    .filter((t) => t && !GENERIC.has(t) && !placeWords.has(t) && !/^\d+$/.test(t));
}

/** 0..1 share of our distinctive name tokens found in Google's name. */
function nameScore(ours, theirs) {
  if (!ours.length) return 0;
  if (ours.join("") === theirs.join("")) return 1; // "lakeview" vs "lake view"
  const hits = ours.filter((t) => theirs.some((u) => tokenMatch(t, u))).length;
  return hits / ours.length;
}

async function consume(col, sku, limit) {
  const d = new Date();
  const id = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}:${sku}`;
  const updated = await col.findOneAndUpdate({ _id: id, count: { $lt: limit } }, { $inc: { count: 1 } }, { returnDocument: "after" });
  if (updated) return true;
  try {
    await col.insertOne({ _id: id, count: 1 });
    return limit > 0;
  } catch {
    return Boolean(await col.findOneAndUpdate({ _id: id, count: { $lt: limit } }, { $inc: { count: 1 } }, { returnDocument: "after" }));
  }
}

async function google(path, { method = "GET", body, fieldMask } = {}) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": KEY, ...(fieldMask ? { "X-Goog-FieldMask": fieldMask } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: { message: e.message } }) }));
    if (res.status === 429 || res.status >= 500 || res.status === 0) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    const json = await res.json();
    if (!res.ok) {
      const err = new Error(json?.error?.message || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return json;
  }
  throw new Error("Google Places API unavailable");
}

const priority = (h, cityCounts) =>
  (h.starRatingSource === "official" ? 3 : 0) +
  h.starRating +
  (h.contact && h.contact.website ? 1.5 : 0) +
  (h.contact && h.contact.phone ? 0.5 : 0) +
  Math.min(2, Math.log10((cityCounts.get(h.city) || 1) + 1));

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_CONNECTION_STRING);
  const db = client.db();
  const hotelsCol = db.collection("hotels");
  const usage = db.collection("googleusage");

  const all = await hotelsCol
    .find(
      { imageSource: { $in: ["representative", "none", "pending"] }, googleMatch: { $exists: false }, "location.latitude": { $exists: true } },
      { projection: { name: 1, city: 1, starRating: 1, starRatingSource: 1, contact: 1, location: 1 } }
    )
    .toArray();
  const cityCounts = new Map();
  for (const h of all) cityCounts.set(h.city, (cityCounts.get(h.city) || 0) + 1);
  all.sort((a, b) => priority(b, cityCounts) - priority(a, cityCounts));
  const sample = Number(process.env.GOOGLE_MATCH_SAMPLE || 0);
  if (sample) all.splice(sample);
  console.log(`[google] ${all.length} hotels without their own photos to match (monthly limit ${LIMIT})`);

  let done = 0;
  let matched = 0;
  let withPhotos = 0;
  let stopped = false;
  let index = 0;

  const worker = async () => {
    while (!stopped && index < all.length) {
      const h = all[index++];
      if (!(await consume(usage, "autocomplete", LIMIT))) {
        if (!stopped) console.log("\n[google] monthly matching limit reached - re-run next month or raise PLACES_MATCH_MONTHLY_LIMIT");
        stopped = true;
        return;
      }
      const lat = h.location.latitude;
      const lng = h.location.longitude;
      const placeWords = new Set(norm([h.city, h.location.address && h.location.address.locality, h.location.address && h.location.address.state].filter(Boolean).join(" ")).split(" "));
      const ours = coreTokens(h.name, placeWords);
      const update = { googleMatchedAt: new Date(), googleMatch: "no-match" };
      try {
        if (ours.length) {
          const json = await google("/places:autocomplete", {
            method: "POST",
            body: {
              input: h.name.split(",")[0],
              locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 3000 } },
              origin: { latitude: lat, longitude: lng },
              includedRegionCodes: ["in"],
              languageCode: "en",
            },
          });
          let best = null;
          for (const s of json.suggestions || []) {
            const p = s.placePrediction;
            if (!p || !p.placeId || !LODGING.test((p.types || []).join(" "))) continue;
            const theirs = coreTokens((p.structuredFormat && p.structuredFormat.mainText && p.structuredFormat.mainText.text) || p.text.text, placeWords);
            const score = nameScore(ours, theirs);
            const dist = typeof p.distanceMeters === "number" ? p.distanceMeters : 99999;
            const single = ours.length === 1;
            const ok =
              score >= 0.66 &&
              (single ? ours[0].length >= 4 && dist <= 600 && theirs.length <= 2 : dist <= (score === 1 ? 3000 : 1500));
            if (ok && (!best || score > best.score || (score === best.score && dist < best.dist))) {
              best = { placeId: p.placeId, score, dist, label: p.text && p.text.text };
            }
          }
          if (sample) {
            console.log(`  ${h.name} (${h.city}) -> ${best ? `${best.label} [score ${best.score.toFixed(2)}, ${best.dist} m]` : `no match (${(json.suggestions || []).length} suggestions)`}`);
          }
          if (best) {
            matched += 1;
            const details = await google(`/places/${best.placeId}`, { fieldMask: "photos" });
            const count = Array.isArray(details.photos) ? details.photos.length : 0;
            Object.assign(update, { googlePlaceId: best.placeId, googlePhotoCount: count, googleMatch: count ? "matched" : "no-photos" });
            if (count) withPhotos += 1;
          }
        } else {
          update.googleMatch = "generic-name";
        }
      } catch (error) {
        if (error.status === 403 || /api key|not enabled|permission|billing/i.test(error.message)) {
          console.error(`\n[google] API error: ${error.message}`);
          stopped = true;
          return;
        }
        update.googleMatch = "error";
      }
      await hotelsCol.updateOne({ _id: h._id }, { $set: update });
      done += 1;
      if (done % 100 === 0) process.stdout.write(`\r[google] ${done}/${all.length} checked, ${matched} matched, ${withPhotos} with photos`);
    }
  };

  await Promise.all(Array.from({ length: 6 }, worker));
  console.log(`\n[google] checked ${done}, matched ${matched}, with photos ${withPhotos}`);
  await client.close();
}

main().catch((e) => {
  console.error("Google matching failed:", e);
  process.exit(1);
});
