/**
 * StaySmart - gather real photos for every hotel.
 *
 * Stages (each one caches its results in data/image-cache so the script can be
 * stopped and resumed at any time, and re-runs only do the missing work):
 *
 *   wikidata  Hotels linked to Wikidata: the item's image (P18) plus files in
 *             its Commons category; the English Wikipedia summary is stored as
 *             a real description.
 *   commons   Geotagged Wikimedia Commons photos within 500 m of the hotel whose
 *             file name contains the hotel's name ("Taj Mahal Palace Hotel
 *             from Jetty.jpg" for the Taj Mahal Palace, Mumbai).
 *   websites  The hotel's official website: og:image / twitter:image / JSON-LD
 *             images and large gallery images, each verified to be a real
 *             image. Images shared by several hotels (chain banners) are
 *             discarded because they do not show a specific property.
 *   pool      A pool of real hotel photography (Unsplash, Openverse/Flickr,
 *             Wikimedia Commons) used as clearly-labelled representative photos
 *             for hotels that have no published photo of their own.
 *   assign    Writes imageUrls / imageCredits / imageSource to MongoDB.
 *             Property photos always come first. Representative photos are
 *             spread so that no two hotels in the same city share a main photo
 *             and reuse across the country is as even as possible.
 *
 * Usage:
 *   node scripts/fetch-hotel-images.js              (all stages)
 *   node scripts/fetch-hotel-images.js commons      (one stage)
 *   node scripts/fetch-hotel-images.js pool assign  (several stages)
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const MONGO_URI = process.env.MONGODB_CONNECTION_STRING;
const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY;
const CACHE_DIR = path.join(__dirname, "..", "data", "image-cache");
const UA = "StaySmartHotelApp/1.0 (local development build; hotel photo lookup)";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const TARGET_IMAGES = 5;

fs.mkdirSync(CACHE_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (value) => {
  let h = 2166136261;
  const s = String(value);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

function loadCache(name, fallback) {
  const file = path.join(CACHE_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function saveCache(name, data) {
  const file = path.join(CACHE_DIR, `${name}.json`);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
  fs.renameSync(`${file}.tmp`, file);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url, { headers = {}, retries = 4, timeoutMs = 20000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA, ...headers } }, timeoutMs);
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after")) || 2 ** attempt * 2;
        lastError = new Error(`HTTP ${res.status}`);
        await sleep(Math.min(retryAfter, 60) * 1000);
        continue;
      }
      const json = await res.json();
      if (json && json.error && json.error.code === "maxlag") {
        await sleep((Number(res.headers.get("retry-after")) || 5) * 1000);
        continue;
      }
      return { json, res };
    } catch (error) {
      lastError = error;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError || new Error(`Failed: ${url}`);
}

async function mapLimit(items, limit, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      await worker(items[current], current);
    }
  });
  await Promise.all(runners);
}

const stripHtml = (html) =>
  String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const norm = (s) =>
  String(s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Wikimedia only renders standard thumbnail widths (330/500/960/1280...);
// other widths return HTTP 400, which is what broke images before.
const commonsThumb = (thumbUrl, width) =>
  thumbUrl ? thumbUrl.replace(/\/\d+px-/, `/${width}px-`).replace(/\?.*$/, "") : thumbUrl;

// ---------------------------------------------------------------------------
// Commons imageinfo (batched)
// ---------------------------------------------------------------------------

async function commonsImageInfo(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 40) {
    const batch = titles.slice(i, i + 40);
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      maxlag: "5",
      titles: batch.join("|"),
      prop: "imageinfo",
      iiprop: "url|size|mime|extmetadata",
      iiurlwidth: "1280",
      iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|ObjectName",
    });
    const { json } = await getJson(`${COMMONS_API}?${params}`);
    for (const page of (json.query && json.query.pages) || []) {
      const info = page.imageinfo && page.imageinfo[0];
      if (!info) continue;
      const meta = info.extmetadata || {};
      out.set(page.title, {
        title: page.title,
        width: info.width,
        height: info.height,
        mime: info.mime,
        url: info.thumburl ? commonsThumb(info.thumburl, 1280) : info.url,
        thumb: info.thumburl ? commonsThumb(info.thumburl, 500) : info.url,
        pageUrl: info.descriptionurl,
        author: stripHtml(meta.Artist && meta.Artist.value).slice(0, 120) || "Wikimedia Commons contributor",
        license: stripHtml(meta.LicenseShortName && meta.LicenseShortName.value) || "See source",
        licenseUrl: (meta.LicenseUrl && meta.LicenseUrl.value) || "",
      });
    }
  }
  return out;
}

const usableCommonsImage = (info) =>
  info &&
  /^image\/(jpeg|png|webp)$/.test(info.mime || "") &&
  info.width >= 640 &&
  info.height >= 400 &&
  info.width / info.height <= 3.2 &&
  info.height / info.width <= 1.6;

const commonsCredit = (info, kind) => ({
  url: info.url,
  thumb: info.thumb,
  kind,
  source: "Wikimedia Commons",
  author: info.author,
  license: info.license,
  licenseUrl: info.licenseUrl,
  pageUrl: info.pageUrl,
  title: info.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, ""),
});

// ---------------------------------------------------------------------------
// Name matching (used for Commons photos)
// ---------------------------------------------------------------------------

const GENERIC = new Set(
  (
    "hotel hotels the and by of at in a an de la le n inn inns resort resorts spa lodge lodging guest house " +
    "guesthouse home homes homestay stay stays residency residence rooms room suites suite boutique international " +
    "grand deluxe luxury comforts comfort premier premium executive regency plaza new old royal hostel villa villas " +
    "cottage cottages tourist bungalow camp camps retreat india indian collection o oyo townhouse treebo fabhotel fab " +
    "trend capital flagship spot on hotel's private limited ltd pvt annex annexe"
  ).split(" ")
);
const HOTELISH =
  /\b(hotel|hotels|resort|inn|lodge|palace|haveli|guest ?house|homestay|hostel|retreat|villa|camp|suites?|residency|kothi|mahal|fort|vilas|niwas|nivas|bhawan|bhavan|lobby|room|pool)\b/;
const NOT_A_PHOTO =
  /\b(map|logo|plan|diagram|chart|signboard|signage|menu|receipt|ticket|seal|emblem|flag|coat of arms|screenshot|document|letterhead|brochure|invoice)\b/;

function coreTokens(hotel) {
  const place = new Set(
    norm(
      [hotel.city, hotel.location && hotel.location.address && hotel.location.address.locality, hotel.location && hotel.location.address && hotel.location.address.state]
        .filter(Boolean)
        .join(" ")
    ).split(" ")
  );
  // Use the original OSM name (before ", City" disambiguation).
  const base = hotel.name.split(",")[0];
  return norm(base)
    .split(" ")
    .filter((t) => t && !GENERIC.has(t) && !place.has(t) && !/^\d+$/.test(t));
}

function scoreTitle(tokens, title) {
  if (!tokens.length) return null;
  const core = tokens.join(" ");
  if (core.length < 4) return null;
  const t = norm(title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, ""));
  if (NOT_A_PHOTO.test(t)) return null;
  const titleTokens = new Set(t.split(" "));
  const phrase = ` ${t} `.includes(` ${core} `);
  const hits = tokens.filter((tok) => titleTokens.has(tok)).length;
  const hotelish = HOTELISH.test(t);
  if (phrase && (tokens.length >= 2 || (hotelish && core.length >= 5))) {
    return 10 + hits * 2 + (hotelish ? 3 : 0);
  }
  if (hits === tokens.length && tokens.length >= 2 && hotelish) return 6 + hits * 2;
  return null;
}

// ---------------------------------------------------------------------------
// Stage: wikidata
// ---------------------------------------------------------------------------

// Wikidata classes that describe a chain / company rather than one hotel.
const CHAIN_CLASSES = new Set([
  "Q1631129", // hotel chain
  "Q431289", // brand
  "Q4830453", // business
  "Q783794", // company
  "Q6881511", // enterprise
  "Q891723", // public company
  "Q167037", // corporation
  "Q2085381", // publisher (mis-tags)
  "Q18388277", // technology company
]);

async function markChainEntities(hotels, cache) {
  const missing = hotels.filter((h) => cache[h.osmId] && !cache[h.osmId].instanceOf && /^Q\d+$/.test(h.wikidata || ""));
  for (let i = 0; i < missing.length; i += 45) {
    const batch = missing.slice(i, i + 45);
    const ids = [...new Set(batch.map((h) => h.wikidata))];
    const { json } = await getJson(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${ids.join("|")}`
    );
    for (const hotel of batch) {
      const entity = (json.entities || {})[hotel.wikidata];
      const classes = ((entity && entity.claims && entity.claims.P31) || [])
        .map((c) => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id)
        .filter(Boolean);
      cache[hotel.osmId].instanceOf = classes;
    }
  }
  let dropped = 0;
  for (const result of Object.values(cache)) {
    if ((result.instanceOf || []).some((c) => CHAIN_CLASSES.has(c)) && (result.images.length || result.description)) {
      result.images = [];
      result.description = null;
      result.website = "";
      dropped += 1;
    }
  }
  if (dropped) console.log(`[wikidata] ignored ${dropped} tags that point to a hotel chain, not the hotel`);
}

async function stageWikidata(hotels) {
  const cache = loadCache("wikidata", {});
  await markChainEntities(hotels, cache);
  saveCache("wikidata", cache);
  const todo = hotels.filter((h) => /^Q\d+$/.test(h.wikidata || "") && !cache[h.osmId]);
  console.log(`[wikidata] ${todo.length} hotels to look up`);
  for (let i = 0; i < todo.length; i += 40) {
    const batch = todo.slice(i, i + 40);
    const ids = [...new Set(batch.map((h) => h.wikidata))];
    const { json } = await getJson(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims|sitelinks&ids=${ids.join("|")}`
    );
    const entities = json.entities || {};
    for (const hotel of batch) {
      const entity = entities[hotel.wikidata];
      const result = { images: [], description: null, website: "" };
      if (entity && entity.claims) {
        const claimValues = (p) =>
          ((entity.claims[p] || []).map((c) => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value).filter(Boolean));
        const files = claimValues("P18").map((f) => `File:${f}`);
        const category = claimValues("P373")[0];
        const website = claimValues("P856")[0];
        if (website) result.website = website;
        if (category) {
          const params = new URLSearchParams({
            action: "query",
            format: "json",
            formatversion: "2",
            list: "categorymembers",
            cmtitle: `Category:${category}`,
            cmtype: "file",
            cmlimit: "30",
          });
          try {
            const { json: cat } = await getJson(`${COMMONS_API}?${params}`);
            for (const m of (cat.query && cat.query.categorymembers) || []) files.push(m.title);
          } catch {
            /* ignore */
          }
        }
        const infos = await commonsImageInfo([...new Set(files)].slice(0, 30));
        for (const info of infos.values()) {
          if (usableCommonsImage(info)) result.images.push(commonsCredit(info, "property"));
        }
        result.images = result.images.slice(0, 8);
        const enTitle = entity.sitelinks && entity.sitelinks.enwiki && entity.sitelinks.enwiki.title;
        if (enTitle) {
          try {
            const { json: summary } = await getJson(
              `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(enTitle.replace(/ /g, "_"))}`
            );
            if (summary && summary.extract && summary.extract.length > 80) {
              result.description = {
                text: summary.extract,
                url: summary.content_urls && summary.content_urls.desktop && summary.content_urls.desktop.page,
              };
            }
          } catch {
            /* ignore */
          }
        }
      }
      cache[hotel.osmId] = result;
    }
    saveCache("wikidata", cache);
    process.stdout.write(`\r[wikidata] ${Math.min(i + 40, todo.length)}/${todo.length}`);
  }
  await markChainEntities(hotels, cache);
  saveCache("wikidata", cache);
  console.log(`\n[wikidata] hotels with photos: ${Object.values(cache).filter((r) => r.images.length).length}`);
}

