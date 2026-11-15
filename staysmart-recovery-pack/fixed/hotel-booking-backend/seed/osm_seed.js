// seed/osm_seed.js
// Usage: node seed/osm_seed.js
// Requirements: npm i axios mongoose dotenv
// Make sure .env contains MONGODB_CONNECTION_STRING and (optional) SEED_USER_ID
// By default this will seed 1000 hotels. To change count, set TARGET_COUNT in .env.

const axios = require("axios");
const mongoose = require("mongoose");
const fs = require("fs");
require("dotenv").config();

// CONFIG
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const TARGET_COUNT = parseInt(process.env.TARGET_COUNT || "1000", 10);
const MONGO = process.env.MONGODB_CONNECTION_STRING;
const SEED_USER_ID = process.env.SEED_USER_ID || null; // set this to a valid user _id if you have one
const BATCH_SIZE = 200; // insert per batch

if (!MONGO) {
  console.error("MONGODB_CONNECTION_STRING not set in .env");
  process.exit(1);
}

// Simple Hotel schema used only for seed insertion (matches your model fields minimally)
const HotelSchema = new mongoose.Schema({}, { strict: false });
const Hotel = mongoose.model("HotelSeed", HotelSchema, "hotels");

// small helper to sleep between requests
function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// list of states/UTs to query (major + smaller states). We'll stop once TARGET_COUNT is reached.
const STATES = [
  "Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa","Gujarat",
  "Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh",
  "Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab",
  "Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand",
  "West Bengal","Delhi","Jammu and Kashmir","Ladakh","Puducherry","Andaman and Nicobar Islands",
  "Chandigarh","Dadra and Nagar Haveli and Daman and Diu"
];

// helper: build Overpass query for a given state name
function buildOverpassQueryForState(stateName) {
  // We search administrative area with the state name (admin_level may vary, 4 typically)
  // Then find nodes/ways/relations with tourism=hotel inside it.
  return `
  [out:json][timeout:60];
  area["name"="${stateName}"]["boundary"="administrative"]->.searchArea;
  (
    node["tourism"="hotel"](area.searchArea);
    way["tourism"="hotel"](area.searchArea);
    relation["tourism"="hotel"](area.searchArea);
  );
  out center tags;
  `;
}

