import express, { NextFunction, Request, Response } from "express";
import multer from "multer";
import cloudinary from "cloudinary";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import Hotel from "../models/hotel";
import Booking from "../models/booking";
import verifyToken from "../middleware/auth";

const router = express.Router();

// Resolved from the backend root (npm scripts run there) so dev (src/) and
// production (dist/...) builds share the same folder.
export const UPLOADS_DIR = path.resolve(process.env.STORAGE_DIR || process.cwd(), "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const MAX_IMAGES = 6;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: MAX_IMAGES },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPG, PNG or WebP images are allowed"));
  },
});

// multer errors (too large, too many files, wrong type) -> 400 with a message
const handleUpload = (req: Request, res: Response, next: NextFunction) =>
  upload.array("imageFiles", MAX_IMAGES)(req, res, (err: any) => {
    if (!err) return next();
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "Each image must be smaller than 5 MB"
        : err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE"
          ? `You can upload up to ${MAX_IMAGES} images`
          : err.message || "Image upload failed";
    res.status(400).json({ message });
  });

const isValidObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id) && /^[a-f\d]{24}$/i.test(id);

const asList = (value: unknown): string[] => {
  if (value === undefined || value === null || value === "") return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((v) => String(v).trim()).filter(Boolean);
};

const field = (body: any, key: string) => String(body[key] ?? "").trim();

const isCloudinaryConfigured = () =>
  Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

const backendBaseUrl = () =>
  (process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5001}`).replace(/\/$/, "");

async function saveLocally(file: Express.Multer.File) {
  const ext = file.mimetype === "image/png" ? ".png" : file.mimetype === "image/webp" ? ".webp" : ".jpg";
  const name = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
  await fs.promises.writeFile(path.join(UPLOADS_DIR, name), file.buffer);
  return `${backendBaseUrl()}/uploads/${name}`;
}

async function uploadImages(files: Express.Multer.File[]) {
  const urls: string[] = [];
  for (const file of files) {
    let url = "";
    if (isCloudinaryConfigured()) {
      try {
        const dataUri = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
        const result = await cloudinary.v2.uploader.upload(dataUri, {
          secure: true,
          folder: "staysmart",
          transformation: [{ width: 1600, height: 1067, crop: "limit" }, { quality: "auto" }],
        });
        url = result.secure_url;
      } catch (error: any) {
        console.warn(`Cloudinary upload failed (${error?.message || error}); storing image locally instead.`);
      }
    }
    if (!url) url = await saveLocally(file);
    urls.push(url);
  }
  return urls;
}

type HotelInput = Record<string, any>;

/** Parses and validates the multipart form sent by the hotel form. */
async function parseHotelForm(req: Request): Promise<{ errors: string[]; data: HotelInput }> {
  const b = req.body || {};
  const errors: string[] = [];

  const name = field(b, "name");
  const city = field(b, "city");
  const state = field(b, "state");
  const description = field(b, "description");
  const type = asList(b.type ?? b["type[]"]);
  const facilities = asList(b.facilities ?? b["facilities[]"]);
  const pricePerNight = Number(b.pricePerNight);
  const starRating = Number(b.starRating);
  const adultCount = Number(b.adultCount);
  const childCount = Number(b.childCount ?? 0);

  if (name.length < 2) errors.push("Hotel name is required");
  if (city.length < 2) errors.push("City is required");
  if (description.length < 20) errors.push("Please write a description of at least 20 characters");
  if (!type.length) errors.push("Select at least one hotel type");
  if (!Number.isFinite(pricePerNight) || pricePerNight < 100 || pricePerNight > 500000) errors.push("Price per night must be between ₹100 and ₹5,00,000");
  if (!Number.isInteger(starRating) || starRating < 1 || starRating > 5) errors.push("Star rating must be between 1 and 5");
  if (!Number.isInteger(adultCount) || adultCount < 1 || adultCount > 20) errors.push("Adults must be between 1 and 20");
  if (!Number.isInteger(childCount) || childCount < 0 || childCount > 20) errors.push("Children must be between 0 and 20");

  let latitude = Number(b.latitude);
  let longitude = Number(b.longitude);
  const hasCoords = Number.isFinite(latitude) && Number.isFinite(longitude) && b.latitude !== "" && b.longitude !== "";
  if (!hasCoords && city) {
    // Place the hotel at the centre of the existing hotels in that city so it
    // shows up on maps and in "near me" results.
    const [centre] = await Hotel.aggregate([
      { $match: { city: new RegExp(`^${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"), "location.latitude": { $exists: true } } },
      { $group: { _id: null, lat: { $avg: "$location.latitude" }, lng: { $avg: "$location.longitude" }, state: { $first: "$location.address.state" } } },
    ]);
    if (centre) {
      latitude = centre.lat;
      longitude = centre.lng;
    }
  }
  const coordsOk = Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;

  const data: HotelInput = {
    name,
    city,
    country: "India",
    description,
    type,
    facilities,
    pricePerNight: Math.round(pricePerNight),
    priceSource: "owner",
    starRating,
    starRatingSource: "owner",
    adultCount,
    childCount,
    lastUpdated: new Date(),
    contact: {
      phone: field(b, "contact.phone"),
      email: field(b, "contact.email"),
      website: field(b, "contact.website"),
    },
    policies: {
      checkInTime: field(b, "policies.checkInTime"),
      checkOutTime: field(b, "policies.checkOutTime"),
      cancellationPolicy: field(b, "policies.cancellationPolicy"),
      petPolicy: field(b, "policies.petPolicy"),
      smokingPolicy: field(b, "policies.smokingPolicy"),
    },
    location: {
      ...(coordsOk ? { latitude, longitude } : {}),
      address: {
        street: field(b, "street"),
        locality: field(b, "locality"),
        city,
        state,
        country: "India",
        zipCode: field(b, "zipCode"),
      },
    },
    amenities: {
      parking: facilities.includes("Parking"),
      wifi: facilities.some((f) => /wifi/i.test(f)),
      pool: facilities.includes("Swimming Pool"),
      gym: facilities.includes("Fitness Center"),
      spa: facilities.includes("Spa"),
      restaurant: facilities.includes("Restaurant"),
      bar: facilities.includes("Bar"),
      airportShuttle: facilities.includes("Airport Shuttle"),
      businessCenter: false,
    },
  };
  if (coordsOk) data.geo = { type: "Point", coordinates: [longitude, latitude] };
  return { errors, data };
}

