import express, { Request, Response } from "express";
import { check, validationResult } from "express-validator";
import User from "../models/user";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import verifyToken from "../middleware/auth";
import { clearSessionCookie, setSessionCookie, signSessionToken } from "../lib/session";

const router = express.Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_SECRET;
const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:5174").replace(/\/$/, "");
const BACKEND_URL = (process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5001}`).replace(/\/$/, "");
const OAUTH_STATE_COOKIE = "oauth_state";

// The .env template ships placeholder values; treat those as "not configured".
const isGoogleConfigured = () =>
  Boolean(
    GOOGLE_CLIENT_ID &&
      GOOGLE_CLIENT_SECRET &&
      !/your_google_client/i.test(GOOGLE_CLIENT_ID) &&
      !/your_google_client/i.test(GOOGLE_CLIENT_SECRET)
  );

const publicUser = (user: any) => ({
  id: user._id,
  _id: user._id,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  image: user.image,
  role: user.role,
});

/**
 * @swagger
 * /api/auth/providers:
 *   get:
 *     summary: Which sign-in methods are available
 *     tags: [Authentication]
 */
router.get("/providers", (_req: Request, res: Response) => {
  res.json({ password: true, google: isGoogleConfigured() });
});

/**
 * @swagger
 * /api/auth/google:
 *   get:
 *     summary: Initiate Google OAuth
 *     description: Redirects user to Google sign-in
 *     tags: [Authentication]
 */
router.get("/google", (req: Request, res: Response) => {
  if (!isGoogleConfigured()) {
    return res.redirect(`${FRONTEND_URL}/sign-in?error=oauth_config`);
  }
  const state = crypto.randomBytes(24).toString("hex");
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60 * 1000,
  });
  const redirectUri = `${BACKEND_URL}/api/auth/callback/google`;
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID as string,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

/**
 * @swagger
 * /api/auth/callback/google:
 *   get:
 *     summary: Google OAuth callback
 *     description: Handles redirect from Google, creates/logs in user
 *     tags: [Authentication]
 */
router.get("/callback/google", async (req: Request, res: Response) => {
  const { code, error, state } = req.query;

  if (error) {
    return res.redirect(`${FRONTEND_URL}/sign-in?error=${encodeURIComponent(String(error))}`);
  }
  if (!code || !isGoogleConfigured()) {
    return res.redirect(`${FRONTEND_URL}/sign-in?error=oauth_config`);
  }
  const expectedState = req.cookies?.[OAUTH_STATE_COOKIE];
  res.clearCookie(OAUTH_STATE_COOKIE);
  if (!expectedState || expectedState !== state) {
    return res.redirect(`${FRONTEND_URL}/sign-in?error=oauth_state`);
  }

  try {
    const redirectUri = `${BACKEND_URL}/api/auth/callback/google`;
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: String(code),
        client_id: GOOGLE_CLIENT_ID as string,
        client_secret: GOOGLE_CLIENT_SECRET as string,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData: any = await tokenRes.json();
    if (tokenData.error) {
      console.error("Google token error:", tokenData);
      return res.redirect(`${FRONTEND_URL}/sign-in?error=token_exchange`);
    }

    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const googleUser: any = await userRes.json();
    const email = String(googleUser.email || "").toLowerCase();
    if (!email) {
      return res.redirect(`${FRONTEND_URL}/sign-in?error=no_email`);
    }
    const name = googleUser.name || "";
    const [firstName, ...lastParts] = name.split(" ");
    const lastName = lastParts.join(" ") || firstName;
    const image = googleUser.picture || undefined;

    let user = await User.findOne({ email });
    if (!user) {
      user = new User({
        email,
        firstName: firstName || "Guest",
        lastName: lastName || "User",
        password: crypto.randomBytes(32).toString("hex"),
        image,
        emailVerified: true,
      });
      await user.save();
    } else {
      await User.findByIdAndUpdate(user._id, { image, emailVerified: true, lastLogin: new Date() });
    }

    const token = signSessionToken(String(user._id));
    setSessionCookie(res, token);

    const redirectUrl = new URL(`${FRONTEND_URL}/auth/callback`);
    redirectUrl.searchParams.set("token", token);
    redirectUrl.searchParams.set("userId", String(user._id));
    redirectUrl.searchParams.set("email", user.email);
    redirectUrl.searchParams.set("firstName", user.firstName);
    redirectUrl.searchParams.set("lastName", user.lastName);
    if (image) redirectUrl.searchParams.set("image", image);
    res.redirect(redirectUrl.toString());
  } catch (err) {
    console.error("Google OAuth error:", err);
    res.redirect(`${FRONTEND_URL}/sign-in?error=server_error`);
  }
});

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: User login
 *     description: Authenticate user with email and password
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, minLength: 6 }
 *     responses:
 *       200: { description: Login successful }
 *       400: { description: Invalid credentials or validation error }
 */
router.post(
  "/login",
  [
    check("email", "Please enter a valid email address").isEmail(),
    check("password", "Password must be at least 6 characters").isLength({ min: 6 }),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: errors.array()[0].msg, errors: errors.array() });
    }

    const email = String(req.body.email).trim().toLowerCase();
    const { password } = req.body;

    try {
      const user = await User.findOne({ email });
      if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(400).json({ message: "Incorrect email or password" });
      }

      await User.updateOne({ _id: user._id }, { lastLogin: new Date() });
      const token = signSessionToken(String(user._id));
      setSessionCookie(res, token);

      res.status(200).json({
        userId: user._id,
        message: "Login successful",
        token,
        user: publicUser(user),
      });
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  }
);

/**
 * @swagger
 * /api/auth/validate-token:
 *   get:
 *     summary: Validate authentication token
 *     tags: [Authentication]
 *     responses:
 *       200: { description: Token is valid }
 *       401: { description: Token is invalid or expired }
 */
/**
 * Current session without an error for signed-out visitors (always 200), so
 * the SPA can check the httpOnly cookie on load without a 401 in the console.
 */
router.get("/session", async (req: Request, res: Response) => {
  const header = req.headers.authorization;
  let token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || token === "null" || token === "undefined") token = req.cookies?.session_id || req.cookies?.auth_token || "";
  if (!token) return res.json({ user: null });
  try {
    const decoded: any = jwt.verify(token, process.env.JWT_SECRET_KEY as string);
    const user = await User.findById(decoded?.userId).select("-password").lean();
    if (!user) {
      clearSessionCookie(res);
      return res.json({ user: null });
    }
    res.json({ user: publicUser(user), userId: String(user._id) });
  } catch {
    clearSessionCookie(res);
    res.json({ user: null, expired: true });
  }
});

router.get("/validate-token", verifyToken, async (req: Request, res: Response) => {
  const user = await User.findById(req.userId).select("-password").lean();
  if (!user) {
    clearSessionCookie(res);
    return res.status(401).json({ message: "Account not found. Please sign in again." });
  }
  res.status(200).send({ userId: req.userId, user: publicUser(user) });
});

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: User logout
 *     tags: [Authentication]
 */
router.post("/logout", (req: Request, res: Response) => {
  clearSessionCookie(res);
  res.status(200).json({ message: "Signed out" });
});

export default router;