// ---------------------------------------------------------------------------
// Stage: commons geosearch + name match
// ---------------------------------------------------------------------------

// Wikimedia rate-limits anonymous API clients hard (HTTP 429), so the search
// is serial, spaced out, and ordered so the best-known hotels go first.
const COMMONS_LIMIT = Number(process.env.COMMONS_LIMIT || 1500);
const COMMONS_DELAY_MS = Number(process.env.COMMONS_DELAY_MS || 2500);

const commonsPriority = (h) =>
  (h.starRating >= 5 ? 4 : h.starRating >= 4 ? 2 : 0) +
  (h.wikidata ? 3 : 0) +
  (h.contact && h.contact.website ? 2 : 0) +
  (/\b(taj|oberoi|leela|itc|marriott|hyatt|hilton|radisson|lalit|trident|palace|fort|haveli|resort)\b/i.test(h.name) ? 2 : 0);

async function stageCommons(hotels) {
  const cache = loadCache("commons", {});
  const todo = hotels
    .filter((h) => !(h.osmId in cache) && coreTokens(h).join(" ").length >= 4)
    .sort((a, b) => commonsPriority(b) - commonsPriority(a))
    .slice(0, COMMONS_LIMIT);
  console.log(`[commons] ${todo.length} hotels to search this run (${Object.keys(cache).length} cached)`);
  let done = 0;
  let found = 0;
  let lastSave = Date.now();
  await mapLimit(todo, 1, async (hotel) => {
    await sleep(COMMONS_DELAY_MS);
    const tokens = coreTokens(hotel);
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      maxlag: "5",
      list: "geosearch",
      gscoord: `${hotel.location.latitude}|${hotel.location.longitude}`,
      gsradius: "500",
      gsnamespace: "6",
      gslimit: "100",
    });
    try {
      const { json } = await getJson(`${COMMONS_API}?${params}`);
      const matches = [];
      for (const r of (json.query && json.query.geosearch) || []) {
        if (!/\.(jpe?g|png|webp)$/i.test(r.title)) continue;
        const score = scoreTitle(tokens, r.title);
        if (score !== null) matches.push({ title: r.title, score: score - r.dist / 250, dist: r.dist });
      }
      matches.sort((a, b) => b.score - a.score);
      cache[hotel.osmId] = matches.slice(0, 8);
      if (matches.length) found += 1;
    } catch (error) {
      // leave uncached so a re-run retries it
    }
    done += 1;
    if (Date.now() - lastSave > 15000) {
      saveCache("commons", cache);
      lastSave = Date.now();
    }
    if (done % 100 === 0) process.stdout.write(`\r[commons] ${done}/${todo.length} searched, ${found} with matches`);
  });
  saveCache("commons", cache);
  console.log(`\n[commons] searched ${done}, new hotels with matches: ${found}`);

  // Resolve image info for every matched title that is not resolved yet.
  const infoCache = loadCache("commons-info", {});
  const titles = [
    ...new Set(
      Object.values(cache)
        .flat()
        .map((m) => m.title)
        .filter((t) => !(t in infoCache))
    ),
  ];
  console.log(`[commons] resolving ${titles.length} file details`);
  for (let i = 0; i < titles.length; i += 40) {
    try {
      const infos = await commonsImageInfo(titles.slice(i, i + 40));
      for (const t of titles.slice(i, i + 40)) infoCache[t] = infos.get(t) || null;
      saveCache("commons-info", infoCache);
    } catch (error) {
      console.log(`[commons] file details paused (${error.message}); re-run to finish`);
      break;
    }
    await sleep(COMMONS_DELAY_MS);
  }
}

