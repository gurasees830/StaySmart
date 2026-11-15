const dns = require("dns");

// Fix Node.js DNS SRV resolution for MongoDB Atlas
dns.setServers(["192.168.1.1"]);

require("dotenv").config();

const { MongoClient } = require("mongodb");


/**
 * StaySmart Hotel Data Enrichment
 *
 * What this script does:
 *
 * 1. Fixes missing/unknown city values.
 * 2. Fixes missing/unknown country values.
 * 3. Uses existing coordinates to infer the nearest known Indian city.
 * 4. Optionally uses OpenStreetMap Nominatim reverse geocoding.
 * 5. Ensures every hotel has valid image URLs.
 * 6. Replaces unreliable LoremFlickr/Picsum placeholder URLs.
 * 7. Assigns deterministic hotel/resort images.
 * 8. Updates rating fields consistently.
 * 9. Uses bulk MongoDB writes for performance.
 *
 * Usage:
 *
 *   node enrich_hotels_data.js
 *
 * Optional environment variables:
 *
 *   DRY_RUN=true
 *   BATCH_SIZE=250
 *   USE_REVERSE_GEOCODING=true
 *   FORCE_UNIQUE_IMAGES=true
 *
 * Recommended first run:
 *
 *   DRY_RUN=true
 *
 * Then, after checking the output:
 *
 *   DRY_RUN=false
 */



// ------------------------------------------------------------
// CONFIGURATION
// ------------------------------------------------------------

const MONGO_URI = process.env.MONGODB_CONNECTION_STRING;

const DRY_RUN =
  String(process.env.DRY_RUN || "false").toLowerCase() === "true";

const BATCH_SIZE = Math.max(
  1,
  parseInt(process.env.BATCH_SIZE || "250", 10)
);

const USE_REVERSE_GEOCODING =
  String(process.env.USE_REVERSE_GEOCODING || "false").toLowerCase() ===
  "true";

const FORCE_UNIQUE_IMAGES =
  String(process.env.FORCE_UNIQUE_IMAGES || "true").toLowerCase() === "true";

// ------------------------------------------------------------
// VALIDATION
// ------------------------------------------------------------

if (!MONGO_URI) {
  console.error(
    "ERROR: MONGODB_CONNECTION_STRING is missing from your .env file."
  );
  process.exit(1);
}

// ------------------------------------------------------------
// CONSTANTS
// ------------------------------------------------------------

const UNKNOWN_VALUES = new Set([
  "",
  "unknown",
  "n/a",
  "na",
  "none",
  "null",
  "-",
]);

const STATE_NAMES = new Set(
  [
    "andhra pradesh",
    "arunachal pradesh",
    "assam",
    "bihar",
    "chhattisgarh",
    "goa",
    "gujarat",
    "haryana",
    "himachal pradesh",
    "jharkhand",
    "karnataka",
    "kerala",
    "madhya pradesh",
    "maharashtra",
    "manipur",
    "meghalaya",
    "mizoram",
    "nagaland",
    "odisha",
    "punjab",
    "rajasthan",
    "sikkim",
    "tamil nadu",
    "telangana",
    "tripura",
    "uttar pradesh",
    "uttarakhand",
    "west bengal",
    "delhi",
    "jammu and kashmir",
    "ladakh",
    "puducherry",
    "andaman and nicobar islands",
    "chandigarh",
    "dadra and nagar haveli and daman and diu",
  ].map((value) => value.toLowerCase())
);

// ------------------------------------------------------------
// INDIAN CITY DATABASE
// ------------------------------------------------------------

