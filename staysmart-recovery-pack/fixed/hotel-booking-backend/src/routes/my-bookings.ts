import express, { Request, Response } from "express";
import mongoose from "mongoose";
import verifyToken from "../middleware/auth";
import Hotel from "../models/hotel";
import Booking from "../models/booking";
import User from "../models/user";

const router = express.Router();

const isValidObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id) && /^[a-f\d]{24}$/i.test(id);

// /api/my-bookings -> the signed-in user's bookings grouped by hotel
router.get("/", verifyToken, async (req: Request, res: Response) => {
  try {
    const includeCancelled = String(req.query.includeCancelled || "").toLowerCase() === "true";
    const bookingFilter: any = { userId: req.userId };
    if (!includeCancelled) bookingFilter.status = { $nin: ["cancelled", "refunded"] };

    const userBookings = await Booking.find(bookingFilter).sort({ checkIn: -1, createdAt: -1 }).lean();
    if (userBookings.length === 0) return res.status(200).send([]);

    const hotelIds = Array.from(new Set(userBookings.map((b) => b.hotelId))).filter(isValidObjectId);
    const hotels = await Hotel.find({ _id: { $in: hotelIds } })
      .select("name city country location imageUrls imageCredits imageSource starRating pricePerNight contact type")
      .lean();
    const hotelMap = new Map<string, any>(hotels.map((hotel: any) => [hotel._id.toString(), hotel]));

    const grouped = new Map<string, any[]>();
    for (const booking of userBookings) {
      const key = String(booking.hotelId);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(booking);
    }

    const response = Array.from(grouped.entries())
      .map(([hotelId, bookings]) => {
        const hotel = hotelMap.get(hotelId);
        if (!hotel) return null;
        return { ...hotel, bookings };
      })
      .filter(Boolean);

    res.status(200).send(response);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Unable to fetch bookings" });
  }
});

router.patch("/:bookingId/cancel", verifyToken, async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;
    if (!isValidObjectId(bookingId)) return res.status(404).json({ message: "Booking not found" });
    const reasonRaw = typeof req.body?.cancellationReason === "string" ? req.body.cancellationReason : "";
    const cancellationReason = reasonRaw.trim().slice(0, 500) || "Cancelled by guest";

    const booking = await Booking.findOne({ _id: bookingId, userId: req.userId });
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (["cancelled", "completed", "refunded"].includes(booking.status)) {
      return res.status(400).json({ message: "This booking cannot be cancelled" });
    }
    if (new Date(booking.checkOut).getTime() < Date.now()) {
      return res.status(400).json({ message: "Past stays cannot be cancelled" });
    }

    const amount = Number(booking.totalCost || 0);
    const wasPaid = booking.paymentStatus === "paid";

    booking.status = "cancelled";
    booking.cancellationReason = cancellationReason;
    if (wasPaid) {
      booking.paymentStatus = "refunded";
      booking.refundAmount = amount;
    }
    await booking.save();

    await Hotel.findByIdAndUpdate(booking.hotelId, {
      $inc: { totalBookings: -1, totalRevenue: wasPaid ? -amount : 0 },
    });
    await User.findByIdAndUpdate(req.userId, {
      $inc: { totalBookings: -1, totalSpent: wasPaid ? -amount : 0 },
    });

    res.status(200).json(booking);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Unable to cancel booking" });
  }
});

export default router;
