import express, { Request, Response } from "express";
import mongoose from "mongoose";
import Hotel from "../models/hotel";
import Booking from "../models/booking";
import PaymentOrder from "../models/payment-order";
import User from "../models/user";
import { HotelSearchResponse } from "../../../shared/types";
import { createHmac, timingSafeEqual } from "crypto";
import verifyToken from "../middleware/auth";

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toNumber = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const toList = (raw: unknown): string[] => {
  if (raw === undefined || raw === null || raw === "") return [];
  const values = Array.isArray(raw) ? raw : [raw];
  return Array.from(
    new Set(
      values
        .flatMap((v) => String(v).split(","))
        .map((v) => v.trim())
        .filter(Boolean)
    )
  );
};

const isValidObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id) && /^[a-f\d]{24}$/i.test(id);

// Old / alternative names people type for Indian cities.
const SYNONYMS: Record<string, string[]> = {
  delhi: ["new delhi"],
  "new delhi": ["delhi"],
  ncr: ["new delhi", "gurugram", "noida"],
  bangalore: ["bengaluru"],
  bombay: ["mumbai"],
  madras: ["chennai"],
  calcutta: ["kolkata"],
  gurgaon: ["gurugram"],
  trivandrum: ["thiruvananthapuram"],
  cochin: ["kochi"],
  ernakulam: ["kochi"],
  pondicherry: ["puducherry"],
  pondy: ["puducherry"],
  mysore: ["mysuru"],
  mangalore: ["mangaluru"],
  banaras: ["varanasi"],
  benares: ["varanasi"],
  kashi: ["varanasi"],
  baroda: ["vadodara"],
  poona: ["pune"],
  simla: ["shimla"],
  udhagamandalam: ["ooty"],
  allahabad: ["prayagraj"],
  aurangabad: ["chhatrapati sambhajinagar"],
  vizag: ["visakhapatnam"],
  calicut: ["kozhikode"],
  alleppey: ["alappuzha"],
  trichur: ["thrissur"],
  trichy: ["tiruchirappalli"],
  madgaon: ["margao"],
  panjim: ["panaji"],
  darjiling: ["darjeeling"],
  "port blair": ["sri vijaya puram"],
  "mcleodganj": ["mcleod ganj", "dharamshala"],
};

const SEARCH_FIELDS = [
  "city",
  "name",
  "location.address.locality",
  "location.address.city",
  "location.address.district",
  "location.address.state",
  "location.address.street",
];

const wordRegex = (term: string) => new RegExp(`(^|[^a-z0-9])${escapeRegex(term)}`, "i");

const destinationTerms = (destination: string) => {
  const primary = destination.split(",")[0].trim().toLowerCase();
  const terms = new Set([primary]);
  for (const alt of SYNONYMS[primary] || []) terms.add(alt);
  return Array.from(terms).filter((t) => t.length >= 2);
};

const phraseClause = (terms: string[]) => ({
  $or: terms.flatMap((term) => SEARCH_FIELDS.map((field) => ({ [field]: wordRegex(term) }))),
});

const allWordsClause = (destination: string) => {
  const words = destination
    .toLowerCase()
    .split(/[\s,]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !["hotel", "hotels", "in", "near", "the", "and", "india"].includes(w));
  if (words.length < 2) return null;
  return {
    $and: words.map((word) => ({
      $or: [word, ...(SYNONYMS[word] || [])].flatMap((term) =>
        SEARCH_FIELDS.map((field) => ({ [field]: wordRegex(term) }))
      ),
    })),
  };
};

const buildFilters = (q: any) => {
  const and: any[] = [{ isActive: { $ne: false } }];

  const stars = toList(q.stars ?? q.starRating)
    .map((s) => parseInt(s, 10))
    .filter((s) => s >= 1 && s <= 5);
  if (stars.length) and.push({ starRating: { $in: stars } });

  const types = toList(q.types ?? q.hotelType);
  if (types.length) and.push({ type: { $in: types } });

  const facilities = toList(q.facilities);
  if (facilities.length) and.push({ facilities: { $all: facilities } });

  const minPrice = toNumber(q.minPrice);
  const maxPrice = toNumber(q.maxPrice);
  if (minPrice !== null || maxPrice !== null) {
    const price: any = {};
    if (minPrice !== null) price.$gte = minPrice;
    if (maxPrice !== null) price.$lte = maxPrice;
    and.push({ pricePerNight: price });
  }

  if (String(q.photos || "") === "property") {
    and.push({ imageSource: { $in: ["property", "mixed"] } });
  }

  const state = String(q.state || "").trim();
  if (state) and.push({ "location.address.state": new RegExp(`^${escapeRegex(state)}$`, "i") });

  if (String(q.applyGuestCapacity || "").toLowerCase() === "true") {
    const adults = parseInt(q.adultCount, 10);
    if (adults > 0) and.push({ adultCount: { $gte: adults } });
    const children = parseInt(q.childCount, 10);
    if (children > 0) and.push({ childCount: { $gte: children } });
  }
  return and;
};