// ---------------------------------------------------------------------------
// Stage: official websites
// ---------------------------------------------------------------------------

const CHAIN_HOSTS =
  /(^|\.)(marriott|hilton|ihg|hyatt|tajhotels|itchotels|radissonhotels|accor|all\.accor|oyorooms|oyo|treebo|fabhotels|lemontreehotels|ginger|wyndhamhotels|bestwestern|sarovarhotels|fortunehotels|theleela|oberoihotels|clubmahindra|sterlingholidays|booking|makemytrip|goibibo|agoda|tripadvisor|airbnb|expedia|facebook|instagram|google|justdial|sulekha|yatra|cleartrip|trivago|hotels)\.(com|in|co\.in|net)$/i;

function extractImageCandidates(html, baseUrl) {
  const found = [];
  const push = (raw, weight) => {
    if (!raw) return;
    let src = String(raw).trim().replace(/&amp;/g, "&");
    if (src.startsWith("data:")) return;
    try {
      src = new URL(src, baseUrl).toString();
    } catch {
      return;
    }
    if (!/^https?:/i.test(src)) return;
    if (/\.(svg|gif|ico)(\?|$)/i.test(src)) return;
    if (/(logo|icon|sprite|favicon|avatar|placeholder|loader|spinner|badge|payment|visa|mastercard|flag|whatsapp|tripadvisor|award|certificate|qr|captcha|pixel|blank|transparent|banner-ad|social|emoji|arrow|map)/i.test(src)) return;
    found.push({ src, weight });
  };

  const meta = (prop) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "gi");
    const tags = html.match(re) || [];
    return tags
      .map((tag) => (tag.match(/content=["']([^"']+)["']/i) || [])[1])
      .filter(Boolean);
  };
  meta("og:image").forEach((u) => push(u, 10));
  meta("og:image:secure_url").forEach((u) => push(u, 10));
  meta("twitter:image").forEach((u) => push(u, 8));
  meta("twitter:image:src").forEach((u) => push(u, 8));
  (html.match(/<link[^>]+rel=["']image_src["'][^>]*>/gi) || []).forEach((tag) =>
    push((tag.match(/href=["']([^"']+)["']/i) || [])[1], 7)
  );

  // JSON-LD (Hotel / LodgingBusiness schema often lists photos).
  for (const block of html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || []) {
    const body = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    try {
      const collect = (node) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(collect);
        const img = node.image || node.photo;
        if (typeof img === "string") push(img, 9);
        else if (Array.isArray(img)) img.forEach((i) => push(typeof i === "string" ? i : i && (i.url || i.contentUrl), 9));
        else if (img && typeof img === "object") push(img.url || img.contentUrl, 9);
        Object.values(node).forEach((v) => typeof v === "object" && collect(v));
      };
      collect(JSON.parse(body));
    } catch {
      /* ignore malformed JSON-LD */
    }
  }

  // Large content images (galleries / sliders / hero banners).
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const attr = (name) => (tag.match(new RegExp(`${name}=["']([^"']+)["']`, "i")) || [])[1];
    let src = attr("data-src") || attr("data-lazy-src") || attr("data-original") || attr("src");
    const srcset = attr("data-srcset") || attr("srcset");
    if (srcset) {
      const parts = srcset.split(",").map((p) => p.trim().split(/\s+/));
      const widest = parts.sort((a, b) => (parseInt(b[1], 10) || 0) - (parseInt(a[1], 10) || 0))[0];
      if (widest && widest[0]) src = widest[0];
    }
    if (!src || !/\.(jpe?g|webp|png)(\?|$)/i.test(src)) continue;
    const width = parseInt(attr("width"), 10);
    if (Number.isFinite(width) && width < 400) continue;
    const named = /(room|suite|gallery|slider|slide|banner|hero|hotel|pool|lobby|exterior|facade|resort|view|deluxe|premium|restaurant|dining|spa|property|home)/i.test(src);
    push(src, named ? 5 : 2);
  }

  const seen = new Set();
  return found
    .sort((a, b) => b.weight - a.weight)
    .filter(({ src }) => {
      const key = src.replace(/\?.*$/, "").replace(/-\d+x\d+(?=\.\w+$)/, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
}

async function verifyImage(url) {
  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { "User-Agent": BROWSER_UA, Accept: "image/avif,image/webp,image/*,*/*;q=0.8", Range: "bytes=0-2047" } },
      12000
    );
    const type = res.headers.get("content-type") || "";
    if (!res.ok && res.status !== 206) return false;
    if (!/^image\/(jpeg|jpg|png|webp|avif)/i.test(type)) return false;
    const range = res.headers.get("content-range");
    const total = range ? Number(range.split("/")[1]) : Number(res.headers.get("content-length"));
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }
    return !Number.isFinite(total) || total === 0 || total >= 25000;
  } catch {
    return false;
  }
}

async function stageWebsites(hotels) {
  const cache = loadCache("websites", {});
  const todo = hotels.filter((h) => h.contact && h.contact.website && !(h.osmId in cache));
  console.log(`[websites] ${todo.length} hotel websites to check (${Object.keys(cache).length} cached)`);
  let done = 0;
  let withImages = 0;
  let lastSave = Date.now();
  await mapLimit(todo, 10, async (hotel) => {
    const site = hotel.contact.website;
    const result = { status: "error", images: [] };
    try {
      const parsed = new URL(site);
      const isChainRoot = CHAIN_HOSTS.test(parsed.hostname.replace(/^www\./, "")) && parsed.pathname.replace(/\/+$/, "").length < 8;
      if (/facebook|instagram|google|justdial|booking\.com|makemytrip|tripadvisor|airbnb|goibibo|agoda/i.test(parsed.hostname) || isChainRoot) {
        result.status = "skipped";
      } else {
        const res = await fetchWithTimeout(site, { headers: { "User-Agent": BROWSER_UA, Accept: "text/html,*/*" } }, 15000);
        result.status = String(res.status);
        const type = res.headers.get("content-type") || "";
        if (res.ok && /html/i.test(type)) {
          const html = (await res.text()).slice(0, 2_500_000);
          const candidates = extractImageCandidates(html, res.url || site);
          for (const c of candidates) {
            if (result.images.length >= 5) break;
            if (await verifyImage(c.src)) {
              result.images.push({
                url: c.src,
                thumb: c.src,
                kind: "property",
                source: "Hotel website",
                author: parsed.hostname.replace(/^www\./, ""),
                license: "© the property",
                licenseUrl: "",
                pageUrl: res.url || site,
                title: hotel.name,
              });
            }
          }
          result.status = result.images.length ? "ok" : "no-images";
        }
      }
    } catch (error) {
      result.status = `error:${String(error && error.name || error).slice(0, 40)}`;
    }
    cache[hotel.osmId] = result;
    if (result.images.length) withImages += 1;
    done += 1;
    if (Date.now() - lastSave > 10000) {
      saveCache("websites", cache);
      lastSave = Date.now();
    }
    if (done % 25 === 0) process.stdout.write(`\r[websites] ${done}/${todo.length} checked, ${withImages} with photos`);
  });
  saveCache("websites", cache);
  console.log(`\n[websites] checked ${done}, with photos: ${withImages}`);
}

