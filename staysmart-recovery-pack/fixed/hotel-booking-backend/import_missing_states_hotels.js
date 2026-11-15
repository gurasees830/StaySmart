/**
 * Import hotels only for Indian states/UTs that are currently missing from DB.
 * Source: OpenStreetMap Overpass API
 *
 * Usage:
 *   node import_missing_states_hotels.js
 *
 * Optional env vars:
 *   BATCH_SIZE=250
 *   DRY_RUN=true
 */

require("dotenv").config();
const axios = require("axios");
const { MongoClient } = require("mongodb");

const MONGO_URI = process.env.MONGODB_CONNECTION_STRING;
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "250", 10);
const DRY_RUN = String(process.env.DRY_RUN || "false").toLowerCase() === "true";
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

if (!MONGO_URI) {
  console.error("MONGODB_CONNECTION_STRING is missing in .env");
  process.exit(1);
}

const INDIA_STATES_UTS = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
];

const STATE_CAPITALS = {
  "Andhra Pradesh": "Amaravati",
  "Arunachal Pradesh": "Itanagar",
  Assam: "Dispur",
  Bihar: "Patna",
  Chhattisgarh: "Raipur",
  Goa: "Panaji",
  Gujarat: "Gandhinagar",
  Haryana: "Chandigarh",
  "Himachal Pradesh": "Shimla",
  Jharkhand: "Ranchi",
  Karnataka: "Bengaluru",
  Kerala: "Thiruvananthapuram",
  "Madhya Pradesh": "Bhopal",
  Maharashtra: "Mumbai",
  Manipur: "Imphal",
  Meghalaya: "Shillong",
  Mizoram: "Aizawl",
  Nagaland: "Kohima",
  Odisha: "Bhubaneswar",
  Punjab: "Chandigarh",
  Rajasthan: "Jaipur",
  Sikkim: "Gangtok",
  "Tamil Nadu": "Chennai",
  Telangana: "Hyderabad",
  Tripura: "Agartala",
  "Uttar Pradesh": "Lucknow",
  Uttarakhand: "Dehradun",
  "West Bengal": "Kolkata",
  "Andaman and Nicobar Islands": "Port Blair",
  Chandigarh: "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu": "Daman",
  Delhi: "New Delhi",
  "Jammu and Kashmir": "Srinagar",
  Ladakh: "Leh",
  Lakshadweep: "Kavaratti",
  Puducherry: "Puducherry",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function titleCase(value) {
  const cleaned = normalizeText(value);
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function buildOverpassQuery(stateName) {
  return `
    [out:json][timeout:120];
    area["name"="${stateName}"]["boundary"="administrative"]->.searchArea;
    (
      node["tourism"="hotel"](area.searchArea);
      way["tourism"="hotel"](area.searchArea);
      relation["tourism"="hotel"](area.searchArea);
    );
    out center tags;
  `;
}

function extractCoordinates(element) {
  if (Number.isFinite(element.lat) && Number.isFinite(element.lon)) {
    return { latitude: element.lat, longitude: element.lon };
  }
  if (
    element.center &&
    Number.isFinite(element.center.lat) &&
    Number.isFinite(element.center.lon)
  ) {
    return { latitude: element.center.lat, longitude: element.center.lon };
  }
  return null;
}

function parseStarRating(tags, key) {
  const parsed = parseInt(tags.stars, 10);
  if (Number.isFinite(parsed)) {
    return Math.max(1, Math.min(5, parsed));
  }
  return 3 + (hashString(key) % 3);
}

function parseAverageRating(starRating, key) {
  const h = hashString(`avg-${key}`) % 1000;
  const min = Math.max(3.0, starRating - 0.8);
  const max = Math.min(4.9, starRating + 0.2);
  return Number((min + ((max - min) * h) / 1000).toFixed(1));
}

function buildImageUrls(osmId, stateName) {
  const stateSlug = stateName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const a = hashString(`${osmId}-a`);
  const b = hashString(`${osmId}-b`);
  return [
    `https://loremflickr.com/1600/1000/hotel,india?lock=${a}`,
    `https://loremflickr.com/1600/1000/resort,india?lock=${b}`,
    `https://picsum.photos/seed/staysmart-${stateSlug}-${a}/1600/1000`,
  ];
}

function buildFacilities(tags) {
  const out = [];
  const yesLike = (value) =>
    ["yes", "true", "1", "free"].includes(String(value || "").toLowerCase());

  if (yesLike(tags.internet_access) || yesLike(tags.wifi) || yesLike(tags["internet_access:fee"])) {
    out.push("Free WiFi");
  }
  if (yesLike(tags.parking)) out.push("Free Parking");
  if (yesLike(tags.restaurant) || tags.amenity === "restaurant") out.push("Restaurant");
  if (yesLike(tags.pool) || yesLike(tags.swimming_pool)) out.push("Swimming Pool");

  if (!out.length) out.push("Free WiFi", "Restaurant");
  return out;
}

function mapElementToHotelDoc(element, stateName) {
  const tags = element.tags || {};
  const coords = extractCoordinates(element);
  if (!coords) return null;

  const osmId = `${element.type}/${element.id}`;
  const name = normalizeText(tags.name) || `Hotel ${stateName} ${element.id}`;
  const city =
    titleCase(
      tags["addr:city"] ||
        tags["addr:town"] ||
        tags["addr:village"] ||
        tags["addr:place"] ||
        STATE_CAPITALS[stateName] ||
        stateName
    ) || stateName;

  const starRating = parseStarRating(tags, osmId);
  const averageRating = parseAverageRating(starRating, osmId);
  const reviewCount = 20 + (hashString(`reviews-${osmId}`) % 1500);
  const pricePerNight = 1800 + (hashString(`price-${osmId}`) % 12000);

  return {
    osmId,
    userId: "osm_seed_user",
    name: titleCase(name),
    city,
    country: "India",
    description:
      normalizeText(tags.description) || `Comfortable stay at ${titleCase(name)} in ${city}.`,
    type: ["Hotel"],
    adultCount: 2,
    childCount: 0,
    facilities: buildFacilities(tags),
    pricePerNight,
    starRating,
    imageUrls: buildImageUrls(osmId, stateName),
    lastUpdated: new Date(),
    location: {
      type: "Point",
      coordinates: [coords.longitude, coords.latitude],
      latitude: coords.latitude,
      longitude: coords.longitude,
      address: {
        street: titleCase(tags["addr:street"] || ""),
        city,
        state: stateName,
        country: "India",
        zipCode: normalizeText(tags["addr:postcode"] || ""),
      },
    },
    contact: {
      phone: normalizeText(tags["contact:phone"] || tags.phone || ""),
      email: normalizeText(tags["contact:email"] || ""),
      website: normalizeText(tags["contact:website"] || tags.website || tags.url || ""),
    },
    policies: {},
    amenities: {
      parking: false,
      wifi: false,
      pool: false,
      gym: false,
      spa: false,
      restaurant: false,
      bar: false,
      airportShuttle: false,
      businessCenter: false,
    },
    totalBookings: 0,
    totalRevenue: 0,
    averageRating,
    reviewCount,
    occupancyRate: 0,
    isActive: true,
    isFeatured: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function fetchMissingStates(hotelsCollection) {
  const existingStates = await hotelsCollection.distinct("location.address.state", {
    "location.address.state": { $nin: [null, ""] },
  });
  const existingNorm = new Set(existingStates.map((s) => String(s).trim().toLowerCase()));
  return INDIA_STATES_UTS.filter((state) => !existingNorm.has(state.toLowerCase()));
}

async function fetchHotelsForState(stateName) {
  const query = buildOverpassQuery(stateName);
  let lastError = null;

  for (const endpoint of OVERPASS_URLS) {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const response = await axios.post(
          endpoint,
          `data=${encodeURIComponent(query)}`,
          {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            timeout: 180000,
          }
        );
        return Array.isArray(response.data?.elements) ? response.data.elements : [];
      } catch (error) {
        lastError = error;
        const status = error?.response?.status;
        if (status === 429 || status === 504) {
          const waitMs = 4000 * attempt;
          console.warn(
            `Overpass ${status} for ${stateName} via ${endpoint}. Retry ${attempt}/4 in ${waitMs}ms`
          );
          await sleep(waitMs);
          continue;
        }
        break;
      }
    }
  }

  throw lastError || new Error(`Unknown Overpass error for ${stateName}`);
}

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db();
  const hotels = db.collection("hotels");

  await hotels.createIndex({ osmId: 1 }, { unique: true, sparse: true });

  const missingStates = await fetchMissingStates(hotels);
  console.log(`Missing states/UTs: ${missingStates.length}`);
  if (!missingStates.length) {
    console.log("No missing states detected.");
    await client.close();
    process.exit(0);
  }

  console.log(`Target states: ${missingStates.join(", ")}`);

  let totalFetched = 0;
  let totalMapped = 0;
  let upserted = 0;
  let modified = 0;
  let matched = 0;

  for (const state of missingStates) {
    console.log(`Querying Overpass for: ${state}`);
    let elements = [];
    try {
      elements = await fetchHotelsForState(state);
    } catch (error) {
      console.error(`Overpass failed for ${state}:`, error.message);
      continue;
    }

    totalFetched += elements.length;
    console.log(`Fetched elements for ${state}: ${elements.length}`);

    const mapped = elements
      .map((element) => mapElementToHotelDoc(element, state))
      .filter(Boolean);

    totalMapped += mapped.length;
    if (!mapped.length) {
      await sleep(1100);
      continue;
    }

    for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
      const batch = mapped.slice(i, i + BATCH_SIZE);
      const updateExistingOps = batch.map((doc) => ({
        updateOne: {
          filter: { osmId: doc.osmId },
          update: {
            $set: {
              "location.address.state": state,
              country: "India",
              "location.address.country": "India",
              updatedAt: new Date(),
              lastUpdated: new Date(),
            },
          },
          upsert: false,
        },
      }));

      const upsertMissingOps = batch.map((doc) => ({
        updateOne: {
          filter: { osmId: doc.osmId },
          update: {
            $setOnInsert: doc,
          },
          upsert: true,
        },
      }));

      if (!DRY_RUN) {
        const updateResult = await hotels.bulkWrite(updateExistingOps, {
          ordered: false,
        });
        matched += updateResult.matchedCount || 0;
        modified += updateResult.modifiedCount || 0;

        const insertResult = await hotels.bulkWrite(upsertMissingOps, {
          ordered: false,
        });
        upserted += insertResult.upsertedCount || 0;
      }
    }

    await sleep(3500);
  }

  const afterMissing = await fetchMissingStates(hotels);
  const total = await hotels.countDocuments({});

  console.log("Import missing states completed.");
  console.log(`Fetched elements: ${totalFetched}`);
  console.log(`Mapped hotels: ${totalMapped}`);
  console.log(`Matched existing: ${matched}`);
  console.log(`Upserted: ${upserted}`);
  console.log(`Modified: ${modified}`);
  console.log(`Total hotels in DB: ${total}`);
  console.log(`Remaining missing states: ${afterMissing.length}`);
  if (afterMissing.length) {
    console.log(`Still missing: ${afterMissing.join(", ")}`);
  }

  await client.close();
  process.exit(0);
}

main().catch((error) => {
  console.error("Import missing states failed:", error);
  process.exit(1);
});