const SORTS: Record<string, Record<string, 1 | -1>> = {
  relevance: { _rank: -1, photoScore: -1, starRating: -1, _id: 1 },
  starRating: { starRating: -1, photoScore: -1, _id: 1 },
  priceLow: { pricePerNight: 1, _id: 1 },
  priceHigh: { pricePerNight: -1, _id: 1 },
  pricePerNightAsc: { pricePerNight: 1, _id: 1 },
  pricePerNightDesc: { pricePerNight: -1, _id: 1 },
  name: { name: 1, _id: 1 },
  newest: { createdAt: -1, _id: 1 },
};

const CARD_PROJECTION = {
  name: 1,
  city: 1,
  country: 1,
  description: 1,
  type: 1,
  adultCount: 1,
  childCount: 1,
  facilities: 1,
  pricePerNight: 1,
  priceSource: 1,
  starRating: 1,
  starRatingSource: 1,
  imageUrls: { $slice: ["$imageUrls", 5] },
  imageCredits: { $slice: ["$imageCredits", 5] },
  imageSource: 1,
  photoScore: 1,
  location: 1,
  contact: 1,
  brand: 1,
  rooms: 1,
  averageRating: 1,
  reviewCount: 1,
  isFeatured: 1,
  userId: 1,
  createdAt: 1,
};

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

router.get("/search", async (req: Request, res: Response) => {
  try {
    const destination = String(req.query.destination || "").trim().slice(0, 100);
    const pageSize = clamp(parseInt(String(req.query.pageSize || "12"), 10) || 12, 1, 48);
    const page = Math.max(parseInt(String(req.query.page || "1"), 10) || 1, 1);
    const sortKey = String(req.query.sortOption || req.query.sortBy || "relevance");
    const sort = SORTS[sortKey] || SORTS.relevance;

    const filters = buildFilters(req.query);
    let match: any = { $and: [...filters] };
    let terms: string[] = [];

    if (destination) {
      terms = destinationTerms(destination);
      match = { $and: [...filters, phraseClause(terms)] };
      const count = await Hotel.countDocuments(match);
      if (count === 0) {
        const fallback = allWordsClause(destination);
        if (fallback) match = { $and: [...filters, fallback] };
      }
    }

    const rankRegex = terms.length ? new RegExp(terms.map((t) => `(^|[^a-z0-9])${escapeRegex(t)}`).join("|"), "i") : null;
    const pipeline: any[] = [{ $match: match }];
    pipeline.push({
      $addFields: {
        _rank: rankRegex
          ? {
              $add: [
                { $cond: [{ $regexMatch: { input: { $ifNull: ["$city", ""] }, regex: rankRegex } }, 8, 0] },
                { $cond: [{ $regexMatch: { input: { $ifNull: ["$location.address.locality", ""] }, regex: rankRegex } }, 4, 0] },
                { $cond: [{ $regexMatch: { input: { $ifNull: ["$location.address.state", ""] }, regex: rankRegex } }, 2, 0] },
                { $cond: [{ $regexMatch: { input: { $ifNull: ["$name", ""] }, regex: rankRegex } }, 1, 0] },
              ],
            }
          : 0,
      },
    });
    pipeline.push({ $sort: sort });
    pipeline.push({
      $facet: {
        data: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }, { $project: CARD_PROJECTION }],
        total: [{ $count: "n" }],
      },
    });

    const [result] = await Hotel.aggregate(pipeline);
    const total = result?.total?.[0]?.n || 0;
    const response: HotelSearchResponse = {
      data: result?.data || [],
      pagination: { total, page, pages: Math.ceil(total / pageSize) },
    };
    res.json(response);
  } catch (error) {
    console.log("search error", error);
    res.status(500).json({ message: "Something went wrong while searching. Please try again." });
  }
});

