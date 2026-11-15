import "dotenv/config";
import dns from "dns";
import path from "path";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import mongoose from "mongoose";
import cookieParser from "cookie-parser";
import { v2 as cloudinary } from "cloudinary";
import swaggerUi from "swagger-ui-express";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import rateLimit from "express-rate-limit";
import userRoutes from "./routes/users";
import authRoutes from "./routes/auth";
import myHotelRoutes, { UPLOADS_DIR } from "./routes/my-hotels";
import hotelRoutes, { checkRazorpay, razorpayCredentials, razorpayStatus } from "./routes/hotels";
import bookingRoutes from "./routes/my-bookings";
import bookingsManagementRoutes from "./routes/bookings";
import healthRoutes from "./routes/health";
import businessInsightsRoutes from "./routes/business-insights";
import imageProxyRoutes from "./routes/image-proxy";
import googlePhotoRoutes from "./routes/google-photos";
import { isPlacesConfigured, usageThisMonth } from "./lib/google-places";
import { specs } from "./swagger";
import { metricsMiddleware } from "./lib/metrics";

// ================================================================
// DNS (optional)
// ================================================================
// The previous code forced every DNS lookup through 192.168.1.1, which only
// works on one particular home router. Set DNS_SERVERS (comma separated) only
// if your network's resolver cannot answer the SRV lookups mongodb+srv needs,
// e.g. DNS_SERVERS=8.8.8.8,1.1.1.1
if (process.env.DNS_SERVERS) {
  dns.setServers(process.env.DNS_SERVERS.split(",").map((s) => s.trim()).filter(Boolean));
}

// ================================================================
// ENVIRONMENT VARIABLES VALIDATION
// ================================================================

const requiredEnvVars = ["MONGODB_CONNECTION_STRING", "JWT_SECRET_KEY"];
const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);
if (missingEnvVars.length > 0) {
  console.error("Missing required environment variables:");
  missingEnvVars.forEach((envVar) => console.error(`   - ${envVar}`));
  process.exit(1);
}

const isProduction = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT || 5001);
const BACKEND_URL = (process.env.BACKEND_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
console.log(`Frontend URL: ${process.env.FRONTEND_URL || "Not set"}`);
console.log(`Backend URL: ${BACKEND_URL}`);
if (!razorpayCredentials()) {
  console.warn("Razorpay is not configured: online payment is disabled (pay-at-hotel bookings still work).");
}

// ================================================================
// CLOUDINARY CONFIGURATION
// ================================================================

if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  console.log("Cloudinary configured (local storage is used as a fallback)");
} else {
  console.warn("Cloudinary is not configured: uploaded hotel photos are stored in ./uploads");
}

// ================================================================
// MONGODB CONNECTION
// ================================================================

const connectDB = async () => {
  const uri = process.env.MONGODB_CONNECTION_STRING as string;
  const safeUri = uri.replace(/\/\/([^:]+):[^@]+@/, "//$1:****@");
  console.log(`Connecting to MongoDB at ${safeUri} ...`);
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    console.log(`MongoDB connected (database: ${mongoose.connection.db?.databaseName})`);
  } catch (error: any) {
    console.error("MongoDB connection error:", error?.message || error);
    if (/127\.0\.0\.1|localhost/.test(uri)) {
      console.error("Is the local database running? Start everything with start-staysmart.ps1 (it launches tools\\mongodb\\bin\\mongod.exe).");
    } else {
      console.error("Check the Atlas cluster is running and your IP is in its Network Access list.");
    }
    process.exit(1);
  }
};

mongoose.connection.on("disconnected", () => console.warn("MongoDB disconnected. Attempting to reconnect..."));
mongoose.connection.on("reconnected", () => console.log("MongoDB reconnected successfully"));
mongoose.connection.on("error", (error) => console.error("MongoDB connection error:", error));

// ================================================================
// EXPRESS APP
// ================================================================

const app = express();
app.set("trust proxy", isProduction ? 1 : 0);

app.use(
  helmet({
    // Uploaded photos (/uploads) are displayed by the frontend on another origin.
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // Swagger UI uses inline scripts/styles.
    contentSecurityPolicy: false,
  })
);

// Rate limiting. The SPA makes several API calls per page, so the old limit
// (200 requests / 15 min) produced "429 Too Many Requests" during normal use.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 1000 : 10000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests from this IP, please try again later." },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 50 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many sign-in attempts. Please wait a few minutes and try again." },
});
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many payment requests, please try again later." },
});

app.use("/api/", generalLimiter);
app.use(["/api/auth/login", "/api/users/register"], authLimiter);
app.use(/^\/api\/hotels\/[^/]+\/bookings\/(checkout-order|verify-payment|pay-at-hotel)$/, paymentLimiter);

app.use(compression());
app.use(morgan(isProduction ? "combined" : "dev"));
app.use(metricsMiddleware);