// ---------------------------------------------------------------------------
// Stage: representative pool
// ---------------------------------------------------------------------------

const UNSPLASH_QUERIES = [
  ["hotel room", "room"], ["hotel bedroom", "room"], ["hotel suite", "suite"], ["luxury hotel room", "suite"],
  ["hotel room interior", "room"], ["boutique hotel room", "room"], ["hotel twin room", "room"], ["hotel bed", "room"],
  ["hotel bathroom", "bath"], ["hotel lobby", "lobby"], ["hotel reception", "lobby"], ["hotel restaurant", "restaurant"],
  ["hotel exterior", "exterior"], ["hotel building", "exterior"], ["hotel facade", "exterior"], ["hotel entrance", "exterior"],
  ["hotel swimming pool", "pool"], ["resort pool", "pool"], ["infinity pool resort", "pool"], ["resort", "resort"],
  ["tropical resort", "resort"], ["kerala resort", "resort"], ["kerala houseboat", "resort"], ["goa beach resort", "beach"],
  ["beach resort", "beach"], ["beach hotel", "beach"], ["india palace hotel", "heritage"], ["rajasthan haveli", "heritage"],
  ["udaipur hotel", "heritage"], ["jaipur hotel", "heritage"], ["heritage hotel india", "heritage"], ["mountain hotel", "mountain"],
  ["himalaya hotel", "mountain"], ["hill station cottage", "mountain"], ["manali hotel", "mountain"], ["mountain resort", "mountain"],
  ["hostel dorm", "hostel"], ["backpacker hostel", "hostel"], ["guest house room", "simple"], ["homestay india", "simple"],
  ["cozy bedroom", "simple"], ["budget hotel room", "simple"], ["mumbai hotel", "city"], ["city hotel room view", "city"],
  ["business hotel", "city"], ["hotel corridor", "lobby"], ["hotel balcony view", "room"], ["luxury hotel lobby", "lobby"],
  ["india hotel exterior", "exterior"], ["hotel at night", "exterior"], ["modern hotel building", "exterior"], ["boutique hotel exterior", "exterior"],
  ["villa with pool", "resort"], ["beach villa", "beach"], ["palm trees resort pool", "beach"], ["andaman beach resort", "beach"],
  ["haveli courtyard", "heritage"], ["rajasthan palace hotel", "heritage"], ["jaisalmer fort hotel", "heritage"], ["jodhpur blue city hotel", "heritage"],
  ["mountain lodge", "mountain"], ["himachal homestay", "mountain"], ["darjeeling tea estate bungalow", "mountain"], ["ladakh guest house", "mountain"],
  ["kerala homestay", "simple"], ["guest house bedroom", "simple"], ["simple hotel room", "simple"], ["traditional indian bedroom", "simple"],
  ["hotel double room", "room"], ["king size bed hotel", "room"], ["hotel room window view", "room"], ["minimal hotel room", "room"],
  ["hotel suite living room", "suite"], ["penthouse suite", "suite"], ["hotel bathtub", "bath"], ["hotel shower", "bath"],
  ["hotel breakfast buffet", "restaurant"], ["rooftop restaurant", "restaurant"], ["hotel bar lounge", "restaurant"], ["hotel lounge", "lobby"],
  ["rooftop pool city", "pool"], ["resort swimming pool", "pool"], ["hostel bunk beds", "hostel"], ["hostel common room", "hostel"],
  ["city skyline hotel view", "city"], ["delhi hotel", "city"], ["bangalore hotel", "city"], ["hyderabad hotel", "city"],
];

const OPENVERSE_QUERIES = [
  ["hotel room", "room"], ["hotel bedroom", "room"], ["hotel suite", "suite"], ["hotel lobby", "lobby"],
  ["hotel bathroom", "bath"], ["hotel restaurant", "restaurant"], ["hotel swimming pool", "pool"], ["hotel exterior", "exterior"],
  ["india hotel", "exterior"], ["hotel india room", "room"], ["resort india", "resort"], ["kerala resort", "resort"],
  ["goa resort", "beach"], ["beach resort", "beach"], ["haveli hotel", "heritage"], ["palace hotel india", "heritage"],
  ["heritage hotel rajasthan", "heritage"], ["hill station hotel", "mountain"], ["himalayan guest house", "mountain"],
  ["hostel dormitory", "hostel"], ["guest house india", "simple"], ["homestay", "simple"], ["hotel corridor", "lobby"],
  ["hotel reception", "lobby"], ["resort pool", "pool"], ["hotel building", "exterior"], ["hotel facade", "exterior"],
  ["boutique hotel", "room"], ["luxury hotel", "suite"], ["hotel interior", "room"],
];

const POOL_RELEVANT =
  /(hotel|room|suite|bed|resort|lobby|pool|villa|haveli|palace|hostel|dorm|guest|inn|lodge|interior|bath|restaurant|dining|reception|cottage|homestay|house ?boat|houseboat|balcony|beach|exterior|building|facade|corridor|stay)/i;

