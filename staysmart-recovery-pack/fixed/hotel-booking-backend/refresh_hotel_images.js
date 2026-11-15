/**
 * StaySmart - Hotel Image Refresh
 *
 * Purpose:
 * - Replace legacy hotel images.
 * - Detect duplicate hotel images.
 * - Assign unique Unsplash photos across the entire MongoDB catalogue.
 * - Persist Unsplash photo IDs so future runs can detect duplicates.
 * - Resume safely.
 * - Avoid replacing already-unique good images unnecessarily.
 *
 * Usage:
 *   node refresh_hotel_images.js
 *
 * Optional PowerShell:
 *   $env:IMAGE_LIMIT=100
 *   $env:IMAGE_REQUEST_DELAY_MS=1100
 *   $env:UNSPLASH_MAX_PAGES=3
 *   node refresh_hotel_images.js
 *
 * Environment variables required:
 *   MONGODB_CONNECTION_STRING=...
 *   UNSPLASH_ACCESS_KEY=...
 *
 * Optional:
 *   IMAGE_LIMIT=18000
 *   IMAGE_REQUEST_DELAY_MS=1100
 *   UNSPLASH_MAX_PAGES=3
 *   DRY_RUN=false
 */

require("dotenv").config();

const dns = require("dns");
const mongoose = require("mongoose");

// ------------------------------------------------------------
// DNS
// ------------------------------------------------------------

if (
  process.env.MONGODB_DNS_SERVER ||
  process.env.NODE_ENV === "development"
) {
  dns.setServers([
    (process.env.MONGODB_DNS_SERVER || "192.168.1.1").trim(),
  ]);
}

// ------------------------------------------------------------
// Configuration
// ------------------------------------------------------------

const connectionString = process.env.MONGODB_CONNECTION_STRING;
const accessKey = process.env.UNSPLASH_ACCESS_KEY;

const limit = Number(process.env.IMAGE_LIMIT || 18000);

const delayMs = Number(
  process.env.IMAGE_REQUEST_DELAY_MS || 1100
);

const maxPages = Number(
  process.env.UNSPLASH_MAX_PAGES || 3
);

const dryRun =
  String(process.env.DRY_RUN || "false").toLowerCase() === "true";

const UNSPLASH_PER_PAGE = 30;

if (!connectionString) {
  console.error(
    "ERROR: MONGODB_CONNECTION_STRING is missing from .env"
  );
  process.exit(1);
}

if (!accessKey) {
  console.error(
    "ERROR: UNSPLASH_ACCESS_KEY is missing from .env"
  );
  process.exit(1);
}

// ------------------------------------------------------------
// MongoDB model
// ------------------------------------------------------------

const Hotel = mongoose.model(
  "HotelImageRefresh",
  new mongoose.Schema({}, { strict: false }),
  "hotels"
);

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function normalizeImageUrl(url) {
  if (!url || typeof url !== "string") {
    return null;
  }

  // Remove query parameters so the same Unsplash image
  // with different resizing parameters is treated as the same URL.
  return url.split("?")[0].trim();
}

function isLegacyImage(url) {
  if (!url || typeof url !== "string") {
    return true;
  }

  return /source\.unsplash\.com|quickchart|loremflickr/i.test(url);
}

function isUnsplashImage(url) {
  if (!url || typeof url !== "string") {
    return false;
  }

  return /images\.unsplash\.com/i.test(url);
}

/**
 * Attempts to extract the image identifier from a stored
 * Unsplash image URL.
 *
 * This is only a fallback.
 *
 * The reliable identifier is photo.id returned directly
 * by the Unsplash API and stored in imagePhotoId.
 */
function extractPossibleUnsplashImageIdentifier(url) {
  if (!isUnsplashImage(url)) {
    return null;
  }

  const normalized = normalizeImageUrl(url);

  if (!normalized) {
    return null;
  }

  const match = normalized.match(
    /images\.unsplash\.com\/([^/]+)$/i
  );

  return match ? match[1] : null;
}

function getHotelSearchQuery(hotel) {
  const parts = [
    hotel.name,
    hotel.city,
    hotel.location?.address?.state,
    "India",
    "hotel",
  ].filter(Boolean);

  return parts.join(" ");
}

function getHotelDisplayName(hotel) {
  return `${hotel.name || "Unknown hotel"} — ${
    hotel.city || "Unknown city"
  }`;
}