// ================================================================
// CORS
// ================================================================

const allowedOrigins = [
  process.env.FRONTEND_URL,
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "https://mern-booking-hotel.netlify.app",
  "https://hotel-mern-booking.vercel.app",
].filter((origin): origin is string => Boolean(origin));

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    if (!isProduction) console.log("CORS blocked origin:", origin);
    return callback(null, false);
  },
  credentials: true,
  optionsSuccessStatus: 204,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie", "X-Requested-With"],
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Locally stored hotel photos (used when Cloudinary is unavailable).
app.use("/uploads", express.static(UPLOADS_DIR, { maxAge: "7d", fallthrough: false }));
// Self-hosted copies of Wikimedia Commons photos (see scripts/fetch-hotel-images.js "media" stage).
app.use("/media", express.static(path.resolve(process.env.STORAGE_DIR || process.cwd(), "media"), { maxAge: "30d", immutable: true, fallthrough: false }));
// Cached proxy for photos published on hotels' own websites.
app.use("/img", imageProxyRoutes);

// ================================================================
// ROUTES
// ================================================================

app.get("/", (_req: Request, res: Response) => {
  res.send('<h1>StaySmart Backend API is running</h1><p><a href="/api-docs">API documentation</a> · <a href="/api/health">Health</a></p>');
});

// Feature flags the frontend needs at runtime.
app.get("/api/config", async (_req: Request, res: Response) => {
  const google = Boolean(
    process.env.GOOGLE_ID && process.env.GOOGLE_SECRET && !/your_google_client/i.test(process.env.GOOGLE_ID + process.env.GOOGLE_SECRET)
  );
  let googlePhotos = false;
  if (isPlacesConfigured() && mongoose.connection.readyState === 1) {
    const usage = await usageThisMonth().catch(() => ({} as Record<string, number>));
    googlePhotos = (usage.photo || 0) < Number(process.env.PLACES_PHOTO_MONTHLY_LIMIT ?? 950);
  }
  res.json({
    photos: { google: googlePhotos },
    payments: {
      razorpay: Boolean(razorpayCredentials()) && razorpayStatus.usable,
      razorpayStatus: razorpayStatus.reason,
      payAtHotel: true,
    },
    auth: { google },
    uploads: { maxImages: 6, maxSizeMb: 5 },
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/my-hotels", myHotelRoutes);
app.use("/api/hotels", hotelRoutes);
app.use("/api/my-bookings", bookingRoutes);
app.use("/api/bookings", bookingsManagementRoutes);
app.use("/api/health", healthRoutes);
app.use("/api/business-insights", businessInsightsRoutes);
app.use("/api/gphoto", googlePhotoRoutes);

app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(specs, {
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "StaySmart API Documentation",
  })
);

// Unknown API routes -> JSON 404 instead of Express' HTML page.
app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ message: "API route not found" });
});

// Last-resort error handler (malformed JSON, unexpected exceptions...).
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Malformed JSON in request body" });
  }
  if (err?.status === 404 || err?.statusCode === 404) {
    return res.status(404).json({ message: "Not found" });
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ message: "Something went wrong" });
});

// ================================================================
// SERVER STARTUP
// ================================================================

let server: import("http").Server | null = null;

const startServer = async () => {
  await connectDB();
  void checkRazorpay().then((status) => {
    if (status.usable) console.log(`Razorpay: ${status.reason === "ok" ? "keys verified" : status.reason}`);
    else console.warn(`Razorpay online payment disabled: ${status.reason} (pay-at-hotel bookings still work)`);
  });
  server = app.listen(PORT, () => {
    console.log("============================================");
    console.log(`Server running on port ${PORT}`);
    console.log(`Local:        http://localhost:${PORT}`);
    console.log(`API Docs:     ${BACKEND_URL}/api-docs`);
    console.log(`Health Check: ${BACKEND_URL}/api/health`);
    console.log("============================================");
  });
  server.on("error", (error: any) => {
    if (error?.code === "EADDRINUSE") {
      // Previously the server silently moved to another port while the
      // frontend kept calling this one. Fail loudly instead.
      console.error(`Port ${PORT} is already in use. Stop the other process (or change PORT in .env and the frontend proxy).`);
    } else {
      console.error("Server error:", error);
    }
    process.exit(1);
  });
};

const gracefulShutdown = (signal: string) => {
  console.log(`\n${signal} received. Shutting down...`);
  const closeMongo = async () => {
    try {
      if (mongoose.connection.readyState !== 0) await mongoose.connection.close();
    } finally {
      process.exit(0);
    }
  };
  if (server) server.close(() => void closeMongo());
  else void closeMongo();
  setTimeout(() => process.exit(1), 10000).unref();
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  // Log but keep serving: one failed promise should not take the API down.
  console.error("Unhandled Rejection:", reason);
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

void startServer();