const INDIAN_CITIES = [
  {
    city: "Mumbai",
    state: "Maharashtra",
    lat: 19.076,
    lon: 72.8777,
  },
  {
    city: "Delhi",
    state: "Delhi",
    lat: 28.6139,
    lon: 77.209,
  },
  {
    city: "New Delhi",
    state: "Delhi",
    lat: 28.6139,
    lon: 77.209,
  },
  {
    city: "Bengaluru",
    state: "Karnataka",
    lat: 12.9716,
    lon: 77.5946,
  },
  {
    city: "Hyderabad",
    state: "Telangana",
    lat: 17.385,
    lon: 78.4867,
  },
  {
    city: "Chennai",
    state: "Tamil Nadu",
    lat: 13.0827,
    lon: 80.2707,
  },
  {
    city: "Kolkata",
    state: "West Bengal",
    lat: 22.5726,
    lon: 88.3639,
  },
  {
    city: "Pune",
    state: "Maharashtra",
    lat: 18.5204,
    lon: 73.8567,
  },
  {
    city: "Ahmedabad",
    state: "Gujarat",
    lat: 23.0225,
    lon: 72.5714,
  },
  {
    city: "Jaipur",
    state: "Rajasthan",
    lat: 26.9124,
    lon: 75.7873,
  },
  {
    city: "Surat",
    state: "Gujarat",
    lat: 21.1702,
    lon: 72.8311,
  },
  {
    city: "Lucknow",
    state: "Uttar Pradesh",
    lat: 26.8467,
    lon: 80.9462,
  },
  {
    city: "Kanpur",
    state: "Uttar Pradesh",
    lat: 26.4499,
    lon: 80.3319,
  },
  {
    city: "Nagpur",
    state: "Maharashtra",
    lat: 21.1458,
    lon: 79.0882,
  },
  {
    city: "Indore",
    state: "Madhya Pradesh",
    lat: 22.7196,
    lon: 75.8577,
  },
  {
    city: "Bhopal",
    state: "Madhya Pradesh",
    lat: 23.2599,
    lon: 77.4126,
  },
  {
    city: "Patna",
    state: "Bihar",
    lat: 25.5941,
    lon: 85.1376,
  },
  {
    city: "Ranchi",
    state: "Jharkhand",
    lat: 23.3441,
    lon: 85.3096,
  },
  {
    city: "Bhubaneswar",
    state: "Odisha",
    lat: 20.2961,
    lon: 85.8245,
  },
  {
    city: "Visakhapatnam",
    state: "Andhra Pradesh",
    lat: 17.6868,
    lon: 83.2185,
  },
  {
    city: "Coimbatore",
    state: "Tamil Nadu",
    lat: 11.0168,
    lon: 76.9558,
  },
  {
    city: "Kochi",
    state: "Kerala",
    lat: 9.9312,
    lon: 76.2673,
  },
  {
    city: "Thiruvananthapuram",
    state: "Kerala",
    lat: 8.5241,
    lon: 76.9366,
  },
  {
    city: "Vijayawada",
    state: "Andhra Pradesh",
    lat: 16.5062,
    lon: 80.648,
  },
  {
    city: "Mysuru",
    state: "Karnataka",
    lat: 12.2958,
    lon: 76.6394,
  },
  {
    city: "Mangaluru",
    state: "Karnataka",
    lat: 12.9141,
    lon: 74.856,
  },
  {
    city: "Madurai",
    state: "Tamil Nadu",
    lat: 9.9252,
    lon: 78.1198,
  },
  {
    city: "Varanasi",
    state: "Uttar Pradesh",
    lat: 25.3176,
    lon: 82.9739,
  },
  {
    city: "Agra",
    state: "Uttar Pradesh",
    lat: 27.1767,
    lon: 78.0081,
  },
  {
    city: "Dehradun",
    state: "Uttarakhand",
    lat: 30.3165,
    lon: 78.0322,
  },
  {
    city: "Shimla",
    state: "Himachal Pradesh",
    lat: 31.1048,
    lon: 77.1734,
  },
  {
    city: "Srinagar",
    state: "Jammu and Kashmir",
    lat: 34.0837,
    lon: 74.7973,
  },
  {
    city: "Jodhpur",
    state: "Rajasthan",
    lat: 26.2389,
    lon: 73.0243,
  },
  {
    city: "Udaipur",
    state: "Rajasthan",
    lat: 24.5854,
    lon: 73.7125,
  },
  {
    city: "Amritsar",
    state: "Punjab",
    lat: 31.634,
    lon: 74.8723,
  },
  {
    city: "Chandigarh",
    state: "Chandigarh",
    lat: 30.7333,
    lon: 76.7794,
  },
  {
    city: "Guwahati",
    state: "Assam",
    lat: 26.1445,
    lon: 91.7362,
  },
  {
    city: "Gangtok",
    state: "Sikkim",
    lat: 27.3389,
    lon: 88.6065,
  },
  {
    city: "Panaji",
    state: "Goa",
    lat: 15.4909,
    lon: 73.8278,
  },
  {
    city: "Port Blair",
    state: "Andaman and Nicobar Islands",
    lat: 11.6234,
    lon: 92.7265,
  },
];