const ownerCredits = (urls: string[]) =>
  urls.map((url) => ({ url, thumb: url, kind: "property", source: "Uploaded by the property", license: "© the property" }));

router.post("/", verifyToken, handleUpload, async (req: Request, res: Response) => {
  try {
    const files = ((req as any).files || []) as Express.Multer.File[];
    const { errors, data } = await parseHotelForm(req);
    if (!files.length) errors.push("Add at least one photo of the hotel");
    if (errors.length) return res.status(400).json({ message: errors[0], errors });

    const imageUrls = await uploadImages(files);
    const hotel = new Hotel({
      ...data,
      userId: req.userId,
      imageUrls,
      imageCredits: ownerCredits(imageUrls),
      imageSource: "property",
      photoScore: 2,
    });
    await hotel.save();
    res.status(201).send(hotel);
  } catch (e) {
    console.log(e);
    res.status(500).json({ message: "Could not save the hotel. Please try again." });
  }
});

router.get("/", verifyToken, async (req: Request, res: Response) => {
  try {
    const hotels = await Hotel.find({ userId: req.userId }).sort({ updatedAt: -1 }).lean();
    res.json(hotels);
  } catch (error) {
    res.status(500).json({ message: "Error fetching hotels" });
  }
});

router.get("/:id", verifyToken, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!isValidObjectId(id)) return res.status(404).json({ message: "Hotel not found" });
  try {
    const hotel = await Hotel.findOne({ _id: id, userId: req.userId }).lean();
    if (!hotel) return res.status(404).json({ message: "Hotel not found" });
    res.json(hotel);
  } catch (error) {
    res.status(500).json({ message: "Error fetching hotel" });
  }
});

router.put("/:hotelId", verifyToken, handleUpload, async (req: Request, res: Response) => {
  try {
    const hotelId = String(req.params.hotelId);
    if (!isValidObjectId(hotelId)) return res.status(404).json({ message: "Hotel not found" });
    const existing = await Hotel.findOne({ _id: hotelId, userId: req.userId });
    if (!existing) return res.status(404).json({ message: "Hotel not found" });

    const files = ((req as any).files || []) as Express.Multer.File[];
    const { errors, data } = await parseHotelForm(req);
    // Images the owner chose to keep (others were removed in the form).
    const keep = asList(req.body.imageUrls ?? req.body["imageUrls[]"]).filter((url) => existing.imageUrls.includes(url));
    if (keep.length + files.length === 0) errors.push("A hotel needs at least one photo");
    if (keep.length + files.length > MAX_IMAGES) errors.push(`A hotel can have up to ${MAX_IMAGES} photos`);
    if (errors.length) return res.status(400).json({ message: errors[0], errors });

    const uploaded = await uploadImages(files);
    const imageUrls = [...keep, ...uploaded];
    const oldCredits = (existing.imageCredits || []).filter((c: any) => keep.includes(c.url));
    const credits = imageUrls.map(
      (url) => oldCredits.find((c: any) => c.url === url) || ownerCredits([url])[0]
    );

    Object.assign(existing, data, { imageUrls, imageCredits: credits });
    if (uploaded.length) {
      existing.imageSource = "property";
      existing.photoScore = 2;
    }
    await existing.save();
    res.status(200).json(existing);
  } catch (error) {
    console.error("Error updating hotel:", error);
    res.status(500).json({ message: "Could not update the hotel. Please try again." });
  }
});

router.delete("/:hotelId", verifyToken, async (req: Request, res: Response) => {
  try {
    const hotelId = String(req.params.hotelId);
    if (!isValidObjectId(hotelId)) return res.status(404).json({ message: "Hotel not found" });
    const hotel = await Hotel.findOne({ _id: hotelId, userId: req.userId });
    if (!hotel) return res.status(404).json({ message: "Hotel not found" });
    const upcoming = await Booking.countDocuments({
      hotelId,
      status: { $in: ["pending", "confirmed"] },
      checkOut: { $gte: new Date() },
    });
    if (upcoming > 0) {
      return res.status(400).json({ message: `This hotel has ${upcoming} upcoming booking(s) and cannot be deleted yet` });
    }
    await hotel.deleteOne();
    res.json({ message: "Hotel deleted" });
  } catch (error) {
    console.error("Error deleting hotel:", error);
    res.status(500).json({ message: "Could not delete the hotel" });
  }
});

export default router;
