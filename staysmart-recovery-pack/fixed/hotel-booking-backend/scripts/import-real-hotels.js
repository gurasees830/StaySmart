/**
 * StaySmart - import real Indian hotels into MongoDB.
 *
 * Source data (all real, all offline files in this repo):
 *   - export.geojson ............ OpenStreetMap tourism=hotel features for India
 *   - data/geonames/IN.txt ...... GeoNames gazetteer, used to work out the city,
 *                                 locality and state of every hotel from its
 *                                 coordinates (most OSM hotels have no city tag)
 *
 * What is real:   name, coordinates, street address, postcode, phone, email,
 *                 website, brand/operator, room count, official star rating
 *                 (when OSM has one), amenities that OSM records, Wikidata /
 *                 Wikipedia links, city/locality/state.
 * What is estimated (and flagged as such in the document):
 *                 nightly price (priceSource: "estimated") and the star rating
 *                 when OSM has none (starRatingSource: "estimated").
 * Nothing is invented: no fake reviews, ratings, or amenities.
 *
 * Usage:  node scripts/import-real-hotels.js
 *         (reads MONGODB_CONNECTION_STRING from .env)
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { MongoClient } = require("mongodb");

const ROOT = path.join(__dirname, "..");
const GEOJSON_PATH = path.join(ROOT, "export.geojson");
const GEONAMES_DIR = path.join(ROOT, "data", "geonames");
const MONGO_URI = process.env.MONGODB_CONNECTION_STRING;
const SYSTEM_OWNER_ID = "osm_seed_user";

if (!MONGO_URI) {
  console.error("MONGODB_CONNECTION_STRING is missing in .env");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const clean = (value) =>
  value === null || value === undefined
    ? ""
    : String(value)
        .replace(/\s+/g, " ")
        .replace(/\s+([,.;:])/g, "$1")
        .replace(/,(?=\S)/g, ", ")
        .replace(/[,\s]+$/, "")
        .trim();

const hash = (value) => {
  let h = 2166136261;
  const s = String(value);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const isLatin = (s) =>
  /^[\x20-\x7EÀ-ɏḀ-ỿ‘-‟–—´]+$/.test(s);

const toRad = (deg) => (deg * Math.PI) / 180;
const distanceKm = (lat1, lon1, lat2, lon2) => {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const smartTitle = (value) => {
  const text = clean(value);
  if (!text) return "";
  // Leave names that already use mixed case alone ("ITC Gardenia", "The O Hotel").
  if (text !== text.toUpperCase() && text !== text.toLowerCase()) return text;
  return text
    .toLowerCase()
    .replace(/(^|[\s(/-])([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase());
};

// Modern / official spellings so that search and grouping are consistent.
const CITY_RENAMES = {
  bangalore: "Bengaluru",
  bengaluru: "Bengaluru",
  bombay: "Mumbai",
  calcutta: "Kolkata",
  madras: "Chennai",
  gurgaon: "Gurugram",
  allahabad: "Prayagraj",
  mysore: "Mysuru",
  mangalore: "Mangaluru",
  trivandrum: "Thiruvananthapuram",
  cochin: "Kochi",
  ernakulam: "Kochi",
  pondicherry: "Puducherry",
  pondichery: "Puducherry",
  belgaum: "Belagavi",
  hubli: "Hubballi",
  gulbarga: "Kalaburagi",
  bellary: "Ballari",
  shimoga: "Shivamogga",
  tumkur: "Tumakuru",
  simla: "Shimla",
  baroda: "Vadodara",
  benares: "Varanasi",
  banaras: "Varanasi",
  poona: "Pune",
  cawnpore: "Kanpur",
  "new delhi": "New Delhi",
  delhi: "Delhi",
  "navi mumbai": "Navi Mumbai",
  vizag: "Visakhapatnam",
  vishakhapatnam: "Visakhapatnam",
  "port blair": "Sri Vijaya Puram",
  ooty: "Ooty",
  udhagamandalam: "Ooty",
  bardhaman: "Bardhaman",
  burdwan: "Bardhaman",
  kanayannur: "Kochi",
  "kochi (cochin)": "Kochi",
  darjiling: "Darjeeling",
  darjeeling: "Darjeeling",
  madgaon: "Margao",
  margao: "Margao",
  "panaji": "Panaji",
  panjim: "Panaji",
  "mahabaleshwar": "Mahabaleshwar",
  "dharamsala": "Dharamshala",
  "mussoorie": "Mussoorie",
  "naini tal": "Nainital",
  "nainital": "Nainital",
  "udagamandalam": "Ooty",
  "kodaikanal": "Kodaikanal",
  "rishikesh": "Rishikesh",
  "haridwar": "Haridwar",
  "hardwar": "Haridwar",
  "puri": "Puri",
  "thiruvananthapuram": "Thiruvananthapuram",
  "kozhikode": "Kozhikode",
  calicut: "Kozhikode",
  "thrissur": "Thrissur",
  trichur: "Thrissur",
  "alappuzha": "Alappuzha",
  alleppey: "Alappuzha",
  "kannur": "Kannur",
  cannanore: "Kannur",
  "tiruchirappalli": "Tiruchirappalli",
  trichy: "Tiruchirappalli",
  "vadodara": "Vadodara",
  "aurangabad": "Chhatrapati Sambhajinagar",
  "gauhati": "Guwahati",
  "jalandhar": "Jalandhar",
  jullundur: "Jalandhar",
};

const STATE_ALIASES = {
  "andaman and nicobar": "Andaman and Nicobar Islands",
  "andaman & nicobar": "Andaman and Nicobar Islands",
  "andaman & nicobar islands": "Andaman and Nicobar Islands",
  orissa: "Odisha",
  uttaranchal: "Uttarakhand",
  pondicherry: "Puducherry",
  "nct of delhi": "Delhi",
  "new delhi": "Delhi",
  "jammu & kashmir": "Jammu and Kashmir",
  "j&k": "Jammu and Kashmir",
  tn: "Tamil Nadu",
  "tamilnadu": "Tamil Nadu",
  ka: "Karnataka",
  mh: "Maharashtra",
  "maharastra": "Maharashtra",
  up: "Uttar Pradesh",
  wb: "West Bengal",
  kl: "Kerala",
  "dadra and nagar haveli": "Dadra and Nagar Haveli and Daman and Diu",
  "daman and diu": "Dadra and Nagar Haveli and Daman and Diu",
};

const normalizeCityName = (raw) => {
  const text = clean(raw).replace(/[,.;]+$/, "");
  if (!text) return "";
  const key = text.toLowerCase();
  if (CITY_RENAMES[key]) return CITY_RENAMES[key];
  return smartTitle(text);
};

// ---------------------------------------------------------------------------
// GeoNames gazetteer
// ---------------------------------------------------------------------------

const CELL = 0.1; // degrees (~11 km)
const cellKey = (lat, lon) => `${Math.floor(lat / CELL)}:${Math.floor(lon / CELL)}`;

async function loadGeoNames() {
  const admin1 = new Map();
  const admin1Text = fs.readFileSync(path.join(GEONAMES_DIR, "admin1CodesASCII.txt"), "utf8");
  for (const line of admin1Text.split(/\r?\n/)) {
    if (!line.startsWith("IN.")) continue;
    const [code, name] = line.split("\t");
    const canonical = STATE_ALIASES[name.toLowerCase()] || name;
    admin1.set(code.slice(3), canonical);
  }

  const grid = new Map();
  const excludedCodes = new Set(["PPLH", "PPLQ", "PPLW", "PPLCH", "STLMT"]);
  const stream = fs.createReadStream(path.join(GEONAMES_DIR, "IN.txt"), "utf8");
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let count = 0;
  for await (const line of rl) {
    const c = line.split("\t");
    if (c[6] !== "P" || excludedCodes.has(c[7])) continue;
    const place = {
      // asciiname: "Dwarka" rather than "Dwārka", so search and display match
      // what people type.
      name: c[2] || c[1],
      lat: Number(c[4]),
      lon: Number(c[5]),
      code: c[7],
      admin1: c[10],
      population: Number(c[14]) || 0,
    };
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon)) continue;
    const key = cellKey(place.lat, place.lon);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(place);
    count += 1;
  }
  console.log(`GeoNames: ${count} populated places, ${admin1.size} states/UTs`);
  return { grid, admin1 };
}

function placesNear(grid, lat, lon, radiusKm) {
  const latSpan = Math.ceil(radiusKm / (111 * CELL)) + 1;
  const lonSpan = Math.ceil(radiusKm / (111 * Math.cos(toRad(lat)) * CELL)) + 1;
  const baseLat = Math.floor(lat / CELL);
  const baseLon = Math.floor(lon / CELL);
  const out = [];
  for (let dy = -latSpan; dy <= latSpan; dy += 1) {
    for (let dx = -lonSpan; dx <= lonSpan; dx += 1) {
      const bucket = grid.get(`${baseLat + dy}:${baseLon + dx}`);
      if (!bucket) continue;
      for (const place of bucket) {
        const d = distanceKm(lat, lon, place.lat, place.lon);
        if (d <= radiusKm) out.push({ place, d });
      }
    }
  }
  return out;
}

const isSection = (place) => place.code === "PPLX" || place.code === "PPLL";
const importantCodes = new Set(["PPLC", "PPLA", "PPLA2", "PPLA3"]);

function locate(geo, lat, lon) {
  const near = placesNear(geo.grid, lat, lon, 45);
  if (!near.length) return null;
  near.sort((a, b) => a.d - b.d);

  // State: the admin area of the closest populated place (villages included),
  // which is precise to within a few hundred metres almost everywhere.
  const nearestAny = near[0];
  if (nearestAny.d > 30) return null; // almost certainly outside India
  const stateCode = nearestAny.place.admin1;
  const state = geo.admin1.get(stateCode) || "";

  // City: gravity model - big places pull from further away - but only places
  // inside the same state, so NCR hotels in Noida/Gurugram are not "Delhi".
  let best = null;
  for (const { place, d } of near) {
    if (place.admin1 !== stateCode || isSection(place)) continue;
    const pop = place.population;
    if (pop < 3000 && !importantCodes.has(place.code)) continue;
    const effectivePop = Math.max(pop, importantCodes.has(place.code) ? 20000 : 0);
    const reach = Math.min(40, Math.max(4, 4 + 9 * Math.log10(effectivePop / 3000)));
    if (d > reach) continue;
    const score = effectivePop / (d + 1.5) ** 2;
    if (!best || score > best.score) best = { place, d, score };
  }

  let cityPlace = best ? best.place : null;
  if (!cityPlace) {
    const village = near.find(
      ({ place, d }) => place.admin1 === stateCode && !isSection(place) && d <= 12
    );
    cityPlace = (village || nearestAny).place;
  }

  // Locality: nearest named place (suburbs included) if it is not the city itself.
  const local = near.find(({ d }) => d <= 2.5);
  let locality = "";
  if (local && local.place.name !== cityPlace.name) {
    locality = local.place.name;
  }

  let city = normalizeCityName(cityPlace.name);
  // City-states: every hotel in the NCT is listed as New Delhi (Dwarka,
  // Paharganj, Karol Bagh... become the locality), likewise Chandigarh.
  if (state === "Delhi") {
    if (city !== "New Delhi" && city !== "Delhi" && !locality) locality = city;
    city = "New Delhi";
  } else if (state === "Chandigarh") {
    if (city !== "Chandigarh" && !locality) locality = city;
    city = "Chandigarh";
  }

  return {
    city,
    state,
    locality: locality ? normalizeCityName(locality) : "",
  };
}

// ---------------------------------------------------------------------------
// Classification (types / stars / price) from real attributes
// ---------------------------------------------------------------------------

const RX = {
  luxury: /\b(taj|oberoi|leela|itc\b|jw marriott|ritz|four seasons|st\.? ?regis|grand hyatt|park hyatt|conrad|intercontinental|westin|sheraton grand|le m[eé]ridien|lalit|rambagh|umaid bhawan|raffles|fairmont|sofitel|waldorf|trident|evolve back|the postcard|six senses|anantara|taj exotica|w goa|st regis|jaypee palace|rashtrapati)\b/i,
  upscale: /\b(marriott|courtyard|radisson|novotel|hilton|doubletree|crowne plaza|hyatt|vivanta|park plaza|ramada|welcomhotel|fortune|gateway hotel|four points|aloft|renaissance|lemon tree premier|the park\b|mayfair|club mahindra|golden tulip|the pride|royal orchid|sarovar premiere|ac hotel|seleqtions|clarks|novotel|sheraton|pullman|swissotel|movenpick|m[oö]venpick|holiday inn(?! express)|country inn|wyndham|accor|taj vivanta|hometel)\b/i,
  midscale: /\b(ibis|holiday inn express|fairfield|lemon tree|ginger|keys hotel|keys\b|best western|park inn|bloom|sarovar|regenta|the fern|fern\b|zone by the park|red fox|citrus|comfort inn|quality inn|days inn|hotel grand|grand\b|residency|regency|international)\b/i,
  economy: /\b(oyo|treebo|fab ?hotels?|collection o|capital o|townhouse|spot on|zo rooms|super oyo|silverkey|flagship)\b/i,
  hostel: /\b(zostel|hostel|backpack(er|ers)?|gostops|moustache|dorms?|youth hostel|ymca|ywca|the hosteller)\b/i,
  guestHouse:
    /\b(dharam ?s?h?ala|dharmshala|dharmasala|dharamshala|yatri ?ni[wv]as|musafir ?khana|sarai|ashram|atithi|guest ?house|guesthouse|tourist bungalow|tourist home|circuit house|dak bungalow|rest house|inspection bungalow|govt\.? guest|youth home)\b/i,
  lodge: /\b(lodge|lodging|boarding)\b/i,
  homestay: /\b(home ?stay|homestay|cottages?|villas?|bungalows?|farm ?stay|bnb|b ?& ?b|bed and breakfast)\b/i,
  resort: /\b(resorts?|ressort|retreat|spa\b|camps?|jungle|wildlife|safari|tents?|farm ?house|plantation|estate|lagoon|backwaters?|houseboat|eco)\b/i,
  beach: /\b(beach|sea ?(view|side|shore|face)|coast(al)?|bay|sands|shore|surf|ocean)\b/i,
  heritage: /\b(palace|haveli|fort|mahal|heritage|kothi|garh|vilas|bhawan palace|rajmahal|castle|mansion)\b/i,
  boutique: /\b(boutique|suites?)\b/i,
  business: /\b(business|executive|corporate|towers?|plaza|centre|center|comforts?|continental|metropolitan|airport)\b/i,
  motel: /\b(motel|highway|dhaba|midway)\b/i,
};

function classify(name, tags) {
  const types = new Set();
  let estimatedStars = null;

  if (RX.hostel.test(name)) {
    types.add("Hostel");
    types.add("Budget");
    estimatedStars = 1;
  } else if (RX.guestHouse.test(name)) {
    types.add("Guest House");
    types.add("Budget");
    estimatedStars = 1;
  } else if (RX.economy.test(name)) {
    types.add("Budget");
    estimatedStars = 2;
  } else if (RX.luxury.test(name)) {
    types.add("Luxury");
    estimatedStars = 5;
  } else if (RX.upscale.test(name)) {
    types.add("Business");
    estimatedStars = 4;
  } else if (RX.midscale.test(name)) {
    types.add("Business");
    estimatedStars = 3;
  }

  if (RX.lodge.test(name)) {
    types.add("Lodge");
    types.add("Budget");
    if (estimatedStars === null) estimatedStars = 2;
  }
  if (RX.homestay.test(name)) {
    types.add("Homestay");
    types.add("Family");
    if (estimatedStars === null) estimatedStars = 3;
  }
  const isResort =
    RX.resort.test(name) || tags.leisure === "resort" || tags.leisure === "beach_resort";
  if (isResort) {
    types.add("Resort");
    types.add("Family");
    if (estimatedStars === null) estimatedStars = 3;
  }
  if ((isResort && RX.beach.test(name)) || tags.leisure === "beach_resort") {
    types.add("Beach Resort");
  }
  if (RX.heritage.test(name) && !RX.guestHouse.test(name)) {
    types.add("Heritage");
    if (estimatedStars === null) estimatedStars = /palace|fort|vilas|castle/i.test(name) ? 4 : 3;
  }
  if (RX.boutique.test(name)) types.add("Boutique");
  if (RX.business.test(name) && !isResort) types.add("Business");
  if (RX.motel.test(name)) types.add("Motel");

  // Official star rating from OSM when present.
  const rawStars = parseFloat(String(tags.stars || "").replace(/[^0-9.]/g, ""));
  let starRating;
  let starRatingSource;
  if (Number.isFinite(rawStars) && rawStars >= 1 && rawStars <= 5) {
    starRating = Math.floor(rawStars);
    starRatingSource = "official";
  } else {
    if (estimatedStars === null) {
      const rooms = parseInt(tags.rooms, 10);
      const levels = parseInt(tags["building:levels"], 10);
      const signals =
        (tags.website || tags["contact:website"] ? 1 : 0) +
        (rooms >= 30 ? 1 : 0) +
        (levels >= 4 ? 1 : 0) +
        (tags.air_conditioning === "yes" ? 1 : 0) +
        (tags.bar === "yes" || tags.swimming_pool ? 1 : 0);
      estimatedStars = signals >= 2 ? 3 : 2;
    }
    starRating = estimatedStars;
    starRatingSource = "estimated";
  }

  if (starRating >= 5) types.add("Luxury");
  if (starRating <= 2) types.add("Budget");
  if (types.size === 0) types.add("Hotel");
  return { types: Array.from(types), starRating, starRatingSource };
}

// Market-rate estimates (INR / night) by star category, adjusted for city and
// property type. These are clearly flagged as estimates in the data.
const BASE_PRICE = { 1: 950, 2: 1650, 3: 3000, 4: 5600, 5: 11500 };
const CITY_FACTOR = {
  Mumbai: 1.45, "Navi Mumbai": 1.15, Delhi: 1.35, "New Delhi": 1.35, Gurugram: 1.3,
  Noida: 1.15, Bengaluru: 1.3, Hyderabad: 1.15, Chennai: 1.15, Kolkata: 1.1, Pune: 1.15,
  Ahmedabad: 1.05, Jaipur: 1.1, Udaipur: 1.3, Jodhpur: 1.1, Jaisalmer: 1.05, Agra: 1.05,
  Shimla: 1.15, Manali: 1.15, Mussoorie: 1.15, Nainital: 1.1, Darjeeling: 1.1, Ooty: 1.1,
  Munnar: 1.15, Kochi: 1.1, Rishikesh: 1.05, Varanasi: 1.0, Amritsar: 1.0, Leh: 1.15,
  Gangtok: 1.05, Srinagar: 1.1, Mysuru: 1.0, Chandigarh: 1.1,
};
const STATE_FACTOR = { Goa: 1.3, "Andaman and Nicobar Islands": 1.25, Lakshadweep: 1.3, Kerala: 1.08 };
const TYPE_FACTOR = {
  Hostel: 0.42, "Guest House": 0.7, Lodge: 0.72, Homestay: 0.85, Resort: 1.3,
  "Beach Resort": 1.1, Heritage: 1.35, Boutique: 1.15,
};

function estimatePrice(seed, starRating, types, city, state) {
  let price = BASE_PRICE[starRating] || BASE_PRICE[3];
  price *= CITY_FACTOR[city] || STATE_FACTOR[state] || 1;
  for (const t of types) price *= TYPE_FACTOR[t] || 1;
  const jitter = 0.86 + (hash(seed) % 2900) / 10000; // 0.86 - 1.15
  price *= jitter;
  return Math.max(399, Math.round(price / 50) * 50 - 1);
}

// ---------------------------------------------------------------------------
// Facilities / contact / address from OSM tags (only what OSM records)
// ---------------------------------------------------------------------------

const yes = (v) => /^(yes|true|1|free|wlan|wifi|outdoor|indoor|customers|designated)$/i.test(clean(v));

function facilitiesFrom(tags) {
  const f = new Set();
  const internet = clean(tags.internet_access).toLowerCase();
  if (["wlan", "yes", "wifi", "terminal"].includes(internet)) {
    const fee = clean(tags["internet_access:fee"]).toLowerCase();
    f.add(fee === "yes" ? "WiFi (paid)" : "Free WiFi");
  }
  if (tags.air_conditioning === "yes") f.add("Air Conditioning");
  if (tags.swimming_pool && tags.swimming_pool !== "no") f.add("Swimming Pool");
  if (tags.bar === "yes" || tags.amenity === "bar") f.add("Bar");
  if (tags.restaurant === "yes" || tags.amenity === "restaurant" || tags.cuisine) f.add("Restaurant");
  if (tags.parking && tags.parking !== "no") f.add("Parking");
  if (tags.wheelchair === "yes" || tags.wheelchair === "designated") f.add("Wheelchair Accessible");
  if (["no", "outside", "separated", "isolated"].includes(tags.smoking)) f.add("Non-Smoking Rooms");
  if (tags.breakfast && tags.breakfast !== "no") f.add("Breakfast");
  if (yes(tags.dog) || yes(tags.pets) || yes(tags["pets:allowed"])) f.add("Pet Friendly");
  if (tags.leisure === "spa" || yes(tags.spa) || tags.sauna === "yes") f.add("Spa");
  if (yes(tags.gym) || yes(tags.fitness_centre) || tags.leisure === "fitness_centre") f.add("Fitness Center");
  if (/24\/7/.test(clean(tags.opening_hours))) f.add("24-Hour Front Desk");
  if (yes(tags.airport_shuttle) || yes(tags["shuttle:airport"])) f.add("Airport Shuttle");
  return Array.from(f);
}

function paymentMethodsFrom(tags) {
  const methods = [];
  const map = {
    "payment:cash": "Cash",
    "payment:upi": "UPI",
    "payment:credit_cards": "Credit cards",
    "payment:debit_cards": "Debit cards",
    "payment:visa": "Visa",
    "payment:mastercard": "Mastercard",
    "payment:american_express": "American Express",
    "payment:rupay": "RuPay",
  };
  for (const [key, label] of Object.entries(map)) {
    if (tags[key] === "yes") methods.push(label);
  }
  return methods;
}

const normalizePhone = (raw) => {
  const first = clean(raw).split(/[;,/]| or /i)[0].trim();
  if (!first) return "";
  const digits = first.replace(/[^\d+]/g, "");
  if (/^\+91\d{10}$/.test(digits)) return `+91 ${digits.slice(3, 8)} ${digits.slice(8)}`;
  if (/^91\d{10}$/.test(digits)) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  if (/^0?[6-9]\d{9}$/.test(digits)) {
    const d = digits.replace(/^0/, "");
    return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  }
  return first.length <= 24 ? first : "";
};

const normalizeWebsite = (raw) => {
  let url = clean(raw).split(/[;\s]/)[0];
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url.replace(/^\/\//, "")}`;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes(".")) return "";
    return parsed.toString();
  } catch {
    return "";
  }
};

const normalizeEmail = (raw) => {
  const email = clean(raw).split(/[;,\s]/)[0].toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email) ? email : "";
};

function osmUrl(id) {
  const [kind, num] = String(id).split("/");
  return kind && num ? `https://www.openstreetmap.org/${kind}/${num}` : "";
}

const LIST = (items) =>
  items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

function describe(hotel, tags) {
  const osmDescription = clean(tags.description);
  if (osmDescription.length >= 40 && isLatin(osmDescription)) return osmDescription;

  const where = [hotel.location.address.locality, hotel.city, hotel.location.address.state]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(", ");
  const kind = hotel.type.includes("Hostel")
    ? "hostel"
    : hotel.type.includes("Guest House")
      ? "guest house"
      : hotel.type.includes("Homestay")
        ? "homestay"
        : hotel.type.includes("Beach Resort")
          ? "beach resort"
          : hotel.type.includes("Resort")
            ? "resort"
            : hotel.type.includes("Heritage")
              ? "heritage hotel"
              : hotel.type.includes("Luxury")
                ? "luxury hotel"
                : hotel.type.includes("Boutique")
                  ? "boutique hotel"
                  : hotel.type.includes("Business")
                    ? "business hotel"
                    : hotel.type.includes("Budget")
                      ? "budget hotel"
                      : "hotel";
  const starText =
    hotel.starRatingSource === "official" ? `${hotel.starRating}-star ${kind}` : kind;
  const street = hotel.location.address.street;
  let text = `${hotel.name} is a ${starText}${street ? ` on ${street}` : ""} in ${where}.`;
  if (hotel.brand && !hotel.name.toLowerCase().includes(hotel.brand.toLowerCase())) {
    text += ` It is part of the ${hotel.brand} group.`;
  }
  if (hotel.rooms) text += ` The property has ${hotel.rooms} rooms.`;
  const facilityWords = hotel.facilities
    .filter((f) => f !== "24-Hour Front Desk")
    .map((f) => (f === "Free WiFi" ? "free Wi-Fi" : f.toLowerCase()));
  if (facilityWords.length) {
    text += ` Facilities recorded for this property include ${LIST(facilityWords)}.`;
  }
  if (hotel.contact.website) {
    text += " Room types and current tariffs are listed on the hotel's official website.";
  }
  return text;
}

// ---------------------------------------------------------------------------
// Feature -> hotel document
// ---------------------------------------------------------------------------

const GENERIC_NAME =
  /^(the )?(hotel|lodge|guest ?house|resort|inn|dharam?s?h?ala|hostel|oyo|motel|rooms?|stay|homestay|home stay|tourist (lodge|home)|rest house)s?$/i;

function pickName(tags) {
  const candidates = [tags.name, tags["name:en"], tags.official_name, tags.alt_name]
    .map(clean)
    .filter(Boolean);
  const latin = candidates.find((n) => isLatin(n));
  if (!latin) return "";
  const name = smartTitle(latin.replace(/´/g, "'"));
  if (GENERIC_NAME.test(name) || name.length < 3) return "";
  return name;
}

function mapFeature(feature, geo, nameCounts) {
  const tags = feature.properties || {};
  const [lon, lat] = (feature.geometry && feature.geometry.coordinates) || [];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const osmId = clean(feature.id || tags["@id"]);
  if (!osmId) return null;

  let name = pickName(tags);
  if (!name) return null;

  const place = locate(geo, lat, lon);
  if (!place) return null;

  // The gazetteer city is used for every hotel so that a city is never split
  // into fragments ("Andheri East", "Bardez", "North Goa"...). A tagged
  // addr:city that differs from it is kept as the locality instead.
  const city = place.city;
  const taggedCity = clean(tags["addr:city"]);
  if (
    !place.locality &&
    taggedCity &&
    taggedCity.length <= 30 &&
    !/\d/.test(taggedCity) &&
    isLatin(taggedCity) &&
    normalizeCityName(taggedCity).toLowerCase() !== city.toLowerCase() &&
    !/goa|district|taluk|tehsil|road|flyover|circle|cross|main|street|near|opp|marg|nagar\s*\d/i.test(taggedCity)
  ) {
    place.locality = normalizeCityName(taggedCity);
  }
  const taggedState = STATE_ALIASES[clean(tags["addr:state"]).toLowerCase()];
  const state = place.state || taggedState || "";

  // Disambiguate chain names that appear many times ("Novotel", "Westin").
  const lowerName = name.toLowerCase();
  if ((nameCounts.get(lowerName) || 0) >= 3 && !lowerName.includes(city.toLowerCase())) {
    name = `${name}, ${place.locality && place.locality !== city ? `${place.locality}, ` : ""}${city}`;
  }

  const { types, starRating, starRatingSource } = classify(name, tags);
  const facilities = facilitiesFrom(tags);
  const houseNumber = clean(tags["addr:housenumber"]);
  const streetName = clean(tags["addr:street"]);
  const street = smartTitle([houseNumber, streetName].filter(Boolean).join(", "));
  const postcode = clean(tags["addr:postcode"]).replace(/\s/g, "");
  const brand = clean(tags.brand) && name.toLowerCase().includes(clean(tags.brand).toLowerCase().split(" ")[0])
    ? clean(tags.brand)
    : "";
  const rooms = parseInt(tags.rooms, 10);
  const pricePerNight = estimatePrice(osmId, starRating, types, city, state);

  const amenities = {
    parking: facilities.includes("Parking"),
    wifi: facilities.includes("Free WiFi") || facilities.includes("WiFi (paid)"),
    pool: facilities.includes("Swimming Pool"),
    gym: facilities.includes("Fitness Center"),
    spa: facilities.includes("Spa"),
    restaurant: facilities.includes("Restaurant"),
    bar: facilities.includes("Bar"),
    airportShuttle: facilities.includes("Airport Shuttle"),
    businessCenter: false,
  };

  const isFamily = types.includes("Resort") || types.includes("Homestay") || types.includes("Family");
  const now = new Date();
  const checkDate = Date.parse(tags.check_date || tags["survey:date"] || "");

  const hotel = {
    osmId,
    source: "OpenStreetMap",
    sourceUrl: osmUrl(osmId),
    userId: SYSTEM_OWNER_ID,
    name,
    city,
    country: "India",
    description: "",
    type: types,
    adultCount: types.includes("Hostel") ? 2 : isFamily ? 3 : 2,
    childCount: types.includes("Hostel") ? 0 : isFamily ? 2 : 1,
    facilities,
    pricePerNight,
    priceSource: "estimated",
    starRating,
    starRatingSource,
    imageUrls: [],
    imageCredits: [],
    imageSource: "pending",
    lastUpdated: Number.isFinite(checkDate) ? new Date(checkDate) : now,
    brand,
    operator: clean(tags.operator),
    rooms: Number.isFinite(rooms) && rooms > 0 && rooms < 5000 ? rooms : undefined,
    wikidata: clean(tags.wikidata),
    wikipedia: clean(tags.wikipedia),
    paymentMethods: paymentMethodsFrom(tags),
    location: {
      latitude: lat,
      longitude: lon,
      address: {
        street,
        locality: place.locality || smartTitle(clean(tags["addr:suburb"])),
        city,
        district: smartTitle(clean(tags["addr:district"])),
        state,
        country: "India",
        zipCode: /^\d{6}$/.test(postcode) ? postcode : "",
      },
    },
    geo: { type: "Point", coordinates: [lon, lat] },
    contact: {
      phone: normalizePhone(tags.phone || tags["contact:phone"] || tags.mobile || tags["contact:mobile"]),
      email: normalizeEmail(tags.email || tags["contact:email"]),
      website: normalizeWebsite(tags.website || tags["contact:website"] || tags.url),
      facebook: normalizeWebsite(tags["contact:facebook"]),
      instagram: normalizeWebsite(tags["contact:instagram"]),
    },
    policies: {
      checkInTime: clean(tags.check_in || tags.checkin),
      checkOutTime: clean(tags.check_out || tags.checkout),
      cancellationPolicy: "",
      petPolicy: facilities.includes("Pet Friendly") ? "Pets allowed" : "",
      smokingPolicy:
        tags.smoking === "no"
          ? "Non-smoking property"
          : ["outside", "separated", "isolated"].includes(tags.smoking)
            ? "Smoking only in designated areas"
            : "",
    },
    amenities,
    totalBookings: 0,
    totalRevenue: 0,
    averageRating: 0,
    reviewCount: 0,
    occupancyRate: 0,
    isActive: true,
    isFeatured: false,
    updatedAt: now,
  };
  hotel.description = describe(hotel, tags);
  return hotel;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const started = Date.now();
  const geo = await loadGeoNames();
  const geojson = JSON.parse(fs.readFileSync(GEOJSON_PATH, "utf8"));
  const features = geojson.features || [];
  console.log(`OSM hotel features: ${features.length}`);

  const nameCounts = new Map();
  for (const f of features) {
    const n = pickName(f.properties || {});
    if (n) nameCounts.set(n.toLowerCase(), (nameCounts.get(n.toLowerCase()) || 0) + 1);
  }

  const docs = [];
  const seen = new Set();
  let skipped = 0;
  for (const feature of features) {
    const doc = mapFeature(feature, geo, nameCounts);
    if (!doc) {
      skipped += 1;
      continue;
    }
    // Drop exact duplicates (same name within ~60 m - node + way of one hotel).
    const dupKey = `${doc.name.toLowerCase()}|${doc.location.latitude.toFixed(3)}|${doc.location.longitude.toFixed(3)}`;
    if (seen.has(dupKey)) {
      skipped += 1;
      continue;
    }
    seen.add(dupKey);
    docs.push(doc);
  }
  console.log(`Prepared ${docs.length} hotels (skipped ${skipped} unnamed/duplicate/outside India)`);

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const hotels = client.db().collection("hotels");
  await hotels.createIndex({ osmId: 1 }, { unique: true, sparse: true });

  // Keep any image work already done for a hotel when re-importing.
  const existing = new Map();
  for await (const h of hotels.find(
    { osmId: { $exists: true } },
    { projection: { osmId: 1, imageUrls: 1, imageCredits: 1, imageSource: 1, description: 1, descriptionSource: 1 } }
  )) {
    existing.set(h.osmId, h);
  }

  const ops = docs.map((doc) => {
    const prev = existing.get(doc.osmId);
    const set = { ...doc };
    if (prev && Array.isArray(prev.imageUrls) && prev.imageUrls.length && prev.imageSource && prev.imageSource !== "pending") {
      delete set.imageUrls;
      delete set.imageCredits;
      delete set.imageSource;
    }
    if (prev && prev.descriptionSource === "wikipedia") delete set.description;
    return {
      updateOne: {
        filter: { osmId: doc.osmId },
        update: { $set: set, $setOnInsert: { createdAt: new Date() } },
        upsert: true,
      },
    };
  });

  for (let i = 0; i < ops.length; i += 1000) {
    await hotels.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    process.stdout.write(`\rWritten ${Math.min(i + 1000, ops.length)}/${ops.length}`);
  }
  console.log("");

  // Remove OSM hotels that no longer pass the quality filter (e.g. unnamed).
  const keep = new Set(docs.map((d) => d.osmId));
  const stale = await hotels
    .find({ osmId: { $exists: true } }, { projection: { osmId: 1 } })
    .toArray();
  const staleIds = stale.filter((h) => !keep.has(h.osmId)).map((h) => h._id);
  if (staleIds.length) {
    await hotels.deleteMany({ _id: { $in: staleIds } });
    console.log(`Removed ${staleIds.length} stale hotels`);
  }

  await hotels.createIndex({ geo: "2dsphere" });
  await hotels.createIndex({ city: 1, starRating: 1 });
  await hotels.createIndex({ pricePerNight: 1, starRating: 1 });
  await hotels.createIndex({ "location.address.state": 1 });
  await hotels.createIndex({ isFeatured: -1, starRating: -1 });

  const total = await hotels.countDocuments();
  const byCity = await hotels
    .aggregate([{ $group: { _id: "$city", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 25 }])
    .toArray();
  const byState = await hotels
    .aggregate([{ $group: { _id: "$location.address.state", n: { $sum: 1 } } }, { $sort: { n: -1 } }])
    .toArray();
  console.log(`Total hotels in DB: ${total}`);
  console.log("Top cities:", byCity.map((c) => `${c._id} (${c.n})`).join(", "));
  console.log("States:", byState.map((c) => `${c._id || "?"} (${c.n})`).join(", "));
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  await client.close();
}

main().catch((error) => {
  console.error("Import failed:", error);
  process.exit(1);
});