/**
 * Creates a stable URL from an Unsplash API photo.
 */
function buildUnsplashUrl(photo) {
  if (!photo?.urls?.regular) {
    return null;
  }

  const separator = photo.urls.regular.includes("?")
    ? "&"
    : "?";

  return `${photo.urls.regular}${separator}auto=format&fit=crop&w=1600&q=82`;
}

/**
 * Small deterministic hash.
 *
 * Used only to choose between otherwise-unused candidates.
 * It does NOT control uniqueness.
 */
function stableHash(value) {
  const string = String(value || "");

  let hash = 0;

  for (let i = 0; i < string.length; i++) {
    hash =
      (hash << 5) -
      hash +
      string.charCodeAt(i);

    hash |= 0;
  }

  return Math.abs(hash);
}

// ------------------------------------------------------------
// Global uniqueness state
// ------------------------------------------------------------

/**
 * Unsplash API photo IDs already used by hotels.
 */
const usedPhotoIds = new Set();

/**
 * Normalized image URLs already used by hotels.
 *
 * This is useful for old records that don't have imagePhotoId.
 */
const usedImageUrls = new Set();

/**
 * Hotel IDs whose image is already unique.
 */
const duplicateHotelIds = new Set();

// ------------------------------------------------------------
// Load existing image usage from MongoDB
// ------------------------------------------------------------

async function loadExistingImageUsage() {
  console.log("");
  console.log("==============================================");
  console.log(" Loading existing image usage from MongoDB");
  console.log("==============================================");
  console.log("");

  const cursor = Hotel.find(
    {
      imageUrls: {
        $exists: true,
      },
    },
    {
      imageUrls: 1,
      imagePhotoId: 1,
    }
  )
    .lean()
    .cursor();

  let hotelsScanned = 0;
  let urlsFound = 0;
  let photoIdsFound = 0;

  for await (const hotel of cursor) {
    hotelsScanned += 1;

    // --------------------------------------------------------
    // Stored Unsplash photo ID
    // --------------------------------------------------------

    if (hotel.imagePhotoId) {
      usedPhotoIds.add(String(hotel.imagePhotoId));
      photoIdsFound += 1;
    }

    // --------------------------------------------------------
    // Existing image URLs
    // --------------------------------------------------------

    for (const url of hotel.imageUrls || []) {
      if (!url) {
        continue;
      }

      const normalized = normalizeImageUrl(url);

      if (normalized) {
        usedImageUrls.add(normalized);
        urlsFound += 1;
      }
    }

    // --------------------------------------------------------
    // Fallback: if imagePhotoId isn't available,
    // remember the image URL itself.
    // --------------------------------------------------------

    if (!hotel.imagePhotoId && hotel.imageUrls?.[0]) {
      const possibleId =
        extractPossibleUnsplashImageIdentifier(
          hotel.imageUrls[0]
        );

      if (possibleId) {
        usedPhotoIds.add(possibleId);
      }
    }
  }

  console.log(`Hotels scanned: ${hotelsScanned}`);
  console.log(`Existing image URLs: ${usedImageUrls.size}`);
  console.log(`Existing photo IDs: ${photoIdsFound}`);

  console.log("");
}

// ------------------------------------------------------------
// Find duplicate image URLs in MongoDB
// ------------------------------------------------------------

async function findDuplicateHotels() {
  console.log(
    "Scanning MongoDB for duplicate hotel images..."
  );

  const duplicateGroups = await Hotel.aggregate([
    {
      $match: {
        "imageUrls.0": {
          $exists: true,
        },
      },
    },

    {
      $group: {
        _id: {
          $arrayElemAt: ["$imageUrls", 0],
        },

        hotelIds: {
          $push: "$_id",
        },

        count: {
          $sum: 1,
        },
      },
    },

    {
      $match: {
        count: {
          $gt: 1,
        },
      },
    },
  ]);

  for (const group of duplicateGroups) {
    for (const hotelId of group.hotelIds) {
      duplicateHotelIds.add(String(hotelId));
    }
  }

  console.log(
    `Duplicate image groups found: ${duplicateGroups.length}`
  );

  console.log(
    `Hotels requiring duplicate-image review: ${duplicateHotelIds.size}`
  );

  console.log("");

  return duplicateGroups;
}

// ------------------------------------------------------------
// Unsplash search
// ------------------------------------------------------------

