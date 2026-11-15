/**
 * Import/Upsert India-wide accommodation inventory from OSM Overpass:
 * - Hotels, lodgings, guest houses, hostels, motels, resorts, apartments
 * - College/university + dormitory/hostel candidates
 *
 * Usage:
 *   node import_india_stays_colleges.js
 *
 * Optional env vars:
 *   DRY_RUN=true
 *   BATCH_SIZE=250
 *   INCLUDE_CITY_HOTSPOTS=true
 */

require("dotenv").config();
const axios = require("axios");
const { MongoClient } = require("mongodb");

const MONGO_URI = process.env.MONGODB_CONNECTION_STRING;
const DRY_RUN = String(process.env.DRY_RUN || "false").toLowerCase() === "true";
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "250", 10);
const INCLUDE_CITY_HOTSPOTS =
  String(process.env.INCLUDE_CITY_HOTSPOTS || "true").toLowerCase() !== "false";
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

const CITY_HOTSPOTS = [
  { city: "Mumbai", state: "Maharashtra" },
  { city: "Thane", state: "Maharashtra" },
  { city: "Mira Road", state: "Maharashtra" },
  { city: "Dahisar", state: "Maharashtra" },
  { city: "Malad", state: "Maharashtra" },
  { city: "Borivali", state: "Maharashtra" },
  { city: "Navi Mumbai", state: "Maharashtra" },
  { city: "Pune", state: "Maharashtra" },
  { city: "Nagpur", state: "Maharashtra" },
  { city: "Nashik", state: "Maharashtra" },
  { city: "Aurangabad", state: "Maharashtra" },
  { city: "Kolhapur", state: "Maharashtra" },
  { city: "Ahmedabad", state: "Gujarat" },
  { city: "Surat", state: "Gujarat" },
  { city: "Vadodara", state: "Gujarat" },
  { city: "Rajkot", state: "Gujarat" },
  { city: "Bengaluru", state: "Karnataka" },
  { city: "Mysuru", state: "Karnataka" },
  { city: "Mangaluru", state: "Karnataka" },
  { city: "Hubli", state: "Karnataka" },
  { city: "Chennai", state: "Tamil Nadu" },
  { city: "Coimbatore", state: "Tamil Nadu" },
  { city: "Madurai", state: "Tamil Nadu" },
  { city: "Trichy", state: "Tamil Nadu" },
  { city: "Hyderabad", state: "Telangana" },
  { city: "Warangal", state: "Telangana" },
  { city: "Nizamabad", state: "Telangana" },
  { city: "Kolkata", state: "West Bengal" },
  { city: "Howrah", state: "West Bengal" },
  { city: "Siliguri", state: "West Bengal" },
  { city: "Delhi", state: "Delhi" },
  { city: "New Delhi", state: "Delhi" },
  { city: "Noida", state: "Uttar Pradesh" },
  { city: "Ghaziabad", state: "Uttar Pradesh" },
  { city: "Lucknow", state: "Uttar Pradesh" },
  { city: "Kanpur", state: "Uttar Pradesh" },
  { city: "Varanasi", state: "Uttar Pradesh" },
  { city: "Prayagraj", state: "Uttar Pradesh" },
  { city: "Patna", state: "Bihar" },
  { city: "Gaya", state: "Bihar" },
  { city: "Ranchi", state: "Jharkhand" },
  { city: "Jamshedpur", state: "Jharkhand" },
  { city: "Bhopal", state: "Madhya Pradesh" },
  { city: "Indore", state: "Madhya Pradesh" },
  { city: "Gwalior", state: "Madhya Pradesh" },
  { city: "Jaipur", state: "Rajasthan" },
  { city: "Udaipur", state: "Rajasthan" },
  { city: "Jodhpur", state: "Rajasthan" },
  { city: "Kota", state: "Rajasthan" },
  { city: "Chandigarh", state: "Chandigarh" },
  { city: "Amritsar", state: "Punjab" },
  { city: "Ludhiana", state: "Punjab" },
  { city: "Bhubaneswar", state: "Odisha" },
  { city: "Cuttack", state: "Odisha" },
  { city: "Guwahati", state: "Assam" },
  { city: "Shillong", state: "Meghalaya" },
  { city: "Dehradun", state: "Uttarakhand" },
  { city: "Haridwar", state: "Uttarakhand" },
  { city: "Thiruvananthapuram", state: "Kerala" },
  { city: "Kochi", state: "Kerala" },
  { city: "Kozhikode", state: "Kerala" },
  { city: "Panaji", state: "Goa" },
];

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