async function stagePool() {
  const pool = loadCache("pool", { items: [], done: {} });
  const have = new Set(pool.items.map((i) => i.id));
  const add = (item) => {
    if (have.has(item.id)) return;
    have.add(item.id);
    pool.items.push(item);
  };

  // --- Unsplash (50 requests/hour on a demo key; resumable) ---
  if (UNSPLASH_KEY) {
    let remaining = 50;
    for (const [query, category] of UNSPLASH_QUERIES) {
      for (const page of [1, 2]) {
        const key = `unsplash:${query}:${page}`;
        if (pool.done[key]) continue;
        if (remaining <= 1) break;
        try {
          const res = await fetchWithTimeout(
            `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=30&page=${page}&orientation=landscape&content_filter=high`,
            { headers: { Authorization: `Client-ID ${UNSPLASH_KEY}`, "Accept-Version": "v1" } }
          );
          remaining = Number(res.headers.get("x-ratelimit-remaining") || remaining - 1);
          if (res.status === 403 || res.status === 429) {
            remaining = 0;
            break;
          }
          if (!res.ok) continue;
          const json = await res.json();
          for (const p of json.results || []) {
            if (!p.urls || !p.urls.raw) continue;
            const raw = p.urls.raw;
            const join = raw.includes("?") ? "&" : "?";
            add({
              id: `unsplash:${p.id}`,
              category,
              url: `${raw}${join}auto=format&fit=crop&w=1600&q=80`,
              thumb: `${raw}${join}auto=format&fit=crop&w=640&q=75`,
              source: "Unsplash",
              author: (p.user && p.user.name) || "Unsplash photographer",
              authorUrl: p.user && p.user.links && `${p.user.links.html}?utm_source=staysmart&utm_medium=referral`,
              license: "Unsplash License",
              licenseUrl: "https://unsplash.com/license",
              pageUrl: p.links && `${p.links.html}?utm_source=staysmart&utm_medium=referral`,
              title: p.alt_description || p.description || query,
            });
          }
          pool.done[key] = true;
          saveCache("pool", pool);
          if ((json.total_pages || 1) <= page) break;
        } catch {
          /* try next query */
        }
      }
      if (remaining <= 1) {
        console.log("[pool] Unsplash hourly limit reached - re-run later to add more photos");
        break;
      }
    }
  }

  // --- Openverse (CC-licensed Flickr/Wikimedia photos; 20/min, 200/day anonymous) ---
  let openverseCalls = 0;
  for (const [query, category] of OPENVERSE_QUERIES) {
    for (let page = 1; page <= 6; page += 1) {
      const key = `openverse:${query}:${page}`;
      if (pool.done[key]) continue;
      if (openverseCalls >= 150) break;
      const url =
        `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page=${page}&page_size=20` +
        "&license=by,by-sa,cc0,pdm&mature=false&aspect_ratio=wide&size=large";
      try {
        openverseCalls += 1;
        const { json, res } = await getJson(url, { retries: 2 });
        const avail = Number(res.headers.get("x-ratelimit-available-anon_burst"));
        if (Number.isFinite(avail) && avail <= 1) await sleep(61000);
        if (!json || !Array.isArray(json.results)) break;
        for (const r of json.results) {
          if (!r.url || !(r.width >= 1000) || !(r.height >= 600)) continue;
          if (!POOL_RELEVANT.test(`${r.title || ""} ${(r.tags || []).map((t) => t.name).join(" ")}`)) continue;
          if (/\b(map|logo|sign|menu|people|portrait|selfie|wedding|conference|meeting)\b/i.test(r.title || "")) continue;
          let full = r.url;
          let thumb = r.url;
          if (/upload\.wikimedia\.org\/wikipedia\/commons\/(\w)\/(\w\w)\/([^/?]+\.(jpe?g|png))$/i.test(r.url)) {
            const [, a, ab, file] = r.url.match(/commons\/(\w)\/(\w\w)\/([^/?]+)$/);
            full = `https://upload.wikimedia.org/wikipedia/commons/thumb/${a}/${ab}/${file}/1280px-${file}`;
            thumb = `https://upload.wikimedia.org/wikipedia/commons/thumb/${a}/${ab}/${file}/500px-${file}`;
          } else if (/staticflickr\.com/.test(r.url)) {
            full = r.url.replace(/(_[a-z])?\.jpg$/, "_b.jpg");
            thumb = r.url.replace(/(_[a-z])?\.jpg$/, "_z.jpg");
          } else {
            continue; // only hosts that allow hotlinking reliably
          }
          add({
            id: `openverse:${r.id}`,
            category,
            url: full,
            thumb,
            source: r.source === "wikimedia" ? "Wikimedia Commons" : r.provider === "flickr" || r.source === "flickr" ? "Flickr" : r.source,
            author: r.creator || "Unknown photographer",
            authorUrl: r.creator_url || "",
            license: `CC ${String(r.license || "").toUpperCase()} ${r.license_version || ""}`.trim(),
            licenseUrl: r.license_url || "",
            pageUrl: r.foreign_landing_url || "",
            title: r.title || query,
          });
        }
        pool.done[key] = true;
        saveCache("pool", pool);
        if (page >= (json.page_count || 1)) break;
        await sleep(3200);
      } catch (error) {
        console.log(`[pool] Openverse "${query}" p${page}: ${error.message}`);
        break;
      }
    }
  }

  // --- Wikimedia Commons hotel interior categories ---
  const COMMONS_CATEGORIES = [
    ["Hotel rooms", "room"], ["Hotel rooms in India", "room"], ["Hotel swimming pools", "pool"],
    ["Hotel lobbies", "lobby"], ["Hotel bathrooms", "bath"], ["Hotel restaurants", "restaurant"],
    ["Hotel suites", "suite"], ["Hostel dormitories", "hostel"], ["Houseboats in Kerala", "resort"],
  ];
  for (const [category, kind] of COMMONS_CATEGORIES) {
    const key = `commons-cat:${category}`;
    if (pool.done[key]) continue;
    try {
      const params = new URLSearchParams({
        action: "query", format: "json", formatversion: "2", list: "categorymembers",
        cmtitle: `Category:${category}`, cmtype: "file", cmlimit: "500",
      });
      const { json } = await getJson(`${COMMONS_API}?${params}`);
      const titles = ((json.query && json.query.categorymembers) || []).map((m) => m.title).filter((t) => /\.(jpe?g|png|webp)$/i.test(t));
      const infos = await commonsImageInfo(titles);
      for (const info of infos.values()) {
        if (!usableCommonsImage(info) || info.width < 1000) continue;
        add({ id: `commons:${info.title}`, category: kind, ...commonsCredit(info, "representative") });
      }
      pool.done[key] = true;
      saveCache("pool", pool);
    } catch (error) {
      console.log(`[pool] Commons category ${category}: ${error.message}`);
    }
  }

  saveCache("pool", pool);
  const byCategory = {};
  for (const item of pool.items) byCategory[item.category] = (byCategory[item.category] || 0) + 1;
  console.log(`[pool] ${pool.items.length} representative photos:`, byCategory);
}

// ---------------------------------------------------------------------------
// Stage: assign
// ---------------------------------------------------------------------------

const HILL_STATES = new Set(["Himachal Pradesh", "Uttarakhand", "Sikkim", "Ladakh", "Jammu and Kashmir", "Arunachal Pradesh", "Meghalaya", "Nagaland", "Mizoram", "Manipur"]);
const HILL_TOWNS = /^(darjeeling|ooty|kodaikanal|munnar|mount abu|mahabaleshwar|lonavala|matheran|coorg|madikeri|shillong|gangtok|shimla|manali|mussoorie|nainital|dharamshala|mcleod ganj|leh|kasauli|dalhousie|auli|chikmagalur|wayanad|yercaud|kalimpong)$/i;

// A representative main photo should never look like a claim about the
// building itself, so it is a room/suite/pool shot rather than a facade or a
// landmark (palaces, skylines). "heritage" and "city" pool items are not used.
function primaryCategories(hotel) {
  const t = new Set(hotel.type || []);
  const city = hotel.city || "";
  const state = (hotel.location && hotel.location.address && hotel.location.address.state) || "";
  if (t.has("Hostel")) return ["hostel", "simple"];
  if (t.has("Beach Resort")) return ["beach", "pool", "resort"];
  if (t.has("Heritage")) return ["suite", "room"];
  if (HILL_STATES.has(state) || HILL_TOWNS.test(city)) return ["mountain", "room", "simple"];
  if (t.has("Resort")) return ["pool", "resort", "room"];
  if (t.has("Luxury")) return ["suite", "room", "lobby"];
  if (t.has("Guest House") || t.has("Homestay") || t.has("Lodge")) return ["simple", "room"];
  if (t.has("Business")) return ["room", "lobby", "suite"];
  return ["room", "simple", "suite"];
}

function secondaryCategories(hotel) {
  const t = new Set(hotel.type || []);
  const f = new Set(hotel.facilities || []);
  const list = ["room", "bath"];
  if (t.has("Hostel")) return ["hostel", "simple", "bath", "lobby"];
  if (t.has("Guest House") || t.has("Homestay") || t.has("Lodge")) return ["simple", "room", "bath", "restaurant"];
  list.push(t.has("Luxury") || t.has("Business") ? "lobby" : "restaurant");
  if (f.has("Swimming Pool") || t.has("Resort") || t.has("Luxury")) list.push("pool");
  else list.push("suite");
  return list;
}