async function searchUnsplash(query, page) {
  const url =
    "https://api.unsplash.com/search/photos" +
    `?query=${encodeURIComponent(query)}` +
    `&orientation=landscape` +
    `&per_page=${UNSPLASH_PER_PAGE}` +
    `&page=${page}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Client-ID ${accessKey}`,
      "Accept-Version": "v1",
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");

    throw new Error(
      `Unsplash returned ${response.status}${
        text ? `: ${text.slice(0, 200)}` : ""
      }`
    );
  }

  return response.json();
}

// ------------------------------------------------------------
// Select a globally-unused photo
// ------------------------------------------------------------

async function findFreeHotelPhoto(hotel) {
  const query = getHotelSearchQuery(hotel);

  console.log(`Searching Unsplash: "${query}"`);

  let allCandidates = [];

  for (
    let page = 1;
    page <= maxPages;
    page++
  ) {
    const data = await searchUnsplash(query, page);

    const results = data.results || [];

    if (!results.length) {
      break;
    }

    for (const photo of results) {
      if (!photo?.id) {
        continue;
      }

      if (!photo.urls?.regular) {
        continue;
      }

      // ------------------------------------------------------
      // Global photo-ID uniqueness
      // ------------------------------------------------------

      if (usedPhotoIds.has(String(photo.id))) {
        continue;
      }

      // ------------------------------------------------------
      // URL uniqueness
      // ------------------------------------------------------

      const normalizedUrl = normalizeImageUrl(
        photo.urls.regular
      );

      if (
        normalizedUrl &&
        usedImageUrls.has(normalizedUrl)
      ) {
        continue;
      }

      allCandidates.push(photo);
    }

    if (allCandidates.length > 0) {
      break;
    }

    // Avoid an unnecessary request if this was the final page.
    if (page >= maxPages) {
      break;
    }

    await sleep(delayMs);
  }

  if (!allCandidates.length) {
    return null;
  }

  // ----------------------------------------------------------
  // Stable selection among UNUSED candidates.
  // ----------------------------------------------------------

  const fingerprint = stableHash(
    hotel._id || hotel.name
  );

  const photo =
    allCandidates[
      fingerprint % allCandidates.length
    ];

  const imageUrl = buildUnsplashUrl(photo);

  if (!imageUrl) {
    return null;
  }

  // ----------------------------------------------------------
  // Reserve the image immediately.
  //
  // This is important because another hotel processed later
  // in this same execution must not receive this photo.
  // ----------------------------------------------------------

  usedPhotoIds.add(String(photo.id));

  const normalizedUrl =
    normalizeImageUrl(imageUrl);

  if (normalizedUrl) {
    usedImageUrls.add(normalizedUrl);
  }

  // ----------------------------------------------------------
  // Unsplash download tracking
  // ----------------------------------------------------------

  if (photo.links?.download_location) {
    fetch(photo.links.download_location, {
      headers: {
        Authorization: `Client-ID ${accessKey}`,
      },
    }).catch(() => undefined);
  }

  return {
    url: imageUrl,

    photoId: String(photo.id),

    credit: {
      photographer:
        photo.user?.name ||
        "Unsplash contributor",

      profile:
        photo.user?.links?.html ||
        "https://unsplash.com",
    },
  };
}

// ------------------------------------------------------------
// Determine whether a hotel needs a replacement
// ------------------------------------------------------------

function hotelNeedsRefresh(hotel) {
  const hotelId = String(hotel._id);

  const existing =
    hotel.imageUrls?.[0];

  // No image
  if (!existing) {
    return true;
  }

  // Legacy provider
  if (isLegacyImage(existing)) {
    return true;
  }

  // Duplicate image
  if (duplicateHotelIds.has(hotelId)) {
    return true;
  }

  return false;
}

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------