// ------------------------------------------------------------
// HOTEL IMAGE POOL
// ------------------------------------------------------------
//
// These are direct image URLs from Unsplash's image CDN.
//
// IMPORTANT:
// For a commercial/production deployment, replace this pool with
// images you have the right to use, preferably images uploaded to
// your own Cloudinary account.
//
// The ?auto=format... parameters optimize the image for the browser.
//

const HOTEL_IMAGE_POOL = [
  "https://images.unsplash.com/photo-1564501049412-61c2a3083791",
  "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa",
  "https://images.unsplash.com/photo-1566073771259-6a8506099945",
  "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b",
  "https://images.unsplash.com/photo-1566665797739-1674de7a421a",
  "https://images.unsplash.com/photo-1578683010236-d716f9a3f461",
  "https://images.unsplash.com/photo-1590490360182-c33d57733427",
  "https://images.unsplash.com/photo-1601918774946-25832a4be0d6",
  "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb",
  "https://images.unsplash.com/photo-1571896349842-33c89424de2d",
  "https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9",
  "https://images.unsplash.com/photo-1611892440504-42a792e24d32",
  "https://images.unsplash.com/photo-1596436889106-be35e843f9c0",
  "https://images.unsplash.com/photo-1596178065887-1198b6148b2b",
  "https://images.unsplash.com/photo-1584132967334-10e028bd69f7",
  "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c",
  "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3",
  "https://images.unsplash.com/photo-1600585154340-be6161a56a0c",
  "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d",
  "https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea",
  "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0",
  "https://images.unsplash.com/photo-1600607688969-a5bfcd646154",
  "https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde",
  "https://images.unsplash.com/photo-1600585154526-990dced4db0d",
  "https://images.unsplash.com/photo-1600573472550-8090b5e0745e",
  "https://images.unsplash.com/photo-1600607688960-e095ff83135c",
  "https://images.unsplash.com/photo-1600566753376-12c8ab7fb75b",
  "https://images.unsplash.com/photo-1600210491892-03d54c0aaf87",
  "https://images.unsplash.com/photo-1613490493576-7fde63acd811",
  "https://images.unsplash.com/photo-1600585154363-67eb9e2e2099",
  "https://images.unsplash.com/photo-1600566752355-35792bedcfea",
];

// ------------------------------------------------------------
// HELPER FUNCTIONS
// ------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).replace(/\s+/g, " ").trim();
}

function isUnknownValue(value, allowIndia = false) {
  const normalized = normalizeText(value).toLowerCase();

  if (!normalized) {
    return true;
  }

  if (allowIndia && normalized === "india") {
    return false;
  }

  if (normalized.startsWith("unknown")) {
    return true;
  }

  return (
    UNKNOWN_VALUES.has(normalized) ||
    normalized === "unknown, india"
  );
}

function titleCase(value) {
  const cleaned = normalizeText(value);

  if (!cleaned) {
    return "";
  }

  return cleaned
    .split(" ")
    .map((word) => {
      if (word.length <= 2 && word === word.toUpperCase()) {
        return word;
      }

      return (
        word.charAt(0).toUpperCase() +
        word.slice(1).toLowerCase()
      );
    })
    .join(" ");
}