function parseStars(tags, key) {
  const parsed = parseInt(tags.stars, 10);
  if (Number.isFinite(parsed)) {
    return Math.max(1, Math.min(5, parsed));
  }
  return 2 + (hashString(`stars-${key}`) % 4);
}

function parseAverageRating(starRating, key) {
  const h = hashString(`avg-${key}`) % 1000;
  const min = Math.max(3.0, starRating - 0.8);
  const max = Math.min(4.9, starRating + 0.3);
  return Number((min + ((max - min) * h) / 1000).toFixed(1));
}

function classifyTypes(tags, name) {
  const tourism = normalizeText(tags.tourism).toLowerCase();
  const amenity = normalizeText(tags.amenity).toLowerCase();
  const building = normalizeText(tags.building).toLowerCase();
  const operatorType = normalizeText(tags["operator:type"]).toLowerCase();
  const lowerName = normalizeText(name).toLowerCase();
  const hasHostelWord =
    lowerName.includes("hostel") ||
    lowerName.includes("dorm") ||
    lowerName.includes("residence");
  const isGovtCollege =
    lowerName.includes("government college") ||
    lowerName.includes("govt college") ||
    operatorType.includes("government");

  if (amenity === "college" || amenity === "university" || building === "dormitory") {
    if (isGovtCollege) {
      return ["Government College Hostel", "College Hostel", "Hostel"];
    }
    if (hasHostelWord || building === "dormitory") {
      return ["College Hostel", "Hostel"];
    }
    return ["University Hostel", "College Hostel"];
  }

  if (tourism === "hostel") return ["Hostel", "Lodging"];
  if (tourism === "guest_house") return ["Guest House", "Lodging"];
  if (tourism === "motel") return ["Motel", "Lodging"];
  if (tourism === "resort") return ["Luxury", "Hotel"];
  if (tourism === "apartment" || tourism === "chalet") return ["Lodging", "Self Catering"];
  if (tourism === "hotel") return ["Hotel", "Business"];

  return ["Lodging"];
}

function buildFacilities(tags) {
  const yesLike = (value) =>
    ["yes", "true", "1", "free"].includes(String(value || "").toLowerCase());
  const out = [];

  if (yesLike(tags.internet_access) || yesLike(tags.wifi)) out.push("Free WiFi");
  if (yesLike(tags.parking)) out.push("Parking");
  if (yesLike(tags.restaurant) || normalizeText(tags.amenity).toLowerCase() === "restaurant") {
    out.push("Restaurant");
  }
  if (yesLike(tags.pool) || yesLike(tags.swimming_pool)) out.push("Outdoor Pool");
  if (yesLike(tags["air_conditioning"]) || yesLike(tags.ac)) out.push("Non-Smoking Rooms");
  if (!out.length) out.push("Free WiFi", "Family Rooms");
  return out;
}

function estimatePricePerNight(seedKey, types, starRating) {
  const hash = hashString(`price-${seedKey}`);
  const isCollege = types.some((type) => type.includes("College") || type.includes("University"));
  const isHostel = types.includes("Hostel");
  const base = isCollege ? 700 : isHostel ? 900 : 1600;
  const spread = isCollege ? 2500 : 12000;
  return base + (hash % spread) + starRating * 250;
}

