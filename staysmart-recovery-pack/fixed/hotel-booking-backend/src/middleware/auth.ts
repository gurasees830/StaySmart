import { NextFunction, Request, Response } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { readSessionCookie } from "../lib/session";

declare global {
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

/**
 * Accepts either an `Authorization: Bearer <jwt>` header (used by the SPA,
 * which keeps the token in localStorage) or the httpOnly session cookie set at
 * sign-in. Previously the cookie name written at registration ("auth_token")
 * differed from the one read here ("session_id"), so cookie auth never worked.
 */
const verifyToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7).trim();
  }
  if (!token || token === "null" || token === "undefined") {
    token = readSessionCookie(req.cookies);
  }

  if (!token) {
    return res.status(401).json({ message: "Please sign in to continue" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY as string) as JwtPayload;
    if (!decoded?.userId) {
      return res.status(401).json({ message: "Your session is invalid. Please sign in again." });
    }
    req.userId = String(decoded.userId);
    next();
  } catch (error) {
    return res.status(401).json({ message: "Your session has expired. Please sign in again." });
  }
};

export default verifyToken;