function isHttpUrl(value) {
  if (!value || typeof value !== "string") {
    return false;
  }

  return /^https?:\/\/.+/i.test(value);
}

function dedupe(values) {
  return Array.from(
    new Set(
      values.filter(Boolean)
    )
  );
}

function hashString(value) {
  let hash = 0;

  for (let i = 0; i < value.length; i += 1) {
    hash =
      (hash * 31 + value.charCodeAt(i)) >>> 0;
  }

  return hash;
}

// ------------------------------------------------------------
// COORDINATES
// ------------------------------------------------------------

function getCoordinates(doc) {
  const location = doc.location || {};

  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);

  if (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude !== 0 &&
    longitude !== 0
  ) {
    return {
      latitude,
      longitude,
    };
  }

  if (
    Array.isArray(location.coordinates) &&
    location.coordinates.length >= 2
  ) {
    const longitudeFromArray = Number(
      location.coordinates[0]
    );

    const latitudeFromArray = Number(
      location.coordinates[1]
    );

    if (
      Number.isFinite(latitudeFromArray) &&
      Number.isFinite(longitudeFromArray)
    ) {
      return {
        latitude: latitudeFromArray,
        longitude: longitudeFromArray,
      };
    }
  }

  return null;
}

// ------------------------------------------------------------
// ADDRESS PARSING
// ------------------------------------------------------------