function pickImages(seedKey, types) {
  const isHostel = types.includes("Hostel") || types.some((type) => type.includes("College"));
  const tagA = isHostel ? "hostel,india" : "hotel,india";
  const tagB = isHostel ? "campus,dormitory" : "resort,lodging";
  const a = hashString(`${seedKey}-a`);
  const b = hashString(`${seedKey}-b`);

  return [
    `https://loremflickr.com/1600/1000/${tagA}?lock=${a}`,
    `https://loremflickr.com/1600/1000/${tagB}?lock=${b}`,
    `https://picsum.photos/seed/staysmart-${a}/1600/1000`,
  ];
}

function buildAreaQuery(areaName) {
  return `
    [out:json][timeout:180];
    area["name"="${areaName}"]["boundary"="administrative"]->.searchArea;
    (
      node["tourism"~"hotel|hostel|guest_house|motel|resort|apartment|chalet"](area.searchArea);
      way["tourism"~"hotel|hostel|guest_house|motel|resort|apartment|chalet"](area.searchArea);
      relation["tourism"~"hotel|hostel|guest_house|motel|resort|apartment|chalet"](area.searchArea);

      node["building"="dormitory"](area.searchArea);
      way["building"="dormitory"](area.searchArea);
      relation["building"="dormitory"](area.searchArea);

      node["amenity"~"college|university"](area.searchArea);
      way["amenity"~"college|university"](area.searchArea);
      relation["amenity"~"college|university"](area.searchArea);
    );
    out center tags;
  `;
}