async function stageAssign(db, hotels) {
  const wikidata = loadCache("wikidata", {});
  const commons = loadCache("commons", {});
  const commonsInfo = loadCache("commons-info", {});
  const websites = loadCache("websites", {});
  const rawPool = loadCache("pool", { items: [] });
  const mediaCache = loadCache("media", {});

  // 0. Pool photos that name one of our hotels ("Hotel Clarks Amer, Jaipur.jpg")
  //    are photos OF that hotel: give them to it as property photos. Photos of
  //    other named or branded properties are not used as stand-ins anywhere.
  const phraseIndex = new Map();
  for (const h of hotels) {
    const tokens = coreTokens(h);
    const phrase = tokens.join(" ");
    if (tokens.length >= 2 || (tokens.length === 1 && phrase.length >= 7)) {
      if (!phraseIndex.has(phrase)) phraseIndex.set(phrase, []);
      phraseIndex.get(phrase).push(h);
    }
  }
  const BRANDED = /\b(taj|oberoi|leela|itc|marriott|hyatt|hilton|radisson|novotel|ibis|lalit|trident|umaid|rambagh|sheraton|westin|vivanta|ginger|lemon tree|oyo|treebo|fairmont|sofitel|ritz|four seasons|lxr|accor|wyndham|ihg|holiday inn)\b/i;
  const NAMED_PROPERTY = /\b(hotels?|resorts?|palaces?|inns?|lodges?|havelis?|villas?|residency|bhawan|bhavan|niwas|nivas|mahal|fort|guest ?houses?|homestays?)\b/i;
  // Commons/Openverse titles must actually describe hotel interiors/amenities
  // (Openverse's "homestay" results included bird photos taken at a homestay).
  const INTERIOR = /\b(rooms?|suites?|beds?|bedrooms?|lobby|lobbies|reception|foyer|swimming|pools?|restaurants?|dining|bath|bathrooms?|toilet|shower|interiors?|dorms?|dormitory|hostel|bunk|houseboats?|corridor|hallway|balcony|breakfast|cottage)\b/i;
  const NOT_HOTEL = /\b(bird|birds|babbler|cuckoo|bulbul|owl|eagle|butterfly|insect|moth|spider|snake|frog|monkey|dog|cat|portrait|people|wedding|conference|meeting|newspaper|new york times|flower|plant|tree|food|dish|thali)\b/i;
  const poolMatches = new Map(); // osmId -> [credit]
  const poolItems = [];
  for (const item of rawPool.items) {
    if (item.source === "Unsplash") {
      poolItems.push(item);
      continue;
    }
    const title = norm(item.title || "");
    const words = title.split(" ");
    let matched = null;
    let namesSomeHotel = false;
    for (let i = 0; i < words.length && !matched; i += 1) {
      for (let len = 1; len <= 5 && i + len <= words.length; len += 1) {
        const owners = phraseIndex.get(words.slice(i, i + len).join(" "));
        if (!owners) continue;
        namesSomeHotel = true;
        const located = owners.filter((h) =>
          [h.city, h.location && h.location.address && h.location.address.locality, h.location && h.location.address && h.location.address.state]
            .filter(Boolean)
            .some((place) => ` ${title} `.includes(` ${norm(place)} `))
        );
        if (located.length === 1) matched = located[0];
        else if (owners.length === 1 && len >= 2) matched = owners[0];
        if (matched) break;
      }
    }
    if (matched) {
      if (!poolMatches.has(matched.osmId)) poolMatches.set(matched.osmId, []);
      const { id, category, ...rest } = item;
      poolMatches.get(matched.osmId).push({ ...rest, kind: "property", score: 40 });
      continue;
    }
    const rawTitle = item.title || "";
    if (namesSomeHotel || BRANDED.test(rawTitle) || NOT_HOTEL.test(rawTitle)) continue;
    // Outside views from Commons usually show one identifiable building, so
    // exteriors come from Unsplash only; Commons is used for interiors.
    if (["exterior", "heritage", "beach", "resort", "mountain", "city"].includes(item.category)) continue;
    if (!INTERIOR.test(rawTitle) || NAMED_PROPERTY.test(rawTitle.replace(/\bhotel (room|lobby|bathroom|restaurant|pool|suite|interior)s?\b/gi, ""))) continue;
    poolItems.push(item);
  }
  const pool = { items: poolItems };
  console.log(`[assign] pool photos naming one of our hotels: ${[...poolMatches.values()].flat().length} (given to ${poolMatches.size} hotels); usable representative photos: ${poolItems.length}/${rawPool.items.length}`);

  // 1. Property photos per hotel.
  const propertyImages = new Map();
  const urlOwners = new Map(); // url -> [{osmId, score}]
  for (const hotel of hotels) {
    const images = [...(poolMatches.get(hotel.osmId) || [])];
    const w = wikidata[hotel.osmId];
    if (w && w.images) images.push(...w.images.map((i) => ({ ...i, score: 100 })));
    for (const m of commons[hotel.osmId] || []) {
      const info = commonsInfo[m.title];
      if (usableCommonsImage(info)) images.push({ ...commonsCredit(info, "property"), score: m.score });
    }
    const site = websites[hotel.osmId];
    if (site && site.images) images.push(...site.images.map((i, idx) => ({ ...i, score: 20 - idx })));
    const seen = new Set();
    const unique = images.filter((i) => {
      const key = i.url.replace(/\?.*$/, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    for (const img of unique) {
      const key = img.url.replace(/\?.*$/, "");
      if (!urlOwners.has(key)) urlOwners.set(key, []);
      urlOwners.get(key).push({ osmId: hotel.osmId, score: img.score, source: img.source });
    }
    propertyImages.set(hotel.osmId, unique);
  }
  // A photo that matched several hotels is kept only for its best match; a
  // website image shared by several hotels is a chain banner -> dropped.
  for (const [osmId, images] of propertyImages) {
    propertyImages.set(
      osmId,
      images
        .filter((img) => {
          const owners = urlOwners.get(img.url.replace(/\?.*$/, ""));
          if (owners.length === 1) return true;
          if (img.source === "Hotel website") return false;
          const best = owners.reduce((a, b) => (b.score > a.score ? b : a));
          return best.osmId === osmId;
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 6)
        .map(({ score, ...rest }) => rest)
    );
  }

  // 2. Representative assignment with usage balancing.
  const byCategory = new Map();
  const usablePool = pool.items.filter((i) => !["heritage", "city", "exterior"].includes(i.category));
  for (const item of usablePool) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category).push({ ...item, kind: "representative" });
  }
  const allPool = usablePool.map((i) => ({ ...i, kind: "representative" }));
  const usage = new Map();
  const primaryUsage = new Map();
  const cityPrimaries = new Map();

  const pick = (categories, exclude, hotelKey, { primary = false, city = "" } = {}) => {
    const candidates = [];
    for (const c of categories) candidates.push(...(byCategory.get(c) || []));
    if (!candidates.length) candidates.push(...allPool);
    const cityUsed = cityPrimaries.get(city) || new Set();
    let best = null;
    let bestScore = Infinity;
    const offset = hash(hotelKey) % Math.max(candidates.length, 1);
    for (let i = 0; i < candidates.length; i += 1) {
      const item = candidates[(i + offset) % candidates.length];
      if (exclude.has(item.id)) continue;
      if (primary && cityUsed.has(item.id)) continue;
      const score = (primary ? (primaryUsage.get(item.id) || 0) * 10 : 0) + (usage.get(item.id) || 0);
      if (score < bestScore) {
        best = item;
        bestScore = score;
        if (score === 0) break;
      }
    }
    if (!best && primary) return pick(categories.concat(["room", "exterior", "suite"]), exclude, hotelKey, { primary: false, city });
    return best;
  };

  // Hotels with fewer property photos are assigned first so they get the
  // least-used representative photos.
  const order = [...hotels].sort(
    (a, b) => (propertyImages.get(a.osmId).length - propertyImages.get(b.osmId).length) || (hash(a.osmId) - hash(b.osmId))
  );

  const ops = [];
  const stats = { property: 0, mixed: 0, representative: 0, none: 0, google: 0 };
  for (const hotel of order) {
    let own = propertyImages.get(hotel.osmId) || [];
    // Hotels with no photos of their own but a verified Google Maps listing:
    // up to 4 live Google photos (served by /api/gphoto, never stored) plus at
    // least one representative photo as a fallback.
    let provider = own.length ? "own" : "";
    if (!own.length && hotel.googlePlaceId && hotel.googlePhotoCount > 0) {
      provider = "google";
      own = Array.from({ length: Math.min(4, hotel.googlePhotoCount) }, (_, i) => ({
        url: `/api/gphoto/${hotel._id}/${i}`,
        thumb: `/api/gphoto/${hotel._id}/${i}`,
        kind: "property",
        source: "Google Maps",
        pageUrl: `https://www.google.com/maps/place/?q=place_id:${hotel.googlePlaceId}`,
        title: hotel.name,
      }));
      stats.google += 1;
    }
    const chosen = [...own];
    const exclude = new Set();
    const city = `${hotel.city}|${hotel.location && hotel.location.address && hotel.location.address.state}`;
    if (!chosen.length && allPool.length) {
      const first = pick(primaryCategories(hotel), exclude, hotel.osmId, { primary: true, city });
      if (first) {
        chosen.push(first);
        exclude.add(first.id);
        primaryUsage.set(first.id, (primaryUsage.get(first.id) || 0) + 1);
        usage.set(first.id, (usage.get(first.id) || 0) + 1);
        if (!cityPrimaries.has(city)) cityPrimaries.set(city, new Set());
        cityPrimaries.get(city).add(first.id);
      }
    }
    for (const category of secondaryCategories(hotel)) {
      if ((chosen.length >= TARGET_IMAGES && provider !== "google") || chosen.length >= TARGET_IMAGES + 1 || !allPool.length) break;
      if (provider === "google" && chosen.length > own.length) break; // one fallback is enough
      const item = pick([category], exclude, `${hotel.osmId}:${category}`);
      if (!item) continue;
      chosen.push(item);
      exclude.add(item.id);
      usage.set(item.id, (usage.get(item.id) || 0) + 1);
    }

    // Use self-hosted copies where the media stage has already downloaded them.
    const credits = chosen.map(({ id, category, ...rest }) =>
      mediaCache[rest.url] ? { ...rest, url: mediaCache[rest.url].url, thumb: mediaCache[rest.url].card, original: rest.url } : rest
    );
    const source = own.length === 0 ? "representative" : own.length >= chosen.length ? "property" : "mixed";
    if (!chosen.length) stats.none += 1;
    else stats[source] += 1;

    const googleOnly = provider === "google";
    const set = {
      imageUrls: credits.map((c) => c.url),
      imageCredits: credits,
      imageSource: !chosen.length ? "none" : googleOnly ? "property" : source,
      photoProvider: provider || "representative",
      // Google photos cost a little per view, so hotels with their own
      // (self-hosted) photos rank first.
      photoScore: !chosen.length ? 0 : googleOnly ? 1.5 : source === "property" ? 2 : source === "mixed" ? 1 : 0,
    };
    const w = wikidata[hotel.osmId];
    if (w && w.description && w.description.text) {
      set.description = w.description.text;
      set.descriptionSource = "wikipedia";
      set.descriptionUrl = w.description.url || "";
    }
    if (w && w.website && !(hotel.contact && hotel.contact.website)) set["contact.website"] = w.website;
    ops.push({ updateOne: { filter: { _id: hotel._id }, update: { $set: set } } });
  }

  for (let i = 0; i < ops.length; i += 1000) {
    await db.collection("hotels").bulkWrite(ops.slice(i, i + 1000), { ordered: false });
  }

  // Featured = hotels that have real photos of the property and a good rating.
  await db.collection("hotels").updateMany({}, { $set: { isFeatured: false } });
  await db.collection("hotels").updateMany(
    { imageSource: { $in: ["property", "mixed"] }, photoProvider: "own", starRating: { $gte: 4 } },
    { $set: { isFeatured: true } }
  );

  const primaryCounts = [...primaryUsage.values()];
  console.log("[assign] hotels by photo source:", stats);
  console.log(
    `[assign] representative pool ${allPool.length} photos; distinct main photos ${primaryUsage.size}; max reuse of one main photo across India ${primaryCounts.length ? Math.max(...primaryCounts) : 0} (never twice in the same city)`
  );
}

// ---------------------------------------------------------------------------
// Stage: cities (real destination photos + summaries from Wikipedia)
// ---------------------------------------------------------------------------

async function wikipediaSummary(title) {
  try {
    const { json } = await getJson(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`,
      { retries: 2 }
    );
    if (!json || json.type === "disambiguation" || !json.extract) return null;
    return json;
  } catch {
    return null;
  }
}

async function stageCities(db) {
  const cache = loadCache("cities", {});
  const top = await db
    .collection("hotels")
    .aggregate([
      { $group: { _id: { city: "$city", state: "$location.address.state" }, n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 60 },
    ])
    .toArray();
  for (const { _id } of top) {
    const key = `${_id.city}|${_id.state}`;
    if (cache[key]) continue;
    let summary = null;
    for (const title of [`${_id.city}, ${_id.state}`, _id.city, `${_id.city} (${_id.state})`]) {
      summary = await wikipediaSummary(title);
      // Make sure the article is about a place in the right state.
      if (summary && (summary.extract.includes(_id.state) || summary.extract.includes("India"))) break;
      summary = null;
    }
    cache[key] = { city: _id.city, state: _id.state, found: false };
    if (summary && summary.originalimage && summary.originalimage.source) {
      const original = summary.originalimage.source;
      const m = original.match(/\/wikipedia\/(commons|en)\/(\w)\/(\w\w)\/([^/?]+)$/);
      let imageUrl = original;
      let thumb = original;
      if (m && summary.originalimage.width > 1280 && !/\.svg$/i.test(m[4])) {
        imageUrl = `https://upload.wikimedia.org/wikipedia/${m[1]}/thumb/${m[2]}/${m[3]}/${m[4]}/1280px-${m[4]}`;
        thumb = `https://upload.wikimedia.org/wikipedia/${m[1]}/thumb/${m[2]}/${m[3]}/${m[4]}/500px-${m[4]}`;
      }
      let credit = { source: "Wikipedia", pageUrl: summary.content_urls && summary.content_urls.desktop.page };
      if (m && m[1] === "commons") {
        credit = { source: "Wikimedia Commons", pageUrl: `https://commons.wikimedia.org/wiki/File:${m[4]}` };
        try {
          const info = (await commonsImageInfo([`File:${decodeURIComponent(m[4])}`])).values().next().value;
          if (info) credit = { source: "Wikimedia Commons", author: info.author, license: info.license, licenseUrl: info.licenseUrl, pageUrl: info.pageUrl };
        } catch {
          /* rate-limited: keep the file-page link as the credit */
        }
      }
      if (!/\.svg$/i.test(original)) {
        cache[key] = {
          city: _id.city,
          state: _id.state,
          found: true,
          imageUrl,
          thumb,
          credit,
          extract: summary.extract,
          wikipediaUrl: summary.content_urls && summary.content_urls.desktop.page,
        };
      }
    }
    saveCache("cities", cache);
  }
  const docs = Object.values(cache).filter((c) => c.found);
  for (const d of docs) {
    await db.collection("destinations").updateOne(
      { city: d.city, state: d.state },
      { $set: { ...d, updatedAt: new Date() } },
      { upsert: true }
    );
  }
  console.log(`[cities] destination photos: ${docs.length}/${Object.keys(cache).length}`);
}

// ---------------------------------------------------------------------------
// Stage: media (self-host Wikimedia images so the app never depends on
// Wikimedia's rate limits at runtime; licence + author stay in imageCredits)
// ---------------------------------------------------------------------------

const MEDIA_DIR = path.join(__dirname, "..", "media", "wm");
const isWikimedia = (url) => /^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(url || "");
const mediaKey = (url) => require("crypto").createHash("sha1").update(url.replace(/\?.*$/, "")).digest("hex").slice(0, 20);

async function downloadTo(url, file) {
  // Short backoff, then give up on this image for now (the next run retries it).
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "image/webp,image/jpeg,image/*" } }, 30000);
      if (res.status === 429 || res.status >= 500) {
        const wait = Math.min(Number(res.headers.get("retry-after")) || 15 * (attempt + 1), 45);
        await sleep(wait * 1000);
        continue;
      }
      if (!res.ok || !/^image\//.test(res.headers.get("content-type") || "")) return false;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 4000) return false;
      fs.writeFileSync(file, buf);
      return true;
    } catch {
      await sleep(3000 * (attempt + 1));
    }
  }
  return false;
}