(async () => {
  let updated = 0;
  let inspected = 0;
  let skipped = 0;
  let noImageFound = 0;
  let failed = 0;

  try {
    console.log("");
    console.log("==============================================");
    console.log("       StaySmart Hotel Image Refresh");
    console.log("==============================================");
    console.log("");

    console.log(`Image limit: ${limit}`);
    console.log(`Delay: ${delayMs} ms`);
    console.log(`Unsplash max pages: ${maxPages}`);
    console.log(`Dry run: ${dryRun}`);

    console.log("");

    // --------------------------------------------------------
    // Connect MongoDB
    // --------------------------------------------------------

    console.log("Connecting to MongoDB...");

    await mongoose.connect(connectionString);

    console.log("Connected to MongoDB.");
    console.log("");

    // --------------------------------------------------------
    // Load all existing images BEFORE processing.
    //
    // This is the key fix.
    // --------------------------------------------------------

    await loadExistingImageUsage();

    // --------------------------------------------------------
    // Find duplicate hotels.
    // --------------------------------------------------------

    await findDuplicateHotels();

    // --------------------------------------------------------
    // Process hotels
    // --------------------------------------------------------

    console.log(
      "Starting hotel image refresh..."
    );

    console.log("");

    const cursor = Hotel.find({}).cursor();

    for await (const hotel of cursor) {
      if (updated >= limit) {
        break;
      }

      inspected += 1;

      const needsRefresh =
        hotelNeedsRefresh(hotel);

      if (!needsRefresh) {
        skipped += 1;
        continue;
      }

      try {
        const displayName =
          getHotelDisplayName(hotel);

        console.log("");
        console.log(
          `[${updated + 1}/${limit}] ${displayName}`
        );

        const image =
          await findFreeHotelPhoto(hotel);

        if (!image) {
          noImageFound += 1;

          console.warn(
            `No unused Unsplash image found for ${displayName}`
          );

          await sleep(delayMs);

          continue;
        }

        // ----------------------------------------------------
        // Dry run
        // ----------------------------------------------------

        if (dryRun) {
          console.log(
            `DRY RUN → ${image.photoId}`
          );

          console.log(
            `DRY RUN URL → ${image.url}`
          );

          updated += 1;

          await sleep(delayMs);

          continue;
        }

        // ----------------------------------------------------
        // Save image
        // ----------------------------------------------------

        await Hotel.updateOne(
          {
            _id: hotel._id,
          },

          {
            $set: {
              imageUrls: [image.url],

              imagePhotoId:
                image.photoId,

              imageCredit:
                image.credit,

              lastUpdated:
                new Date(),
            },
          }
        );

        // ----------------------------------------------------
        // If this hotel was a duplicate, remove it from the
        // duplicate set because it now has a replacement.
        // ----------------------------------------------------

        duplicateHotelIds.delete(
          String(hotel._id)
        );

        updated += 1;

        console.log(
          `UPDATED → ${image.photoId}`
        );

        console.log(
          `Photographer → ${image.credit.photographer}`
        );

        console.log(
          `Remaining duplicate hotels: ${duplicateHotelIds.size}`
        );
      } catch (error) {
        failed += 1;

        console.warn(
          `Image lookup failed for ${getHotelDisplayName(
            hotel
          )}: ${error.message}`
        );

        // ----------------------------------------------------
        // Stop on Unsplash rate limiting.
        // ----------------------------------------------------

        if (/429/.test(error.message)) {
          console.error("");
          console.error(
            "Unsplash rate limit reached."
          );

          console.error(
            "Stopping safely so the script can be resumed later."
          );

          break;
        }
      }

      await sleep(delayMs);
    }

    // --------------------------------------------------------
    // Final report
    // --------------------------------------------------------

    console.log("");
    console.log("==============================================");
    console.log("              REFRESH COMPLETE");
    console.log("==============================================");
    console.log("");

    console.log(`Hotels inspected: ${inspected}`);
    console.log(`Hotels updated: ${updated}`);
    console.log(`Hotels skipped: ${skipped}`);
    console.log(`No image found: ${noImageFound}`);
    console.log(`Failed: ${failed}`);

    console.log("");

    console.log(
      `Unique image URLs tracked: ${usedImageUrls.size}`
    );

    console.log(
      `Unique Unsplash photo IDs tracked: ${usedPhotoIds.size}`
    );

    console.log(
      `Duplicate hotels remaining: ${duplicateHotelIds.size}`
    );

    console.log("");

    if (duplicateHotelIds.size > 0) {
      console.log(
        "Some duplicate hotels may remain because Unsplash did not provide enough unused results."
      );
    } else {
      console.log(
        "No known duplicate hotel image assignments remain."
      );
    }

    console.log("");

    await mongoose.disconnect();

    console.log("MongoDB connection closed.");
  } catch (error) {
    console.error("");
    console.error("==============================================");
    console.error("              FATAL ERROR");
    console.error("==============================================");
    console.error("");
    console.error(error);
    console.error("");

    try {
      await mongoose.disconnect();
    } catch (_) {}

    process.exit(1);
  }
})();