import express, { Request, Response } from "express";
import mongoose from "mongoose";
import Booking from "../models/booking";
import Hotel from "../models/hotel";
import User from "../models/user";
import verifyToken from "../middleware/auth";
import { body, validationResult } from "express-validator";

const router = express.Router();

const isValidObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id) && /^[a-f\d]{24}$/i.test(id);

const isAdmin = async (userId: string) => {
  const user = await User.findById(userId).select("role").lean();
  return user?.role === "admin";
};

/** Booking + who may manage it (guest, hotel owner, admin). */
async function loadBookingWithAccess(req: Request, res: Response) {
  const id = String(req.params.id);
  if (!isValidObjectId(id)) {
    res.status(404).json({ message: "Booking not found" });
    return null;
  }
  const booking = await Booking.findById(id);
  if (!booking) {
    res.status(404).json({ message: "Booking not found" });
    return null;
  }
  const hotel = isValidObjectId(booking.hotelId) ? await Hotel.findById(booking.hotelId).select("userId name city imageUrls").lean() : null;
  const isGuest = booking.userId === req.userId;
  const isOwner = Boolean(hotel && hotel.userId === req.userId);
  const admin = !isGuest && !isOwner ? await isAdmin(req.userId) : false;
  if (!isGuest && !isOwner && !admin) {
    res.status(403).json({ message: "You do not have access to this booking" });
    return null;
  }
  return { booking, hotel, isGuest, isOwner, admin };
}

// All bookings across the platform (admins), or for the caller's own hotels.
router.get("/", verifyToken, async (req: Request, res: Response) => {
  try {
    const admin = await isAdmin(req.userId);
    let filter: any = {};
    if (!admin) {
      const ownHotels = await Hotel.find({ userId: req.userId }).select("_id").lean();
      filter = { hotelId: { $in: ownHotels.map((h) => String(h._id)) } };
    }
    const bookings = await Booking.find(filter).sort({ createdAt: -1 }).limit(500).lean();
    const hotelIds = [...new Set(bookings.map((b) => b.hotelId))].filter(isValidObjectId);
    const hotels = await Hotel.find({ _id: { $in: hotelIds } }).select("name city country").lean();
    const byId = new Map(hotels.map((h) => [String(h._id), h]));
    res.status(200).json(bookings.map((b) => ({ ...b, hotel: byId.get(b.hotelId) || null })));
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Unable to fetch bookings" });
  }
});

// Bookings for one hotel (hotel owner only).
router.get("/hotel/:hotelId", verifyToken, async (req: Request, res: Response) => {
  try {
    const { hotelId } = req.params;
    if (!isValidObjectId(hotelId)) return res.status(404).json({ message: "Hotel not found" });
    const hotel = await Hotel.findById(hotelId).select("userId").lean();
    if (!hotel) return res.status(404).json({ message: "Hotel not found" });
    if (hotel.userId !== req.userId && !(await isAdmin(req.userId))) {
      return res.status(403).json({ message: "Access denied" });
    }

    const bookings = await Booking.find({ hotelId }).sort({ createdAt: -1 }).lean();
    const userIds = [...new Set(bookings.map((b) => b.userId))].filter(isValidObjectId);
    const users = await User.find({ _id: { $in: userIds } }).select("firstName lastName email").lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));
    res.status(200).json(bookings.map((b) => ({ ...b, user: byId.get(b.userId) || null })));
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Unable to fetch hotel bookings" });
  }
});

router.get("/:id", verifyToken, async (req: Request, res: Response) => {
  try {
    const access = await loadBookingWithAccess(req, res);
    if (!access) return;
    res.status(200).json({ ...access.booking.toObject(), hotel: access.hotel });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Unable to fetch booking" });
  }
});

// Hotel owners (or admins) update a booking's status.
router.patch(
  "/:id/status",
  verifyToken,
  [body("status").isIn(["pending", "confirmed", "cancelled", "completed", "refunded"]).withMessage("Invalid status")],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: errors.array()[0].msg });
    try {
      const access = await loadBookingWithAccess(req, res);
      if (!access) return;
      if (!access.isOwner && !access.admin) {
        return res.status(403).json({ message: "Only the hotel owner can change a booking's status" });
      }
      const { status, cancellationReason } = req.body;
      access.booking.status = status;
      if (status === "cancelled" && cancellationReason) {
        access.booking.cancellationReason = String(cancellationReason).slice(0, 500);
      }
      if (status === "refunded") {
        access.booking.refundAmount = Number(req.body.refundAmount) || access.booking.totalCost;
        access.booking.paymentStatus = "refunded";
      }
      await access.booking.save();
      res.status(200).json(access.booking);
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: "Unable to update booking" });
    }
  }
);

router.patch(
  "/:id/payment",
  verifyToken,
  [body("paymentStatus").isIn(["pending", "paid", "failed", "refunded"]).withMessage("Invalid payment status")],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: errors.array()[0].msg });
    try {
      const access = await loadBookingWithAccess(req, res);
      if (!access) return;
      if (!access.isOwner && !access.admin) {
        return res.status(403).json({ message: "Only the hotel owner can change payment status" });
      }
      const wasPaid = access.booking.paymentStatus === "paid";
      access.booking.paymentStatus = req.body.paymentStatus;
      if (req.body.paymentMethod) access.booking.paymentMethod = String(req.body.paymentMethod).slice(0, 40);
      await access.booking.save();
      // Pay-at-hotel bookings count towards revenue once the owner marks them paid.
      if (!wasPaid && req.body.paymentStatus === "paid") {
        await Hotel.findByIdAndUpdate(access.booking.hotelId, { $inc: { totalRevenue: access.booking.totalCost } });
        await User.findByIdAndUpdate(access.booking.userId, { $inc: { totalSpent: access.booking.totalCost } });
      }
      res.status(200).json(access.booking);
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: "Unable to update payment status" });
    }
  }
);

router.delete("/:id", verifyToken, async (req: Request, res: Response) => {
  try {
    const access = await loadBookingWithAccess(req, res);
    if (!access) return;
    if (!access.isOwner && !access.admin) {
      return res.status(403).json({ message: "Only the hotel owner can delete a booking" });
    }
    const booking = access.booking;
    await booking.deleteOne();
    const paid = booking.paymentStatus === "paid" ? booking.totalCost || 0 : 0;
    if (booking.status !== "cancelled") {
      await Hotel.findByIdAndUpdate(booking.hotelId, { $inc: { totalBookings: -1, totalRevenue: -paid } });
      await User.findByIdAndUpdate(booking.userId, { $inc: { totalBookings: -1, totalSpent: -paid } });
    }
    res.status(200).json({ message: "Booking deleted successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Unable to delete booking" });
  }
});

export default router;
