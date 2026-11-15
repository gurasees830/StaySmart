# StaySmart — start here

## Run it

Double-click **`start-staysmart.bat`** in `C:\staysmart-hotel-dhundo-wroking\`. It starts:

| Service | Address | Notes |
|---|---|---|
| Website | http://localhost:5174 | Vite dev server; proxies `/api`, `/media`, `/uploads`, `/img` to the API |
| API | http://localhost:5001 | Express + TypeScript (`/api/health`, Swagger at `/api-docs`) |
| Database | 127.0.0.1:27017 | Local MongoDB 8.0 from `tools\mongodb`, data in `mongodb-data\` |

Stop everything with **`stop-staysmart.bat`**. Logs are in `logs\` (`backend.log`, `frontend.log`, `mongod.log`).

Manual start (two terminals): `npm run dev` in `hotel-booking-backend`, then `npm run dev` in `hotel-booking-frontend`.

## Why the database is local

The old Atlas cluster (`matrimonialcluster0.c1lihkg.mongodb.net`) no longer exists — its DNS name returns
"name does not exist" from public resolvers. The app now uses a local MongoDB. To go back to Atlas, create a
cluster, put its connection string in `hotel-booking-backend/.env` (`MONGODB_CONNECTION_STRING`) and run
`npm run seed` in the backend to load the hotels into it.

## The data (all real)

`npm run import:hotels` (backend) loads **13,861 hotels** from `export.geojson` (OpenStreetMap, India):

* Real: name, map location, street/postcode, phone, email, website, brand, room count, amenities that OSM
  records, official star rating where published (352 hotels), Wikipedia descriptions for notable hotels.
* City, area and state are worked out from the coordinates with the GeoNames gazetteer (`data/geonames`),
  so every hotel has a correct city (NCR hotels in Noida/Gurugram are no longer filed under Delhi).
* Estimated and labelled as such in the UI: nightly price ("Est.") and the star category when OSM has none.
* No invented reviews or ratings.

## The photos

`npm run images:fetch` (backend) runs `scripts/fetch-hotel-images.js`. Stages can be run one at a time,
e.g. `node scripts/fetch-hotel-images.js pool assign`; every stage caches its work in `data/image-cache`.

| Stage | What it does |
|---|---|
| `wikidata` | Photos + Wikipedia text for hotels linked to Wikidata |
| `commons` | Geotagged Wikimedia Commons photos near each hotel whose file name contains the hotel's name |
| `websites` | Photos from the hotel's official website (verified, chain banners removed) |
| `pool` | Real hotel photography (Unsplash + Wikimedia) used, labelled "Representative photo", when a hotel has published none |
| `cities` | Wikipedia photos and summaries for the top destinations |
| `assign` | Writes photos to MongoDB: property photos first; no two hotels in one city share a main photo |
| `media` | Downloads the Wikimedia photos in use and serves them from `/media` (no dependence on Wikimedia's rate limits) |

Hotel-website photos are fetched once through the API's cached `/img` proxy (survives hotlink protection).

### Google Maps photos (Places API)

`npm run google:match` matches hotels that have no photos of their own to their Google Maps listing
(Autocomplete near the hotel; accepted only when the name matches and the listing is a lodging within
~1.5 km) and then re-assigns photos. Matched hotels show up to 4 real Google photos.

* Google's terms allow storing **only the place ID**. Photos are fetched live by the API
  (`/api/gphoto/<hotelId>/<n>`) and shown with the photographer's name and "Google Maps"; they are never
  shown on the OpenStreetMap map (Google forbids Places content on non-Google maps).
* Cost guard (`hotel-booking-backend/.env`): `PLACES_MATCH_MONTHLY_LIMIT=9000` (Autocomplete: 10,000 free per
  month, then $2.83 / 1,000) and `PLACES_PHOTO_MONTHLY_LIMIT=950` (photo downloads: 1,000 free per month, then
  $7 / 1,000). When the photo limit is reached the site falls back to the other photos until next month.
  Usage this month: http://localhost:5001/api/gphoto/usage
* Matching resumes where it stopped: re-run `npm run google:match` next month for the remaining hotels.
* Restrict the key in Google Cloud Console (APIs & Services → Credentials): API restriction "Places API
  (New)", and an IP restriction for the server that runs the backend.

**To reduce repeats further:** Unsplash allows 50 API calls per hour, so the pool grows in hourly steps.
`npm run images:refresh` runs the remaining stages, then adds photos once an hour for 6 rounds
(`node scripts/image-refresh-loop.js 12` for 12 rounds). Progress: `logs\images-background.log`.
Wikimedia rate-limits busy IPs (HTTP 429), so the `commons` and `media` stages are deliberately slow.

## Configuration (`hotel-booking-backend/.env`)

* `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — **the current keys are rejected by Razorpay (401)**, so the site
  offers "Pay at hotel" only. Paste new test keys from https://dashboard.razorpay.com/app/keys and restart;
  "Pay now" (UPI / Google Pay / cards) appears automatically.
* `GOOGLE_ID` / `GOOGLE_SECRET` — placeholders, so the Google button is hidden. Add an OAuth client
  (redirect URI `http://localhost:5001/api/auth/callback/google`) to enable it.
* `CLOUDINARY_*` — working; uploads fall back to `uploads/` on disk if Cloudinary fails.
* `UNSPLASH_ACCESS_KEY` — used by the `pool` stage.
* `DNS_SERVERS` (optional) — only if your network cannot resolve `mongodb+srv` SRV records (replaces the old
  hard-coded `192.168.1.1`).

## Folder layout

```text
fixed/
├─ hotel-booking-backend/    Express API, scripts/ (data + photo pipeline)
├─ hotel-booking-frontend/   React 18 + Vite + Tailwind (rebuilt; the original src/ was missing)
└─ shared/types.ts           types used by the backend (was missing from the pack)
```