function mapElementToHotelDoc(element, context) {
  const tags = element.tags || {};
  const coords = extractCoordinates(element);
  if (!coords) return null;

  const osmId = `${element.type}/${element.id}`;
  const name = titleCase(
    tags.name ||
      tags["name:en"] ||
      tags["official_name"] ||
      `Stay ${context.areaName} ${element.id}`
  );
  const types = classifyTypes(tags, name);
  const state = titleCase(tags["addr:state"] || context.stateName || "");
  const city = titleCase(
    tags["addr:city"] ||
      tags["addr:town"] ||
      tags["addr:village"] ||
      tags["addr:place"] ||
      tags["addr:suburb"] ||
      context.cityName ||
      context.fallbackCity ||
      context.areaName
  );
  const district = titleCase(
    tags["addr:district"] || tags["addr:suburb"] || tags["addr:neighbourhood"] || ""
  );
  const starRating = parseStars(tags, osmId);
  const averageRating = parseAverageRating(starRating, osmId);
  const reviewCount = 15 + (hashString(`reviews-${osmId}`) % 2200);
  const pricePerNight = estimatePricePerNight(osmId, types, starRating);
  const isFeatured = hashString(`featured-${osmId}`) % 100 < 8;

  return {
    osmId,
    userId: "osm_seed_user",
    name,
    city,
    country: "India",
    description:
      normalizeText(tags.description) ||
      `${name} in ${city}${state ? `, ${state}` : ""}.`,
    type: types,
    adultCount: types.includes("Hostel") ? 1 : 2,
    childCount: 0,
    facilities: buildFacilities(tags),
    pricePerNight,
    starRating,
    imageUrls: pickImages(osmId, types),
    lastUpdated: new Date(),
    location: {
      latitude: coords.latitude,
      longitude: coords.longitude,
      address: {
        street: titleCase(tags["addr:street"] || ""),
        city,
        district,
        state,
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
    isFeatured,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function fetchElementsForArea(areaName) {
  const query = buildAreaQuery(areaName);
  let lastError = null;

  for (const endpoint of OVERPASS_URLS) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await axios.post(
          endpoint,
          `data=${encodeURIComponent(query)}`,
          {
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            timeout: 240000,
          }
        );
        return Array.isArray(response.data?.elements) ? response.data.elements : [];
      } catch (error) {
        lastError = error;
        const status = error?.response?.status;
        if (status === 429 || status === 504) {
          const waitMs = 4000 * attempt;
          console.warn(
            `Overpass ${status} for ${areaName} via ${endpoint}. Retrying in ${waitMs}ms`
          );
          await sleep(waitMs);
          continue;
        }
        break;
      }
    }
  }

  throw lastError || new Error(`Unable to fetch OSM data for ${areaName}`);
}

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db();
  const hotels = db.collection("hotels");

  await hotels.createIndex({ osmId: 1 }, { unique: true, sparse: true });
  await hotels.createIndex({ city: 1, country: 1 });
  await hotels.createIndex({ "location.latitude": 1, "location.longitude": 1 });

  const targetAreas = [
    ...INDIA_STATES_UTS.map((stateName) => ({
      areaName: stateName,
      stateName,
      cityName: "",
      fallbackCity: STATE_CAPITALS[stateName] || stateName,
      source: "state",
    })),
  ];

  if (INCLUDE_CITY_HOTSPOTS) {
    CITY_HOTSPOTS.forEach((hotspot) => {
      targetAreas.push({
        areaName: hotspot.city,
        stateName: hotspot.state,
        cityName: hotspot.city,
        fallbackCity: hotspot.city,
        source: "hotspot",
      });
    });
  }

  let fetched = 0;
  let mappedTotal = 0;
  let upserted = 0;
  let modified = 0;
  let skipped = 0;

  for (const area of targetAreas) {
    console.log(`Querying ${area.source} area: ${area.areaName}`);
    let elements = [];
    try {
      elements = await fetchElementsForArea(area.areaName);
    } catch (error) {
      console.error(`Failed for ${area.areaName}:`, error.message);
      continue;
    }

    fetched += elements.length;
    const mappedDocs = elements
      .map((element) => mapElementToHotelDoc(element, area))
      .filter(Boolean);

    mappedTotal += mappedDocs.length;
    if (!mappedDocs.length) {
      await sleep(1200);
      continue;
    }

    for (let i = 0; i < mappedDocs.length; i += BATCH_SIZE) {
      const batch = mappedDocs.slice(i, i + BATCH_SIZE);
      if (DRY_RUN) {
        skipped += batch.length;
        continue;
      }

      const operations = batch.map((doc) => ({
        updateOne: {
          filter: { osmId: doc.osmId },
          update: {
            $set: {
              name: doc.name,
              city: doc.city,
              country: "India",
              description: doc.description,
              type: doc.type,
              facilities: doc.facilities,
              pricePerNight: doc.pricePerNight,
              starRating: doc.starRating,
              imageUrls: doc.imageUrls,
              location: doc.location,
              contact: doc.contact,
              averageRating: doc.averageRating,
              reviewCount: doc.reviewCount,
              isActive: true,
              updatedAt: new Date(),
              lastUpdated: new Date(),
            },
            $setOnInsert: {
              userId: doc.userId,
              adultCount: doc.adultCount,
              childCount: doc.childCount,
              policies: doc.policies,
              amenities: doc.amenities,
              totalBookings: 0,
              totalRevenue: 0,
              occupancyRate: 0,
              isFeatured: doc.isFeatured,
              createdAt: new Date(),
            },
          },
          upsert: true,
        },
      }));

      const result = await hotels.bulkWrite(operations, { ordered: false });
      upserted += result.upsertedCount || 0;
      modified += result.modifiedCount || 0;
    }

    await sleep(2400);
  }

  const totalHotels = await hotels.countDocuments({});
  console.log("India stays import completed.");
  console.log(`Areas processed: ${targetAreas.length}`);
  console.log(`Fetched OSM elements: ${fetched}`);
  console.log(`Mapped docs: ${mappedTotal}`);
  console.log(`Upserted: ${upserted}`);
  console.log(`Modified: ${modified}`);
  console.log(`Dry-run skipped writes: ${skipped}`);
  console.log(`Total records in hotels collection: ${totalHotels}`);

  await client.close();
  process.exit(0);
}

main().catch((error) => {
  console.error("Import failed:", error);
  process.exit(1);
});
