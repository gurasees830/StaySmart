import express, { Request, Response } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import Hotel from "../models/hotel";

/**
 * GET /img?u=<image url>
 *
 * Hotel photos found on hotels' own websites are served through this proxy:
 * the first request downloads the image (with a browser-like request, so
 * hotlink protection and burst rate limits don't break it) and stores it on
 * disk; every later request is served from the local copy.
 *
 * Only URLs that are stored on a hotel document can be fetched, so this is not
 * an open proxy.
 */
const router = express.Router();
export const PROXY_DIR = path.resolve(process.env.STORAGE_DIR || process.cwd(), "media", "proxy");
fs.mkdirSync(PROXY_DIR, { recursive: true });

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const MAX_BYTES = 8 * 1024 * 1024;
const inFlight = new Map<string, Promise<{ file: string; type: string } | null>>();
const allowedCache = new Map<string, boolean>();

const isAllowed = async (url: string) => {
  if (allowedCache.has(url)) return allowedCache.get(url)!;
  const ok = Boolean(await Hotel.exists({ imageUrls: url }));
  if (allowedCache.size > 20000) allowedCache.clear();
  allowedCache.set(url, ok);
  return ok;
};

async function fetchAndStore(url: string, key: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const origin = new URL(url).origin;
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "image/avif,image/webp,image/*,*/*;q=0.8", Referer: `${origin}/` },
      redirect: "follow",
      signal: controller.signal,
    });
    const type = (res.headers.get("content-type") || "").split(";")[0].trim();
    if (!res.ok || !/^image\/(jpeg|jpg|png|webp|avif|gif)$/i.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2000 || buf.length > MAX_BYTES) return null;
    const file = path.join(PROXY_DIR, key);
    await fs.promises.writeFile(file, buf);
    await fs.promises.writeFile(`${file}.json`, JSON.stringify({ url, type, at: new Date().toISOString() }));
    return { file, type };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

router.get("/", async (req: Request, res: Response) => {
  const url = String(req.query.u || "");
  if (!/^https?:\/\/[^/]+\//i.test(url) || url.length > 2000) return res.status(400).json({ message: "Invalid image URL" });
  const key = crypto.createHash("sha1").update(url).digest("hex");
  const file = path.join(PROXY_DIR, key);

  const send = (f: string, type: string) => {
    res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
    res.type(type);
    res.sendFile(f);
  };

  try {
    if (fs.existsSync(file) && fs.existsSync(`${file}.json`)) {
      const meta = JSON.parse(await fs.promises.readFile(`${file}.json`, "utf8"));
      return send(file, meta.type);
    }
    if (!(await isAllowed(url))) return res.status(404).json({ message: "Unknown image" });
    if (!inFlight.has(key)) {
      inFlight.set(key, fetchAndStore(url, key).finally(() => setTimeout(() => inFlight.delete(key), 1000)));
    }
    const stored = await inFlight.get(key);
    if (!stored) return res.status(502).json({ message: "Image unavailable" });
    send(stored.file, stored.type);
  } catch (error) {
    res.status(500).json({ message: "Image proxy error" });
  }
});

export default router;