async function stageMedia(db) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const cache = loadCache("media", {});
  const hotelsCol = db.collection("hotels");
  const destCol = db.collection("destinations");

  const urls = new Set();
  for await (const h of hotelsCol.find({ imageUrls: { $elemMatch: { $regex: "wikimedia\\.org" } } }, { projection: { imageUrls: 1 } })) {
    h.imageUrls.filter(isWikimedia).forEach((u) => urls.add(u));
  }
  for await (const d of destCol.find({}, { projection: { imageUrl: 1 } })) if (isWikimedia(d.imageUrl)) urls.add(d.imageUrl);
  const todo = [...urls].filter((u) => !cache[u]);
  console.log(`[media] ${urls.size} Wikimedia images in use, ${todo.length} to download`);

  // Rewrite hotels to the local copies as images arrive (not only at the end).
  let pendingRewrite = [];
  const flushRewrites = async () => {
    if (!pendingRewrite.length) return;
    const batch = pendingRewrite;
    pendingRewrite = [];
    const ops = [];
    for await (const h of hotelsCol.find({ imageUrls: { $in: batch } }, { projection: { imageUrls: 1, imageCredits: 1 } })) {
      ops.push({
        updateOne: {
          filter: { _id: h._id },
          update: {
            $set: {
              imageUrls: h.imageUrls.map((u) => (cache[u] ? cache[u].url : u)),
              imageCredits: (h.imageCredits || []).map((c) => (cache[c.url] ? { ...c, url: cache[c.url].url, thumb: cache[c.url].card, original: c.url } : c)),
            },
          },
        },
      });
    }
    if (ops.length) await hotelsCol.bulkWrite(ops, { ordered: false });
  };

  let done = 0;
  for (const url of todo) {
    const key = mediaKey(url);
    const full = path.join(MEDIA_DIR, `${key}.jpg`);
    const ok = await downloadTo(url, full);
    if (ok) pendingRewrite.push(url);
    if (ok) {
      // Every image gets a "_500" card-size copy (the frontend relies on it).
      const cardFile = path.join(MEDIA_DIR, `${key}_500.jpg`);
      let haveCard = false;
      if (/\/\d+px-/.test(url)) {
        await sleep(COMMONS_DELAY_MS / 2);
        haveCard = await downloadTo(url.replace(/\/\d+px-/, "/500px-"), cardFile);
      }
      if (!haveCard) fs.copyFileSync(full, cardFile);
      cache[url] = { url: `/media/wm/${key}.jpg`, card: `/media/wm/${key}_500.jpg` };
    }
    done += 1;
    if (done % 10 === 0) {
      saveCache("media", cache);
      await flushRewrites();
      process.stdout.write(`\r[media] ${done}/${todo.length}`);
    }
    await sleep(COMMONS_DELAY_MS / 2);
  }
  saveCache("media", cache);
  await flushRewrites();

  // Point the data at the local copies.
  const ops = [];
  for await (const h of hotelsCol.find({ imageUrls: { $elemMatch: { $regex: "wikimedia\\.org" } } }, { projection: { imageUrls: 1, imageCredits: 1 } })) {
    const imageUrls = h.imageUrls.map((u) => (cache[u] ? cache[u].url : u));
    const imageCredits = (h.imageCredits || []).map((c) => (cache[c.url] ? { ...c, url: cache[c.url].url, thumb: cache[c.url].card, original: c.url } : c));
    ops.push({ updateOne: { filter: { _id: h._id }, update: { $set: { imageUrls, imageCredits } } } });
  }
  for (let i = 0; i < ops.length; i += 1000) await hotelsCol.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
  for await (const d of destCol.find({})) {
    if (cache[d.imageUrl]) await destCol.updateOne({ _id: d._id }, { $set: { imageUrl: cache[d.imageUrl].url, thumb: cache[d.imageUrl].card, original: d.imageUrl } });
  }
  console.log(`\n[media] self-hosted ${Object.keys(cache).length} images; updated ${ops.length} hotels`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const stages = args.length ? args : ["wikidata", "commons", "websites", "pool", "cities", "assign", "media"];
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db();
  const hotels = await db
    .collection("hotels")
    .find(
      { osmId: { $exists: true } },
      { projection: { osmId: 1, name: 1, city: 1, type: 1, facilities: 1, starRating: 1, wikidata: 1, contact: 1, location: 1, googlePlaceId: 1, googlePhotoCount: 1 } }
    )
    .toArray();
  console.log(`Hotels: ${hotels.length}; stages: ${stages.join(", ")}`);

  for (const stage of stages) {
    const started = Date.now();
    if (stage === "wikidata") await stageWikidata(hotels);
    else if (stage === "commons") await stageCommons(hotels);
    else if (stage === "websites") await stageWebsites(hotels);
    else if (stage === "pool") await stagePool();
    else if (stage === "cities") await stageCities(db);
    else if (stage === "assign") await stageAssign(db, hotels);
    else if (stage === "media") await stageMedia(db);
    else console.log(`Unknown stage ${stage}`);
    console.log(`[${stage}] finished in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }
  await client.close();
}

main().catch((error) => {
  console.error("Image fetch failed:", error);
  process.exit(1);
});
