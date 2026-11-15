import express, { Request, Response } from "express";
import mongoose from "mongoose";
import Hotel from "../models/hotel";
import { getPhotoUri, getPlacePhotos, isPlacesConfigured, usageThisMonth } from "../lib/google-places";

/**
 *   GET /api/gphoto/:hotelId/:index?w=480     -> 302 to the photo (live from Google)
 *   GET /api/gphoto/:hotelId/credits          -> live author attributions
 *   GET /api/gphoto/usage                     -> this month's Google usage counters
 */
const router = express.Router();
const isValidObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id) && /^[a-f\d]{24}$/i.test(id);

const placeIdFor = async (hotelId: string) => {
  if (!isValidObjectId(hotelId)) return null;
  const hotel = await Hotel.findById(hotelId).select("googlePlaceId").lean<{ googlePlaceId?: string }>();
  return hotel?.googlePlaceId || null;
};

router.get("/usage", async (_req: Request, res: Response) => {
  res.json({
    configured: isPlacesConfigured(),
    usage: await usageThisMonth(),
    limits: {
      autocomplete: Number(process.env.PLACES_MATCH_MONTHLY_LIMIT ?? 9000),
      photo: Number(process.env.PLACES_PHOTO_MONTHLY_LIMIT ?? 950),
    },
  });
});

router.get("/:hotelId/credits", async (req: Request, res: Response) => {
  try {
    const placeId = await placeIdFor(req.params.hotelId);
    if (!placeId) return res.json({ photos: [] });
    const photos = await getPlacePhotos(placeId);
    res.setHeader("Cache-Control", "private, max-age=600");
    res.json({
      mapsUrl: `https://www.google.com/maps/place/?q=place_id:${placeId}`,
      photos: photos.slice(0, 10).map((p, index) => ({
        index,
        widthPx: p.widthPx,
        heightPx: p.heightPx,
        authors: (p.authorAttributions || []).map((a) => ({ name: a.displayName || "Google Maps user", uri: a.uri || "" })),
      })),
    });
  } catch {
    res.json({ photos: [] });
  }
});

router.get("/:hotelId/:index", async (req: Request, res: Response) => {
  try {
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0 || index > 9) return res.status(404).end();
    const placeId = await placeIdFor(req.params.hotelId);
    if (!placeId) return res.status(404).end();
    const photos = await getPlacePhotos(placeId);
    const photo = photos[index];
    if (!photo) return res.status(404).end();
    const uri = await getPhotoUri(photo.name, Number(req.query.w) || 800);
    if (!uri) return res.status(404).end(); // monthly budget used up -> the UI shows the next photo
    // The browser may reuse this redirect for an hour; nothing is stored server-side.
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.redirect(302, uri);
  } catch {
    res.status(404).end();
  }
});

export default router;