// Destination autocomplete: cities, areas and hotels.
router.get("/locations", async (req: Request, res: Response) => {
  try {
    const raw = String(req.query.query || "").trim().slice(0, 60);
    const limit = clamp(parseInt(String(req.query.limit || "8"), 10) || 8, 1, 20);

    if (!raw) {
      const top = await Hotel.aggregate([
        { $group: { _id: { city: "$city", state: "$location.address.state" }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit },
      ]);
      return res.json(
        top.map((t) => ({
          type: "city",
          city: t._id.city,
          state: t._id.state || "",
          count: t.count,
          label: [t._id.city, t._id.state].filter(Boolean).join(", "),
        }))
      );
    }

    const terms = destinationTerms(raw);
    const rx = new RegExp(terms.map((t) => `(^|[^a-z0-9])${escapeRegex(t)}`).join("|"), "i");

    const [cities, areas, hotels] = await Promise.all([
      Hotel.aggregate([
        { $match: { $or: [{ city: rx }, { "location.address.state": rx }] } },
        { $group: { _id: { city: "$city", state: "$location.address.state" }, count: { $sum: 1 }, cityMatch: { $max: { $cond: [{ $regexMatch: { input: "$city", regex: rx } }, 1, 0] } } } },
        { $sort: { cityMatch: -1, count: -1 } },
        { $limit: limit },
      ]),
      Hotel.aggregate([
        { $match: { "location.address.locality": rx } },
        { $group: { _id: { area: "$location.address.locality", city: "$city", state: "$location.address.state" }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 4 },
      ]),
      Hotel.find({ name: rx }, { name: 1, city: 1, "location.address.state": 1, imageUrls: { $slice: 1 } })
        .sort({ photoScore: -1, starRating: -1 })
        .limit(5)
        .lean(),
    ]);

    // Places that start with what was typed come first, then by hotel count,
    // so "kov" suggests Kovalam (48 hotels) before tiny villages.
    const startsWith = (text: string) => terms.some((t) => String(text || "").toLowerCase().startsWith(t));
    const places = [
      ...cities.map((c) => ({
        type: "city",
        city: c._id.city,
        state: c._id.state || "",
        count: c.count,
        label: [c._id.city, c._id.state].filter(Boolean).join(", "),
        _starts: startsWith(c._id.city) ? 1 : 0,
      })),
      ...areas
        .filter((a) => a._id.area && !cities.some((c) => c._id.city === a._id.area))
        .map((a) => ({
          type: "area",
          city: a._id.city,
          area: a._id.area,
          state: a._id.state || "",
          count: a.count,
          label: `${a._id.area}, ${a._id.city}`,
          _starts: startsWith(a._id.area) ? 1 : 0,
        })),
    ]
      .sort((a, b) => b._starts - a._starts || b.count - a.count)
      .slice(0, limit)
      .map(({ _starts, ...rest }) => rest);

    const results = [
      ...places,
      ...hotels.map((h: any) => ({
        type: "hotel",
        hotelId: String(h._id),
        city: h.city,
        state: h.location?.address?.state || "",
        label: h.name,
        imageUrl: h.imageUrls?.[0] || "",
      })),
    ];
    res.json(results);
  } catch (error) {
    console.log("locations error", error);
    res.status(500).json({ message: "Something went wrong" });
  }
});

// Site-wide numbers for the home page (cached for a minute).
let statsCache: { at: number; data: any } | null = null;
router.get("/stats", async (_req: Request, res: Response) => {
  try {
    if (statsCache && Date.now() - statsCache.at < 60_000) return res.json(statsCache.data);
    const [totals] = await Hotel.aggregate([
      {
        $group: {
          _id: null,
          hotels: { $sum: 1 },
          cities: { $addToSet: "$city" },
          states: { $addToSet: "$location.address.state" },
          withPhotos: { $sum: { $cond: [{ $in: ["$imageSource", ["property", "mixed"]] }, 1, 0] } },
          officialStars: { $sum: { $cond: [{ $eq: ["$starRatingSource", "official"] }, 1, 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          hotels: 1,
          withPhotos: 1,
          officialStars: 1,
          cities: { $size: "$cities" },
          states: { $size: { $filter: { input: "$states", as: "s", cond: { $gt: [{ $strLenCP: { $ifNull: ["$$s", ""] } }, 0] } } } },
        },
      },
    ]);
    const data = totals || { hotels: 0, cities: 0, states: 0, withPhotos: 0, officialStars: 0 };
    statsCache = { at: Date.now(), data };
    res.json(data);
  } catch (error) {
    console.log("stats error", error);
    res.status(500).json({ message: "Something went wrong" });
  }
});

router.get("/popular-destinations", async (req: Request, res: Response) => {
  try {
    const limit = clamp(parseInt(String(req.query.limit || "8"), 10) || 8, 1, 24);
    const groups = await Hotel.aggregate([
      { $match: { isActive: { $ne: false } } },
      { $sort: { photoScore: -1, starRating: -1 } },
      {
        $group: {
          _id: { city: "$city", state: "$location.address.state" },
          hotelsCount: { $sum: 1 },
          minPrice: { $min: "$pricePerNight" },
          avgPrice: { $avg: "$pricePerNight" },
          hotelImage: { $first: { $arrayElemAt: ["$imageUrls", 0] } },
          hotelImageSource: { $first: "$imageSource" },
          sampleHotelName: { $first: "$name" },
          lat: { $avg: "$location.latitude" },
          lng: { $avg: "$location.longitude" },
        },
      },
      { $sort: { hotelsCount: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: "destinations",
          let: { city: "$_id.city", state: "$_id.state" },
          pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$city", "$$city"] }, { $eq: ["$state", "$$state"] }] } } }],
          as: "destination",
        },
      },
    ]);

    res.json(
      groups.map((g) => {
        const dest = g.destination?.[0];
        return {
          city: g._id.city,
          state: g._id.state || "",
          country: "India",
          hotelsCount: g.hotelsCount,
          minPrice: g.minPrice || 0,
          avgPrice: Math.round(g.avgPrice || 0),
          imageUrl: dest?.imageUrl || (g.hotelImageSource === "representative" ? "" : g.hotelImage) || "",
          imageCredit: dest?.credit || null,
          latitude: g.lat,
          longitude: g.lng,
          summary: dest?.extract || "",
          sampleHotelName: g.sampleHotelName,
          label: [g._id.city, g._id.state].filter(Boolean).join(", "),
        };
      })
    );
  } catch (error) {
    console.log("popular destinations error", error);
    res.status(500).json({ message: "Something went wrong" });
  }
});

// Hotels with real photos of the property and a 4-5 star rating, one per city.
router.get("/featured", async (req: Request, res: Response) => {
  try {
    const limit = clamp(parseInt(String(req.query.limit || "8"), 10) || 8, 1, 24);
    const hotels = await Hotel.aggregate([
      { $match: { isFeatured: true, isActive: { $ne: false } } },
      { $sort: { photoScore: -1, starRating: -1, starRatingSource: -1 } },
      { $group: { _id: "$city", hotel: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$hotel" } },
      { $sort: { starRating: -1, photoScore: -1, name: 1 } },
      { $limit: limit },
      { $project: CARD_PROJECTION },
    ]);
    res.json(hotels);
  } catch (error) {
    console.log("featured error", error);
    res.status(500).json({ message: "Something went wrong" });
  }
});

router.get("/nearby", async (req: Request, res: Response) => {
  try {
    const lat = toNumber(req.query.lat ?? req.query.latitude);
    const lng = toNumber(req.query.lng ?? req.query.longitude);
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return res.status(400).json({ message: "Valid latitude and longitude are required" });
    }
    const radiusKm = clamp(toNumber(req.query.radiusKm) ?? 25, 1, 500);
    const limit = clamp(toNumber(req.query.limit) ?? 60, 1, 300);
    const types = toList(req.query.types);

    const query: any = { isActive: { $ne: false } };
    if (types.length) query.type = { $in: types };

    const hotels = await Hotel.aggregate([
      {
        $geoNear: {
          near: { type: "Point", coordinates: [lng, lat] },
          distanceField: "distanceMeters",
          maxDistance: radiusKm * 1000,
          spherical: true,
          query,
        },
      },
      { $limit: limit },
      { $project: { ...CARD_PROJECTION, distanceMeters: 1 } },
    ]);

    const data = hotels.map((h: any) => ({ ...h, distanceKm: Number((h.distanceMeters / 1000).toFixed(2)) }));
    return res.json({
      data,
      pagination: { total: data.length, page: 1, pages: 1 },
      meta: { latitude: lat, longitude: lng, radiusKm, limit },
    });
  } catch (error) {
    console.log("nearby error", error);
    res.status(500).json({ message: "Unable to fetch nearby hotels" });
  }
});

// Latest hotels (newest listings first). Capped so it never dumps the whole DB.
router.get("/", async (req: Request, res: Response) => {
  try {
    const limit = clamp(parseInt(String(req.query.limit || "12"), 10) || 12, 1, 100);
    const hotels = await Hotel.find({ isActive: { $ne: false } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean();
    res.json(hotels);
  } catch (error) {
    console.log("error", error);
    res.status(500).json({ message: "Error fetching hotels" });
  }
});

router.get("/:id/similar", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!isValidObjectId(id)) return res.status(404).json({ message: "Hotel not found" });
    const hotel = await Hotel.findById(id).lean();
    if (!hotel) return res.status(404).json({ message: "Hotel not found" });
    const similar = await Hotel.aggregate([
      {
        $match: {
          _id: { $ne: hotel._id },
          city: hotel.city,
          starRating: { $gte: Math.max(1, hotel.starRating - 1), $lte: Math.min(5, hotel.starRating + 1) },
          isActive: { $ne: false },
        },
      },
      { $sort: { photoScore: -1, starRating: -1 } },
      { $limit: 4 },
      { $project: CARD_PROJECTION },
    ]);
    res.json(similar);
  } catch (error) {
    console.log("similar error", error);
    res.status(500).json({ message: "Something went wrong" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!isValidObjectId(id)) {
    return res.status(404).json({ message: "Hotel not found" });
  }
  try {
    const hotel = await Hotel.findById(id).lean();
    if (!hotel) return res.status(404).json({ message: "Hotel not found" });
    res.json(hotel);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Error fetching hotel" });
  }
});

// ---------------------------------------------------------------------------
// Booking & payment
// ---------------------------------------------------------------------------

type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  notes?: Record<string, string>;
};

export const razorpayCredentials = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret };
};

/**
 * Whether Razorpay accepts our keys. Checked at startup so the site does not
 * offer "Pay now" when the gateway would reject every order.
 */
export const razorpayStatus: { usable: boolean; reason: string } = { usable: false, reason: "not checked" };

export const checkRazorpay = async () => {
  const credentials = razorpayCredentials();
  if (!credentials) {
    Object.assign(razorpayStatus, { usable: false, reason: "RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set" });
    return razorpayStatus;
  }
  try {
    const res = await fetch("https://api.razorpay.com/v1/orders?count=1", {
      headers: { Authorization: `Basic ${Buffer.from(`${credentials.keyId}:${credentials.keySecret}`).toString("base64")}` },
    });
    if (res.ok) Object.assign(razorpayStatus, { usable: true, reason: "ok" });
    else if (res.status === 401) Object.assign(razorpayStatus, { usable: false, reason: "Razorpay rejected the API keys (401). Generate new test keys in the Razorpay dashboard." });
    else Object.assign(razorpayStatus, { usable: true, reason: `unexpected status ${res.status}; will try per request` });
  } catch (error: any) {
    // Network problem: don't disable payments permanently, just report it.
    Object.assign(razorpayStatus, { usable: true, reason: `could not reach Razorpay (${error?.message || error})` });
  }
  return razorpayStatus;
};

const razorpayRequest = async (path: string, init: RequestInit = {}) => {
  const credentials = razorpayCredentials();
  if (!credentials) throw new Error("Online payment is not configured on this server");
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${Buffer.from(`${credentials.keyId}:${credentials.keySecret}`).toString("base64")}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const raw = await response.text();
  let payload: any = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    if (response.status === 401) {
      Object.assign(razorpayStatus, { usable: false, reason: "Razorpay rejected the API keys (401)" });
      throw new Error("Online payment is unavailable right now (the payment gateway rejected this server's credentials). Please choose “Pay at hotel”.");
    }
    throw new Error(payload?.error?.description || `Payment provider error (HTTP ${response.status})`);
  }
  return payload;
};

class BookingInputError extends Error {}

const parseStayDates = (hotel: any, body: any) => {
  const checkIn = new Date(body.checkIn);
  const checkOut = new Date(body.checkOut);
  if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime()) || checkOut <= checkIn) {
    throw new BookingInputError("Choose a valid check-in and check-out date");
  }
  const dayIn = Date.UTC(checkIn.getUTCFullYear(), checkIn.getUTCMonth(), checkIn.getUTCDate());
  const dayOut = Date.UTC(checkOut.getUTCFullYear(), checkOut.getUTCMonth(), checkOut.getUTCDate());
  const nights = Math.round((dayOut - dayIn) / 86400000);
  if (nights < 1 || nights > 30) throw new BookingInputError("Bookings must be between 1 and 30 nights");
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  // allow "today" in any Indian timezone offset
  if (dayIn < today.getTime() - 86400000) throw new BookingInputError("Check-in date cannot be in the past");
  return { checkIn, checkOut, nights, totalCost: Number(hotel.pricePerNight) * nights };
};

const parseGuest = (body: any) => {
  const adultCount = Number(body.adultCount);
  const childCount = Number(body.childCount ?? 0);
  if (!Number.isInteger(adultCount) || adultCount < 1 || adultCount > 20 || !Number.isInteger(childCount) || childCount < 0 || childCount > 20) {
    throw new BookingInputError("Enter valid guest counts");
  }
  const firstName = String(body.firstName || "").trim().slice(0, 60);
  const lastName = String(body.lastName || "").trim().slice(0, 60);
  const email = String(body.email || "").trim().toLowerCase();
  if (!firstName || !lastName || !/^\S+@\S+\.\S+$/.test(email)) {
    throw new BookingInputError("Enter your name and a valid email address");
  }
  const phone = String(body.phone || "").trim().slice(0, 20);
  if (phone && !/^[+\d][\d\s-]{6,19}$/.test(phone)) throw new BookingInputError("Enter a valid phone number");
  return {
    adultCount,
    childCount,
    firstName,
    lastName,
    email,
    phone,
    specialRequests: String(body.specialRequests || "").trim().slice(0, 1000),
  };
};

const loadHotelOr404 = async (req: Request, res: Response) => {
  const hotelId = String(req.params.hotelId);
  if (!isValidObjectId(hotelId)) {
    res.status(404).json({ message: "Hotel not found" });
    return null;
  }
  const hotel = await Hotel.findById(hotelId);
  if (!hotel) {
    res.status(404).json({ message: "Hotel not found" });
    return null;
  }
  return hotel;
};

// Razorpay Checkout supports Google Pay/UPI, debit cards, and credit cards in one verified payment sheet.
router.post("/:hotelId/bookings/checkout-order", verifyToken, async (req: Request, res: Response) => {
  try {
    const hotel = await loadHotelOr404(req, res);
    if (!hotel) return;
    let nights = Number(req.body.numberOfNights);
    if (req.body.checkIn && req.body.checkOut) {
      nights = parseStayDates(hotel, req.body).nights;
    }
    if (!Number.isInteger(nights) || nights < 1 || nights > 30) {
      return res.status(400).json({ message: "Choose between 1 and 30 nights" });
    }
    const amount = Math.round(Number(hotel.pricePerNight) * nights * 100);
    const order = (await razorpayRequest("/orders", {
      method: "POST",
      body: JSON.stringify({
        amount,
        currency: "INR",
        receipt: `stay_${String(hotel._id).slice(-12)}_${Date.now()}`,
        notes: { hotelId: String(hotel._id), userId: req.userId, nights: String(nights) },
      }),
    })) as RazorpayOrder;
    await PaymentOrder.create({
      orderId: order.id,
      hotelId: String(hotel._id),
      userId: req.userId,
      amount: order.amount,
      currency: order.currency,
      nights,
    });
    res.status(201).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: razorpayCredentials()?.keyId,
      hotelName: hotel.name,
    });
  } catch (error) {
    if (error instanceof BookingInputError) return res.status(400).json({ message: error.message });
    console.error("checkout-order failed", error);
    res.status(503).json({ message: error instanceof Error ? error.message : "Unable to start checkout" });
  }
});