function parseAddressParts(value) {
  if (!value || typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((token) => normalizeText(token))
    .filter(Boolean);
}

function looksLikeCity(value) {
  const cleaned = normalizeText(value).toLowerCase();

  if (!cleaned) {
    return false;
  }

  if (STATE_NAMES.has(cleaned)) {
    return false;
  }

  if (/\d/.test(cleaned)) {
    return false;
  }

  if (
    /\b(highway|road|rd|street|st|lane|ln|marg|expressway|bypass|junction)\b/i.test(
      cleaned
    )
  ) {
    return false;
  }

  if (cleaned.length < 3) {
    return false;
  }

  return !UNKNOWN_VALUES.has(cleaned);
}

function parseCityFromAddress(address) {
  const tokens = parseAddressParts(address);

  if (tokens.length === 0) {
    return "";
  }

  const preferredIndexes = [
    tokens.length - 3,
    tokens.length - 2,
    1,
    0,
  ];

  for (const index of preferredIndexes) {
    if (
      index >= 0 &&
      index < tokens.length &&
      looksLikeCity(tokens[index])
    ) {
      return titleCase(tokens[index]);
    }
  }

  for (const token of tokens) {
    if (looksLikeCity(token)) {
      return titleCase(token);
    }
  }

  return "";
}

function parseStateFromAddress(address) {
  const tokens = parseAddressParts(address);

  for (const token of tokens) {
    const normalized = token.toLowerCase();

    if (STATE_NAMES.has(normalized)) {
      return titleCase(token);
    }
  }

  return "";
}

// ------------------------------------------------------------
// DISTANCE / NEAREST CITY
// ------------------------------------------------------------

function haversineDistanceKm(
  lat1,
  lon1,
  lat2,
  lon2
) {
  const toRad = (degrees) =>
    (degrees * Math.PI) / 180;

  const earthRadiusKm = 6371;

  const deltaLat = toRad(lat2 - lat1);
  const deltaLon = toRad(lon2 - lon1);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(deltaLon / 2) ** 2;

  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return earthRadiusKm * c;
}

function inferNearestCity(latitude, longitude) {
  let bestCity = null;
  let shortestDistance = Number.POSITIVE_INFINITY;

  for (const city of INDIAN_CITIES) {
    const distance = haversineDistanceKm(
      latitude,
      longitude,
      city.lat,
      city.lon
    );

    if (distance < shortestDistance) {
      shortestDistance = distance;
      bestCity = city;
    }
  }

  return bestCity;
}

// ------------------------------------------------------------
// OPTIONAL REVERSE GEOCODING
// ------------------------------------------------------------

async function reverseGeocode(
  latitude,
  longitude,
  cache
) {
  const cacheKey =
    `${latitude.toFixed(3)},${longitude.toFixed(3)}`;

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  try {
    const url =
      "https://nominatim.openstreetmap.org/reverse" +
      `?format=json&lat=${latitude}&lon=${longitude}` +
      "&zoom=10&addressdetails=1";

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "staysmart-data-enricher/1.0",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Nominatim status ${response.status}`
      );
    }

    const data = await response.json();

    const city = titleCase(
      data?.address?.city ||
        data?.address?.town ||
        data?.address?.village ||
        data?.address?.municipality ||
        ""
    );

    const state = titleCase(
      data?.address?.state || ""
    );

    const country = titleCase(
      data?.address?.country || "India"
    ) || "India";

    const result = {
      city,
      state,
      country,
    };

    cache.set(cacheKey, result);

    // Nominatim asks clients to avoid excessive requests.
    await sleep(1100);

    return result;
  } catch (error) {
    console.warn(
      `Reverse geocoding failed for ${cacheKey}:`,
      error.message
    );

    const fallback = {
      city: "",
      state: "",
      country: "India",
    };

    cache.set(cacheKey, fallback);

    return fallback;
  }
}

// ------------------------------------------------------------
// IMAGE HANDLING
// ------------------------------------------------------------

function buildImageUrl(baseUrl) {
  return (
    `${baseUrl}` +
    "?auto=format&fit=crop&w=1600&q=85"
  );
}

/**
 * Generate three deterministic images for a hotel.
 *
 * The hotel _id + city determine the selected images.
 *
 * Different hotels normally receive different combinations.
 */
function pickImagesForHotel(docId, city) {
  const citySlug =
    normalizeText(city)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-") ||
    "india";

  const hotelKey =
    `${citySlug}-${String(docId)}`;

  const hash = hashString(hotelKey);

  const poolSize = HOTEL_IMAGE_POOL.length;

  const index1 =
    hash % poolSize;

  const index2 =
    (hash + 7) % poolSize;

  const index3 =
    (hash + 17) % poolSize;

  const selectedImages = [
    HOTEL_IMAGE_POOL[index1],
    HOTEL_IMAGE_POOL[index2],
    HOTEL_IMAGE_POOL[index3],
  ];

  return dedupe(
    selectedImages.map(buildImageUrl)
  );
}

/**
 * Detect old placeholder URLs generated by the previous script.
 */
function isOldGeneratedImage(url) {
  if (!url || typeof url !== "string") {
    return false;
  }

  const normalized = url.toLowerCase();

  return (
    normalized.includes("loremflickr.com") ||
    normalized.includes("picsum.photos")
  );
}

// ------------------------------------------------------------
// RATINGS
// ------------------------------------------------------------

function buildRatings(
  docId,
  currentStarRating
) {
  const hash = hashString(
    `rating-${docId}`
  );

  const normalizedStar =
    Number(currentStarRating);

  const starRating =
    Number.isFinite(normalizedStar) &&
    normalizedStar >= 1 &&
    normalizedStar <= 5
      ? Math.round(normalizedStar)
      : 3 + (hash % 3);

  const reviewCount =
    25 + (hash % 1200);

  const ratingFraction =
    (hash % 1000) / 1000;

  const minAverage =
    Math.max(
      3.2,
      starRating - 0.8
    );

  const maxAverage =
    Math.min(
      4.9,
      starRating + 0.3
    );

  const averageRating =
    Number(
      (
        minAverage +
        (maxAverage - minAverage) *
          ratingFraction
      ).toFixed(1)
    );

  return {
    starRating,
    averageRating,
    reviewCount,
  };
}

// ------------------------------------------------------------
// ARRAY COMPARISON
// ------------------------------------------------------------

function arraysEqual(a = [], b = []) {
  if (a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }

  return true;
}

// ------------------------------------------------------------
// MAIN
// ------------------------------------------------------------

async function main() {
  console.log("");
  console.log("==============================================");
  console.log("       StaySmart Hotel Data Enrichment");
  console.log("==============================================");
  console.log("");

  console.log("Connecting to MongoDB...");

  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();

    const db = client.db();

    const hotels = db.collection("hotels");

    const total =
      await hotels.countDocuments({});

    const reverseGeoCache =
      new Map();

    console.log(
      `Connected to database: ${db.databaseName}`
    );

    console.log(
      `Hotels to process: ${total}`
    );

    console.log(
      `Dry run: ${DRY_RUN}`
    );

    console.log(
      `Reverse geocoding: ${USE_REVERSE_GEOCODING}`
    );

    console.log(
      `Force unique images: ${FORCE_UNIQUE_IMAGES}`
    );

    console.log(
      `Image pool size: ${HOTEL_IMAGE_POOL.length}`
    );

    console.log("");

    // --------------------------------------------------------
    // CURSOR
    // --------------------------------------------------------

    const cursor = hotels.find(
      {},
      {
        projection: {
          _id: 1,
          city: 1,
          country: 1,
          address: 1,
          imageUrls: 1,
          location: 1,
          starRating: 1,
          averageRating: 1,
          reviewCount: 1,
        },
      }
    );

    // --------------------------------------------------------
    // COUNTERS
    // --------------------------------------------------------

    let processed = 0;
    let updatedCount = 0;
    let unknownCityFixed = 0;
    let imagesUpdated = 0;
    let ratingsUpdated = 0;

    let bulkOps = [];

    // --------------------------------------------------------
    // PROCESS HOTELS
    // --------------------------------------------------------

    while (await cursor.hasNext()) {
      const doc = await cursor.next();

      if (!doc) {
        continue;
      }

      processed += 1;

      // ------------------------------------------------------
      // COORDINATES
      // ------------------------------------------------------

      const coordinates =
        getCoordinates(doc);

      // ------------------------------------------------------
      // OLD VALUES
      // ------------------------------------------------------

      const oldCity =
        titleCase(doc.city || "");

      const oldCountry =
        titleCase(doc.country || "");

      const oldAddressCity =
        titleCase(
          doc?.location?.address?.city || ""
        );

      const oldAddressState =
        titleCase(
          doc?.location?.address?.state || ""
        );

      const oldAddressCountry =
        titleCase(
          doc?.location?.address?.country || ""
        );

      // ------------------------------------------------------
      // CITY RESOLUTION
      // ------------------------------------------------------

      let resolvedCity =
        looksLikeCity(oldCity)
          ? oldCity
          : looksLikeCity(oldAddressCity)
            ? oldAddressCity
            : parseCityFromAddress(
                doc.address ||
                  doc?.location?.address?.street ||
                  ""
              );

      // ------------------------------------------------------
      // STATE RESOLUTION
      // ------------------------------------------------------

      let resolvedState =
        !isUnknownValue(oldAddressState) &&
        STATE_NAMES.has(
          oldAddressState.toLowerCase()
        )
          ? oldAddressState
          : parseStateFromAddress(
              doc.address || ""
            );

      // ------------------------------------------------------
      // COUNTRY RESOLUTION
      // ------------------------------------------------------

      let resolvedCountry =
        !isUnknownValue(
          oldCountry,
          true
        )
          ? oldCountry
          : !isUnknownValue(
              oldAddressCountry,
              true
            )
            ? oldAddressCountry
            : "India";

      // ------------------------------------------------------
      // REVERSE GEOCODING
      // ------------------------------------------------------

      if (
        (!resolvedCity ||
          isUnknownValue(resolvedCity)) &&
        coordinates
      ) {
        if (USE_REVERSE_GEOCODING) {
          const reverse =
            await reverseGeocode(
              coordinates.latitude,
              coordinates.longitude,
              reverseGeoCache
            );

          if (
            !isUnknownValue(reverse.city)
          ) {
            resolvedCity =
              reverse.city;
          }

          if (
            !resolvedState &&
            !isUnknownValue(reverse.state)
          ) {
            resolvedState =
              reverse.state;
          }

          if (
            isUnknownValue(
              resolvedCountry,
              true
            ) &&
            !isUnknownValue(
              reverse.country,
              true
            )
          ) {
            resolvedCountry =
              reverse.country;
          }
        }

        // ----------------------------------------------------
        // NEAREST CITY FALLBACK
        // ----------------------------------------------------

        if (
          !resolvedCity ||
          isUnknownValue(resolvedCity)
        ) {
          const nearest =
            inferNearestCity(
              coordinates.latitude,
              coordinates.longitude
            );

          if (nearest) {
            resolvedCity =
              nearest.city;

            if (!resolvedState) {
              resolvedState =
                nearest.state;
            }

            if (
              isUnknownValue(
                resolvedCountry,
                true
              )
            ) {
              resolvedCountry =
                "India";
            }
          }
        }
      }

      // ------------------------------------------------------
      // FINAL CITY / COUNTRY FALLBACKS
      // ------------------------------------------------------

      if (
        !resolvedCity ||
        isUnknownValue(resolvedCity)
      ) {
        resolvedCity =
          "Unknown City";
      }

      if (
        !resolvedCountry ||
        isUnknownValue(
          resolvedCountry,
          true
        )
      ) {
        resolvedCountry =
          "India";
      }

      resolvedCity =
        titleCase(resolvedCity);

      resolvedState =
        titleCase(resolvedState);

      resolvedCountry =
        titleCase(resolvedCountry);

      // ------------------------------------------------------
      // EXISTING IMAGES
      // ------------------------------------------------------

      const existingImages =
        Array.isArray(doc.imageUrls)
          ? dedupe(
              doc.imageUrls
                .map(normalizeText)
                .filter(isHttpUrl)
            )
          : [];

      // ------------------------------------------------------
      // DETERMINE WHETHER IMAGES NEED REPLACEMENT
      // ------------------------------------------------------

      const hasOldGeneratedImages =
        existingImages.some(
          isOldGeneratedImage
        );

      const generatedImages =
        pickImagesForHotel(
          String(doc._id),
          resolvedCity
        );

      let finalImages;

      if (FORCE_UNIQUE_IMAGES) {
        finalImages =
          generatedImages;
      } else if (
        existingImages.length > 0 &&
        !hasOldGeneratedImages
      ) {
        // Keep existing valid images.
        finalImages =
          existingImages;
      } else {
        // Replace missing/old placeholder images.
        finalImages =
          generatedImages;
      }

      // ------------------------------------------------------
      // RATINGS
      // ------------------------------------------------------

      const ratingProfile =
        buildRatings(
          String(doc._id),
          doc.starRating
        );

      // ------------------------------------------------------
      // LOCATION
      // ------------------------------------------------------

      const location =
        doc.location &&
        typeof doc.location === "object"
          ? doc.location
          : {};

      const locationAddress =
        location.address &&
        typeof location.address === "object"
          ? location.address
          : {};

      const updatedLocation = {
        ...location,

        ...(coordinates
          ? {
              latitude:
                coordinates.latitude,
              longitude:
                coordinates.longitude,
            }
          : {}),

        address: {
          ...locationAddress,

          city: resolvedCity,

          state:
            resolvedState ||
            locationAddress.state ||
            "",

          country:
            resolvedCountry,
        },
      };

      // ------------------------------------------------------
      // UPDATE FIELDS
      // ------------------------------------------------------

      const updateFields = {};

      if (
        oldCity !== resolvedCity
      ) {
        updateFields.city =
          resolvedCity;
      }

      if (
        oldCountry !== resolvedCountry
      ) {
        updateFields.country =
          resolvedCountry;
      }

      if (
        !arraysEqual(
          existingImages,
          finalImages
        )
      ) {
        updateFields.imageUrls =
          finalImages;
      }

      let ratingChanged =
        false;

      if (
        Number(doc.starRating) !==
        ratingProfile.starRating
      ) {
        updateFields.starRating =
          ratingProfile.starRating;

        ratingChanged = true;
      }

      if (
        Number(doc.averageRating) !==
        ratingProfile.averageRating
      ) {
        updateFields.averageRating =
          ratingProfile.averageRating;

        ratingChanged = true;
      }

      if (
        Number(doc.reviewCount) !==
        ratingProfile.reviewCount
      ) {
        updateFields.reviewCount =
          ratingProfile.reviewCount;

        ratingChanged = true;
      }

      if (ratingChanged) {
        ratingsUpdated += 1;
      }

      updateFields.location =
        updatedLocation;

      // ------------------------------------------------------
      // STAGE BULK UPDATE
      // ------------------------------------------------------

      if (
        Object.keys(updateFields).length > 0
      ) {
        bulkOps.push({
          updateOne: {
            filter: {
              _id: doc._id,
            },

            update: {
              $set: updateFields,
            },
          },
        });

        updatedCount += 1;
      }

      // ------------------------------------------------------
      // COUNTERS
      // ------------------------------------------------------

      if (
        isUnknownValue(oldCity) &&
        !isUnknownValue(resolvedCity)
      ) {
        unknownCityFixed += 1;
      }

      if (
        !arraysEqual(
          existingImages,
          finalImages
        )
      ) {
        imagesUpdated += 1;
      }

      // ------------------------------------------------------
      // WRITE BATCH
      // ------------------------------------------------------

      if (
        bulkOps.length >= BATCH_SIZE
      ) {
        if (!DRY_RUN) {
          await hotels.bulkWrite(
            bulkOps,
            {
              ordered: false,
            }
          );
        }

        bulkOps = [];
      }

      // ------------------------------------------------------
      // PROGRESS
      // ------------------------------------------------------

      if (processed % 500 === 0) {
        console.log(
          `Processed ${processed}/${total} | ` +
            `staged updates: ${updatedCount} | ` +
            `city fixes: ${unknownCityFixed} | ` +
            `images updated: ${imagesUpdated} | ` +
            `ratings updated: ${ratingsUpdated}`
        );
      }
    }

    // --------------------------------------------------------
    // FINAL BATCH
    // --------------------------------------------------------

    if (
      bulkOps.length > 0 &&
      !DRY_RUN
    ) {
      await hotels.bulkWrite(
        bulkOps,
        {
          ordered: false,
        }
      );
    }

    // --------------------------------------------------------
    // FINAL REPORT
    // --------------------------------------------------------

    console.log("");
    console.log("==============================================");
    console.log("          Enrichment completed");
    console.log("==============================================");
    console.log("");

    console.log(
      `Processed: ${processed}`
    );

    console.log(
      `Updated documents: ${updatedCount}`
    );

    console.log(
      `Unknown city values fixed: ${unknownCityFixed}`
    );

    console.log(
      `Hotels with refreshed image URLs: ${imagesUpdated}`
    );

    console.log(
      `Rating fields updated: ${ratingsUpdated}`
    );

    console.log(
      `Mode: ${
        DRY_RUN
          ? "DRY_RUN (no database writes)"
          : "WRITE"
      }`
    );

    console.log("");

    if (DRY_RUN) {
      console.log(
        "DRY_RUN was enabled."
      );

      console.log(
        "No database changes were made."
      );

      console.log(
        "Run again with DRY_RUN=false to save changes."
      );
    } else {
      console.log(
        "Database changes have been written."
      );
    }

    console.log("");
  } finally {
    await client.close();

    console.log(
      "MongoDB connection closed."
    );
  }
}

// ------------------------------------------------------------
// START
// ------------------------------------------------------------

main().catch((error) => {
  console.error("");
  console.error(
    "=============================================="
  );
  console.error(
    "       DATA ENRICHMENT FAILED"
  );
  console.error(
    "=============================================="
  );
  console.error("");

  console.error(error);

  process.exit(1);
});