// map OSM element to our hotel object
function mapElemToHotel(elem) {
  const tags = elem.tags || {};
  // get lat/lon
  const lat = elem.lat || (elem.center && elem.center.lat) || null;
  const lon = elem.lon || (elem.center && elem.center.lon) || null;
  if (!tags.name || !lat || !lon) return null; // require name & coords

  // star rating
  let starRating = 0;
  if (tags.stars) {
    const parsed = parseInt(tags.stars);
    if (!isNaN(parsed)) starRating = Math.max(0, Math.min(5, parsed));
  }

  // Keep real OSM/Wikimedia images when they exist. Missing images are filled by
  // refresh_hotel_images.js, which selects a distinct, free, city-relevant image.
  let imageUrl = null;
  if (tags.image) imageUrl = tags.image;
  else if (tags["image:url"]) imageUrl = tags["image:url"];
  else if (tags.wikimedia_commons) imageUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(tags.wikimedia_commons)}`;
  else imageUrl = null;

  // city fallback
  const city = (tags["addr:city"] || tags["addr:place"] || tags["addr:town"] || tags["addr:village"] || tags["addr:state"] || "").toLowerCase();

  // build the hotel doc similar to your schema
  const hotel = {
    userId: SEED_USER_ID || "seed_user_1", // change if you want real user id
    name: tags.name,
    city: city || stateNameToCity(elem), // fallback, stateNameToCity is a helper below
    country: "India",
    description: tags.description || tags["name:en"] || `Hotel ${tags.name} in ${city || ""}`,
    type: tags["hotel:type"] ? [tags["hotel:type"]] : ["Hotel"],
    adultCount: 2,
    childCount: 1,
    facilities: buildFacilitiesFromTags(tags),
    pricePerNight: estimatePriceFromStars(starRating),
    starRating: starRating,
    imageUrls: imageUrl ? [imageUrl] : [],
    lastUpdated: new Date().toISOString(),
    location: {
      latitude: lat,
      longitude: lon,
      address: {
        street: tags["addr:street"] || "",
        city: city || "",
        state: tags["addr:state"] || "",
        country: "India",
        zipCode: tags["addr:postcode"] || "",
      },
    },
    contact: {
      phone: tags["contact:phone"] || tags.phone || "",
      email: tags["contact:email"] || "",
      website: tags["contact:website"] || tags.website || tags.url || "",
    },
    policies: {},
    amenities: {
      parking: hasTagBool(tags, ["parking", "amenity:parking"]),
      wifi: hasTagBool(tags, ["internet_access", "wifi", "internet_access:fee"]),
      pool: hasTagBool(tags, ["pool"]),
      gym: false,
      spa: false,
      restaurant: hasTagBool(tags, ["restaurant"]),
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

  return hotel;
}

// helper: flag if tags contain a value indicating true
function hasTagBool(tags, keys) {
  for (const k of keys) {
    if (tags[k]) {
      const v = tags[k].toString().toLowerCase();
      if (["yes", "true", "1", "free"].includes(v) || v.length > 0) return true;
    }
  }
  return false;
}

// estimate price from stars (naive)
function estimatePriceFromStars(stars) {
  if (!stars || stars === 0) return Math.floor(1000 + Math.random() * 3000); // INR: 1000-4000
  return stars * 3000 + Math.floor(Math.random() * 2000); // e.g. 1*3000.. etc
}

// minimal fallback to get a city-like string if tags don't provide it
function stateNameToCity(elem) {
  // try to use 'region' or 'place' tags, else empty
  const t = elem.tags || {};
  return (t["addr:city"] || t["addr:place"] || t["addr:town"] || t["addr:village"] || t["addr:state"] || "").toLowerCase();
}

// build facilities array from tags
function buildFacilitiesFromTags(tags) {
  const out = [];
  if (hasTagBool(tags, ["wifi", "internet_access", "internet_access:fee"])) out.push("Free WiFi");
  if (hasTagBool(tags, ["restaurant"])) out.push("Restaurant");
  if (hasTagBool(tags, ["parking"])) out.push("Parking");
  if (hasTagBool(tags, ["spa"])) out.push("Spa");
  if (hasTagBool(tags, ["pool"])) out.push("Pool");
  return out;
}

// MAIN
(async () => {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGO, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log("Connected to MongoDB");

  let totalInserted = 0;
  const insertedIds = [];

  try {
    for (const state of STATES) {
      if (totalInserted >= TARGET_COUNT) break;

      console.log(`Querying OSM for state: ${state}`);
      const query = buildOverpassQueryForState(state);
      // Overpass POST with query in 'data'
      let res = null;
      try {
        res = await axios.post(OVERPASS_URL, `data=${encodeURIComponent(query)}`, {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 120000,
        });
      } catch (err) {
        console.error(`Overpass request failed for ${state}:`, err.message || err);
        // wait and continue to next state
        await sleep(1500);
        continue;
      }

      const elements = (res.data && res.data.elements) || [];
      console.log(`Found ${elements.length} elements in ${state}`);

      // Map and filter elements
      const hotels = [];
      for (const el of elements) {
        if (totalInserted + hotels.length >= TARGET_COUNT) break;
        const h = mapElemToHotel(el);
        if (h) hotels.push(h);
      }

      if (hotels.length === 0) {
        console.log(`No mappable hotels in ${state} (or name/coords missing).`);
        await sleep(1000);
        continue;
      }

      // Insert in batches
      for (let i = 0; i < hotels.length; i += BATCH_SIZE) {
        const batch = hotels.slice(i, i + BATCH_SIZE);
        const result = await Hotel.insertMany(batch, { ordered: false }).catch((e) => {
          console.error("InsertMany partial failure:", e && e.message ? e.message : e);
          return null;
        });
        if (result && result.length) {
          totalInserted += result.length;
          console.log(`Inserted ${result.length} hotels. Total: ${totalInserted}/${TARGET_COUNT}`);
          result.forEach((r) => insertedIds.push(r._id));
        }
        if (totalInserted >= TARGET_COUNT) break;
      }

      // gentle delay to be polite to Overpass servers
      await sleep(1200);
    }

    console.log("Seeding complete.");
    console.log(`Total hotels inserted: ${totalInserted}`);
    // write inserted ids to file
    fs.writeFileSync("seed_inserted_ids.json", JSON.stringify(insertedIds, null, 2));
  } catch (err) {
    console.error("Seeding error:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
    process.exit(0);
  }
})();
