import express, { Request, Response } from "express";
import mongoose from "mongoose";
import Hotel from "../models/hotel";
import User from "../models/user";
import Booking from "../models/booking";
import verifyToken from "../middleware/auth";
import { getRequestMetrics } from "../lib/metrics";

const router = express.Router();

const DAY = 24 * 60 * 60 * 1000;
const round2 = (n: number) => Math.round((n || 0) * 100) / 100;
const ACTIVE = { status: { $nin: ["cancelled", "refunded"] } };

// hotelId is stored as a string on bookings; convert safely for $lookup.
const hotelLookup = [
  { $addFields: { hotelObjectId: { $convert: { input: "$hotelId", to: "objectId", onError: null, onNull: null } } } },
  { $lookup: { from: "hotels", localField: "hotelObjectId", foreignField: "_id", as: "hotel" } },
  { $unwind: "$hotel" },
];

/**
 * @swagger
 * /api/business-insights/dashboard:
 *   get:
 *     summary: Business insights dashboard data
 *     tags: [Business Insights]
 */
const getDashboardData = async () => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const [
    totalHotels,
    totalUsers,
    bookingTotals,
    recent,
    currentMonth,
    previousMonth,
    statusBreakdown,
    paymentBreakdown,
    destinationsByBookings,
    hotelPerformance,
    daily,
    byState,
    byStar,
    byType,
    photoCoverage,
    priceByCity,
  ] = await Promise.all([
    Hotel.countDocuments(),
    User.countDocuments(),
    Booking.aggregate([
      {
        $group: {
          _id: null,
          totalBookings: { $sum: 1 },
          activeBookings: { $sum: { $cond: [{ $in: ["$status", ["cancelled", "refunded"]] }, 0, 1] } },
          paidRevenue: { $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, "$totalCost", 0] } },
          bookedValue: { $sum: { $cond: [{ $in: ["$status", ["cancelled", "refunded"]] }, 0, "$totalCost"] } },
        },
      },
    ]),
    Booking.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo }, ...ACTIVE } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: "$totalCost" } } },
    ]),
    Booking.aggregate([{ $match: { createdAt: { $gte: monthStart }, ...ACTIVE } }, { $group: { _id: null, value: { $sum: "$totalCost" } } }]),
    Booking.aggregate([
      { $match: { createdAt: { $gte: prevMonthStart, $lt: monthStart }, ...ACTIVE } },
      { $group: { _id: null, value: { $sum: "$totalCost" } } },
    ]),
    Booking.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Booking.aggregate([{ $group: { _id: { $ifNull: ["$paymentMethod", "unknown"] }, count: { $sum: 1 } } }]),
    Booking.aggregate([
      { $match: ACTIVE },
      ...hotelLookup,
      { $group: { _id: "$hotel.city", count: { $sum: 1 }, totalRevenue: { $sum: "$totalCost" }, avgPrice: { $avg: "$hotel.pricePerNight" } } },
      { $sort: { count: -1 } },
      { $limit: 6 },
    ]),
    Booking.aggregate([
      { $match: ACTIVE },
      ...hotelLookup,
      {
        $group: {
          _id: "$hotel._id",
          name: { $first: "$hotel.name" },
          city: { $first: "$hotel.city" },
          starRating: { $first: "$hotel.starRating" },
          pricePerNight: { $first: "$hotel.pricePerNight" },
          bookingCount: { $sum: 1 },
          totalRevenue: { $sum: "$totalCost" },
        },
      },
      { $sort: { bookingCount: -1, totalRevenue: -1 } },
      { $limit: 10 },
    ]),
    Booking.aggregate([
      { $match: { createdAt: { $gte: new Date(now.getTime() - 13 * DAY) } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Kolkata" } }, bookings: { $sum: 1 }, value: { $sum: "$totalCost" } } },
    ]),
    Hotel.aggregate([{ $group: { _id: "$location.address.state", count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 12 }]),
    Hotel.aggregate([{ $group: { _id: "$starRating", count: { $sum: 1 }, official: { $sum: { $cond: [{ $eq: ["$starRatingSource", "official"] }, 1, 0] } } } }, { $sort: { _id: 1 } }]),
    Hotel.aggregate([{ $unwind: "$type" }, { $group: { _id: "$type", count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }]),
    Hotel.aggregate([{ $group: { _id: "$imageSource", count: { $sum: 1 } } }]),
    Hotel.aggregate([
      { $group: { _id: "$city", hotels: { $sum: 1 }, avgPrice: { $avg: "$pricePerNight" }, minPrice: { $min: "$pricePerNight" } } },
      { $sort: { hotels: -1 } },
      { $limit: 10 },
    ]),
  ]);

  const totals = bookingTotals[0] || { totalBookings: 0, activeBookings: 0, paidRevenue: 0, bookedValue: 0 };
  const current = currentMonth[0]?.value || 0;
  const previous = previousMonth[0]?.value || 0;
  const revenueGrowth = previous > 0 ? ((current - previous) / previous) * 100 : 0;

  // Last 14 days including days with zero bookings.
  const dailyMap = new Map(daily.map((d) => [d._id, d]));
  const dailyBookings = Array.from({ length: 14 }, (_, i) => {
    const date = new Date(now.getTime() - (13 - i) * DAY);
    const key = date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const hit = dailyMap.get(key);
    return { date: key, bookings: hit?.bookings || 0, value: round2(hit?.value || 0) };
  });

  const popularDestinations = destinationsByBookings.length
    ? destinationsByBookings.map((d) => ({ _id: d._id, count: d.count, totalRevenue: round2(d.totalRevenue), avgPrice: Math.round(d.avgPrice || 0), basis: "bookings" }))
    : priceByCity.slice(0, 6).map((d) => ({ _id: d._id, count: d.hotels, totalRevenue: 0, avgPrice: Math.round(d.avgPrice || 0), basis: "hotels" }));

  return {
    overview: {
      totalHotels,
      totalUsers,
      totalBookings: totals.totalBookings,
      activeBookings: totals.activeBookings,
      recentBookings: recent[0]?.count || 0,
      totalRevenue: round2(totals.paidRevenue),
      bookedValue: round2(totals.bookedValue),
      recentRevenue: round2(recent[0]?.value || 0),
      revenueGrowth: round2(revenueGrowth),
    },
    popularDestinations,
    dailyBookings,
    hotelPerformance: hotelPerformance.map((h) => ({ ...h, totalRevenue: round2(h.totalRevenue) })),
    bookingStatus: statusBreakdown.map((s) => ({ status: s._id, count: s.count })),
    paymentMethods: paymentBreakdown.map((p) => ({ method: p._id, count: p.count })),
    inventory: {
      byState: byState.map((s) => ({ state: s._id || "Unknown", count: s.count })),
      byStar: byStar.map((s) => ({ stars: s._id, count: s.count, official: s.official })),
      byType: byType.map((t) => ({ type: t._id, count: t.count })),
      photoCoverage: photoCoverage.map((p) => ({ source: p._id || "unknown", count: p.count })),
      priceByCity: priceByCity.map((c) => ({ city: c._id, hotels: c.hotels, avgPrice: Math.round(c.avgPrice || 0), minPrice: c.minPrice })),
    },
    lastUpdated: now.toISOString(),
  };
};

const sendDashboard = async (_req: Request, res: Response) => {
  try {
    res.status(200).json(await getDashboardData());
  } catch (error) {
    console.error("dashboard error", error);
    res.status(500).json({ error: "Failed to fetch business insights data", message: error instanceof Error ? error.message : "Unknown error" });
  }
};
router.get("/dashboard/public", sendDashboard);
router.get("/dashboard", verifyToken, sendDashboard);

// Linear trend over weekly booking counts (needs at least two weeks of data).
const getForecastData = async () => {
  const now = new Date();
  const since = new Date(now.getTime() - 12 * 7 * DAY);
  const weekly = await Booking.aggregate([
    { $match: { createdAt: { $gte: since }, ...ACTIVE } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: { $dateTrunc: { date: "$createdAt", unit: "week", timezone: "Asia/Kolkata" } } } },
        bookings: { $sum: 1 },
        revenue: { $sum: "$totalCost" },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  const historical = weekly.map((w) => ({ week: w._id, bookings: w.bookings, revenue: round2(w.revenue) }));

  const trend = (values: number[]) => {
    const n = values.length;
    if (n < 2) return { slope: 0, intercept: n ? values[0] : 0 };
    const sumX = (n * (n - 1)) / 2;
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = values.reduce((a, v, i) => a + v * i, 0);
    const sumXX = (n * (n - 1) * (2 * n - 1)) / 6;
    const denom = n * sumXX - sumX * sumX;
    const slope = denom ? (n * sumXY - sumX * sumY) / denom : 0;
    return { slope, intercept: (sumY - slope * sumX) / n };
  };
  const b = trend(historical.map((h) => h.bookings));
  const r = trend(historical.map((h) => h.revenue));

  const forecasts = historical.length >= 2
    ? Array.from({ length: 4 }, (_, k) => {
        const i = historical.length + k;
        return {
          week: new Date(now.getTime() + (k + 1) * 7 * DAY).toISOString().split("T")[0],
          bookings: Math.max(0, Math.round(b.slope * i + b.intercept)),
          revenue: round2(Math.max(0, r.slope * i + r.intercept)),
          confidence: Number(Math.max(0.5, 0.9 - k * 0.1).toFixed(2)),
        };
      })
    : [];

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [thisMonth, lastMonth] = await Promise.all([
    Booking.countDocuments({ createdAt: { $gte: monthStart }, ...ACTIVE }),
    Booking.countDocuments({ createdAt: { $gte: prevMonthStart, $lt: monthStart }, ...ACTIVE }),
  ]);

  return {
    historical,
    forecasts,
    enoughData: historical.length >= 2,
    seasonalGrowth: lastMonth > 0 ? round2(((thisMonth - lastMonth) / lastMonth) * 100) : 0,
    trends: {
      bookingTrend: historical.length > 1 ? (b.slope > 0.01 ? "increasing" : b.slope < -0.01 ? "decreasing" : "stable") : "stable",
      revenueTrend: historical.length > 1 ? (r.slope > 0.01 ? "increasing" : r.slope < -0.01 ? "decreasing" : "stable") : "stable",
    },
    lastUpdated: now.toISOString(),
  };
};

const sendForecast = async (_req: Request, res: Response) => {
  try {
    res.status(200).json(await getForecastData());
  } catch (error) {
    console.error("forecast error", error);
    res.status(500).json({ error: "Failed to generate forecasts", message: error instanceof Error ? error.message : "Unknown error" });
  }
};
router.get("/forecast/public", sendForecast);
router.get("/forecast", verifyToken, sendForecast);

const getSystemStatsData = async () => {
  const mem = process.memoryUsage();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [totalHotels, totalBookings, revenue, todayBookings, weekBookings, collections] = await Promise.all([
    Hotel.estimatedDocumentCount(),
    Booking.estimatedDocumentCount(),
    Booking.aggregate([{ $match: { paymentStatus: "paid" } }, { $group: { _id: null, v: { $sum: "$totalCost" } } }]),
    Booking.countDocuments({ createdAt: { $gte: today } }),
    Booking.countDocuments({ createdAt: { $gte: new Date(Date.now() - 7 * DAY) } }),
    mongoose.connection.db?.listCollections().toArray() ?? Promise.resolve([]),
  ]);
  const requests = getRequestMetrics();
  return {
    system: {
      memory: {
        used: Math.round(mem.heapUsed / 1024 / 1024),
        total: Math.round(mem.heapTotal / 1024 / 1024),
        rss: Math.round(mem.rss / 1024 / 1024),
        percentage: Math.round((mem.heapUsed / mem.heapTotal) * 100),
      },
      cpu: process.cpuUsage(),
      uptime: Math.round(process.uptime()),
      nodeVersion: process.version,
    },
    database: {
      collections: collections.length,
      totalHotels,
      totalBookings,
      totalRevenue: round2(revenue[0]?.v || 0),
    },
    application: {
      avgResponseTime: requests.avgResponseTime,
      p95ResponseTime: requests.p95ResponseTime,
      requestsPerMinute: requests.requestsPerMinute,
      errorRate: requests.errorRate,
      totalRequests: requests.totalRequests,
      uptime: `${Math.floor(requests.uptimeSeconds / 3600)}h ${Math.floor((requests.uptimeSeconds % 3600) / 60)}m`,
      todayBookings,
      thisWeekBookings: weekBookings,
    },
    lastUpdated: new Date().toISOString(),
  };
};

const sendSystemStats = async (_req: Request, res: Response) => {
  try {
    res.status(200).json(await getSystemStatsData());
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch performance metrics", message: error instanceof Error ? error.message : "Unknown error" });
  }
};
router.get("/system-stats/public", sendSystemStats);
router.get("/system-stats", verifyToken, sendSystemStats);

export default router;
