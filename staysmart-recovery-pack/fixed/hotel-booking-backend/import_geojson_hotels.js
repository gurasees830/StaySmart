/**
 * Import/Upsert hotels from export.geojson into MongoDB.
 * - Upserts by osmId (feature.id)
 * - Fills core hotel fields required by the app
 *
 * Usage:
 *   node import_geojson_hotels.js
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const MONGO_URI = process.env.MONGODB_CONNECTION_STRING;
const GEOJSON_PATH = path.join(__dirname, "export.geojson");
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "500", 10);

if (!MONGO_URI) {
  console.error("MONGODB_CONNECTION_STRING is missing in .env");
  process.exit(1);
}

if (!fs.existsSync(GEOJSON_PATH)) {
  console.error(`GeoJSON not found: ${GEOJSON_PATH}`);
  process.exit(1);
}

const DEFAULT_IMAGES = [
  "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1600&q=80",
  "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=1600&q=80",
  "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=1600&q=80",
  "https://images.unsplash.com/photo-1578683010236-d716f9a3f461?auto=format&fit=crop&w=1600&q=80",
];

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

function pickDefaultImage(seed) {
  const index = hashString(seed) % DEFAULT_IMAGES.length;
  return DEFAULT_IMAGES[index];
}

function parseStars(rawStars) {
  const parsed = parseInt(rawStars, 10);
  if (Number.isNaN(parsed)) return 3;
  return Math.max(1, Math.min(5, parsed));
}

function estimatePrice(seed, starRating) {
  const hash = hashString(seed);
  const base = 1800 + (hash % 2200);
  return base + starRating * 450;
}

function buildFacilities(properties) {
  const facilities = [];
  const has = (key) => normalizeText(properties[key]).toLowerCase();

  if (["yes", "true", "free"].includes(has("internet_access")) || has("wifi")) {
    facilities.push("Free WiFi");
  }
  if (["yes", "true"].includes(has("parking"))) {
    facilities.push("Free Parking");
  }
  if (["yes", "true"].includes(has("restaurant")) || has("amenity") === "restaurant") {
    facilities.push("Restaurant");
  }
  if (["yes", "true"].includes(has("swimming_pool")) || has("pool")) {
    facilities.push("Swimming Pool");
  }
  if (!facilities.length) {
    facilities.push("Free WiFi", "Restaurant");
  }
  return facilities;
}

function mapFeatureToHotel(feature) {
  const properties = feature.properties || {};
  const geometry = feature.geometry || {};
  const coords = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  const lon = Number(coords[0]);
  const lat = Number(coords[1]);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  const osmId = normalizeText(feature.id || properties["@id"]);
  if (!osmId) {
    return null;
  }

  const city = titleCase(
    properties["addr:city"] ||
      properties["addr:town"] ||
      properties["addr:village"] ||
      properties["addr:place"] ||
      ""
  );
  const state = titleCase(properties["addr:state"] || "");
  const country = titleCase(properties["addr:country"] || "India") || "India";
  const street = titleCase(properties["addr:street"] || "");
  const zipCode = normalizeText(properties["addr:postcode"] || "");

  const name = titleCase(properties.name || `Hotel ${osmId}`);
  const starRating = parseStars(properties.stars);
  const image =
    normalizeText(properties.image) ||
    normalizeText(properties["image:url"]) ||
    pickDefaultImage(osmId);

  const hotelDoc = {
    osmId,
    userId: "osm_seed_user",
    name,
    city: city || "",
    country,
    description:
      normalizeText(properties.description) ||
      `Comfortable stay at ${name}${city ? ` in ${city}` : ""}.`,
    type: ["Hotel"],
    adultCount: 2,
    childCount: 0,
    facilities: buildFacilities(properties),
    pricePerNight: estimatePrice(osmId, starRating),
    starRating,
    imageUrls: [image],
    lastUpdated: new Date(),
    location: {
      type: "Point",
      coordinates: [lon, lat],
      latitude: lat,
      longitude: lon,
      address: {
        street,
        city: city || "",
        state,
        country,
        zipCode,
      },
    },
    contact: {
      phone: normalizeText(properties["contact:phone"] || properties.phone || ""),
      email: normalizeText(properties["contact:email"] || ""),
      website: normalizeText(
        properties["contact:website"] || properties.website || properties.url || ""
      ),
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
    averageRating: 0,
    reviewCount: 0,
    occupancyRate: 0,
    isActive: true,
    isFeatured: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return hotelDoc;
}

async function main() {
  console.log("Reading GeoJSON...");
  const geojson = JSON.parse(fs.readFileSync(GEOJSON_PATH, "utf8"));
  const features = Array.isArray(geojson.features) ? geojson.features : [];
  console.log(`GeoJSON features found: ${features.length}`);

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db();
  const hotels = db.collection("hotels");

  await hotels.createIndex({ osmId: 1 }, { unique: true, sparse: true });

  let processed = 0;
  let upserted = 0;
  let modified = 0;
  let skipped = 0;
  let ops = [];

  for (const feature of features) {
    processed += 1;
    const hotelDoc = mapFeatureToHotel(feature);
    if (!hotelDoc) {
      skipped += 1;
      continue;
    }

    ops.push({
      updateOne: {
        filter: { osmId: hotelDoc.osmId },
        update: { $set: hotelDoc },
        upsert: true,
      },
    });

    if (ops.length >= BATCH_SIZE) {
      const result = await hotels.bulkWrite(ops, { ordered: false });
      upserted += result.upsertedCount || 0;
      modified += result.modifiedCount || 0;
      ops = [];
    }

    if (processed % 1000 === 0) {
      console.log(`Processed ${processed}/${features.length}`);
    }
  }

  if (ops.length > 0) {
    const result = await hotels.bulkWrite(ops, { ordered: false });
    upserted += result.upsertedCount || 0;
    modified += result.modifiedCount || 0;
  }

  const total = await hotels.countDocuments({});
  console.log("Import completed.");
  console.log(`Processed: ${processed}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Inserted: ${upserted}`);
  console.log(`Updated: ${modified}`);
  console.log(`Total hotels in collection: ${total}`);

  await client.close();
  process.exit(0);
}

main().catch((error) => {
  console.error("GeoJSON import failed:", error);
  process.exit(1);
});