router.post("/:hotelId/bookings/verify-payment", verifyToken, async (req: Request, res: Response) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (![razorpay_order_id, razorpay_payment_id, razorpay_signature].every((v) => typeof v === "string" && v.length > 0)) {
      return res.status(400).json({ message: "Incomplete payment verification data" });
    }
    const credentials = razorpayCredentials();
    if (!credentials) return res.status(503).json({ message: "Online payment is not configured on this server" });
    const pendingOrder = await PaymentOrder.findOne({ orderId: razorpay_order_id, hotelId: req.params.hotelId, userId: req.userId });
    if (!pendingOrder) return res.status(400).json({ message: "This payment order is not valid for the current booking" });
    const expected = createHmac("sha256", credentials.keySecret).update(`${pendingOrder.orderId}|${razorpay_payment_id}`).digest("hex");
    if (expected.length !== razorpay_signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(razorpay_signature))) {
      return res.status(400).json({ message: "Payment signature could not be verified" });
    }
    const existing = await Booking.findOne({ gatewayPaymentId: razorpay_payment_id });
    if (existing) return res.status(200).json({ booking: existing, alreadyProcessed: true });

    const hotel = await loadHotelOr404(req, res);
    if (!hotel) return;
    const details = parseStayDates(hotel, req.body);
    const guest = parseGuest(req.body);
    let payment: any = await razorpayRequest(`/payments/${razorpay_payment_id}`);
    if (payment.status === "authorized" && payment.order_id === pendingOrder.orderId && payment.amount === pendingOrder.amount) {
      // Accounts without auto-capture leave payments "authorized"; capture now.
      payment = await razorpayRequest(`/payments/${razorpay_payment_id}/capture`, {
        method: "POST",
        body: JSON.stringify({ amount: pendingOrder.amount, currency: "INR" }),
      });
    }
    const order = (await razorpayRequest(`/orders/${razorpay_order_id}`)) as RazorpayOrder;
    const paymentOk = payment.status === "captured";
    if (
      pendingOrder.nights !== details.nights ||
      !paymentOk ||
      payment.order_id !== pendingOrder.orderId ||
      order.currency !== "INR" ||
      order.amount !== pendingOrder.amount ||
      order.amount !== Math.round(details.totalCost * 100) ||
      order.notes?.hotelId !== String(hotel._id) ||
      order.notes?.userId !== req.userId
    ) {
      return res.status(400).json({ message: "Payment does not match this booking" });
    }
    const booking = await Booking.create({
      userId: req.userId,
      hotelId: String(hotel._id),
      ...guest,
      checkIn: details.checkIn,
      checkOut: details.checkOut,
      totalCost: details.totalCost,
      status: "confirmed",
      paymentStatus: "paid",
      paymentMethod: payment.method === "upi" ? "upi" : payment.method || "card",
      gatewayOrderId: razorpay_order_id,
      gatewayPaymentId: razorpay_payment_id,
    });
    await Promise.all([
      Hotel.findByIdAndUpdate(hotel._id, { $inc: { totalBookings: 1, totalRevenue: details.totalCost } }),
      User.findByIdAndUpdate(req.userId, { $inc: { totalBookings: 1, totalSpent: details.totalCost } }),
      PaymentOrder.findByIdAndUpdate(pendingOrder._id, { paymentId: razorpay_payment_id }),
    ]);
    res.status(201).json({ booking });
  } catch (error) {
    if (error instanceof BookingInputError) return res.status(400).json({ message: error.message });
    console.error("Payment verification failed", error);
    res.status(500).json({ message: "Unable to confirm your payment. If money was debited, contact support with your payment reference." });
  }
});

// Reserve now, pay at the property (no online payment needed).
router.post("/:hotelId/bookings/pay-at-hotel", verifyToken, async (req: Request, res: Response) => {
  try {
    const hotel = await loadHotelOr404(req, res);
    if (!hotel) return;
    const details = parseStayDates(hotel, req.body);
    const guest = parseGuest(req.body);
    const booking = await Booking.create({
      userId: req.userId,
      hotelId: String(hotel._id),
      ...guest,
      checkIn: details.checkIn,
      checkOut: details.checkOut,
      totalCost: details.totalCost,
      status: "confirmed",
      paymentStatus: "pending",
      paymentMethod: "pay_at_hotel",
    });
    await Promise.all([
      Hotel.findByIdAndUpdate(hotel._id, { $inc: { totalBookings: 1 } }),
      User.findByIdAndUpdate(req.userId, { $inc: { totalBookings: 1 } }),
    ]);
    res.status(201).json({ booking });
  } catch (error) {
    if (error instanceof BookingInputError) return res.status(400).json({ message: error.message });
    console.error("pay-at-hotel booking failed", error);
    res.status(500).json({ message: "Unable to create your booking. Please try again." });
  }
});

export default router;
