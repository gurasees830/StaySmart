import { CookieOptions, Response } from "express";
import jwt from "jsonwebtoken";

export const SESSION_COOKIE = "session_id";
const LEGACY_COOKIE = "auth_token";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const isProduction = () => process.env.NODE_ENV === "production";

const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  // Cross-site cookies need SameSite=None + Secure (production on HTTPS);
  // locally the frontend and API are both on localhost, so Lax works.
  secure: isProduction(),
  sameSite: isProduction() ? "none" : "lax",
  path: "/",
});

export const signSessionToken = (userId: string) =>
  jwt.sign({ userId }, process.env.JWT_SECRET_KEY as string, { expiresIn: "1d" });

export const setSessionCookie = (res: Response, token: string) => {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: ONE_DAY_MS });
};

export const clearSessionCookie = (res: Response) => {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
  res.clearCookie(LEGACY_COOKIE, cookieOptions());
};

export const readSessionCookie = (cookies: Record<string, string> | undefined) =>
  cookies?.[SESSION_COOKIE] || cookies?.[LEGACY_COOKIE];
