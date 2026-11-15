import { BookOpen, ExternalLink, Lock } from "lucide-react";
import { API_BASE_URL } from "../lib/api";

const GROUPS: { title: string; endpoints: { method: string; path: string; desc: string; auth?: boolean }[] }[] = [
  {
    title: "Hotels",
    endpoints: [
      { method: "GET", path: "/api/hotels/search", desc: "Search by destination with filters (stars, types, facilities, minPrice, maxPrice, photos) and sortOption" },
      { method: "GET", path: "/api/hotels/locations?query=", desc: "Autocomplete for cities, areas and hotel names" },
      { method: "GET", path: "/api/hotels/popular-destinations", desc: "Cities with the most hotels, with photos" },
      { method: "GET", path: "/api/hotels/featured", desc: "Top-rated hotels with real property photos" },
      { method: "GET", path: "/api/hotels/nearby?lat=&lng=&radiusKm=", desc: "Hotels near a coordinate, sorted by distance" },
      { method: "GET", path: "/api/hotels/stats", desc: "Catalogue totals" },
      { method: "GET", path: "/api/hotels/:id", desc: "Hotel details" },
      { method: "GET", path: "/api/hotels/:id/similar", desc: "Similar hotels in the same city" },
    ],
  },
  {
    title: "Bookings & payments",
    endpoints: [
      { method: "POST", path: "/api/hotels/:id/bookings/checkout-order", desc: "Create a Razorpay order (UPI / cards)", auth: true },
      { method: "POST", path: "/api/hotels/:id/bookings/verify-payment", desc: "Verify the payment signature and confirm the booking", auth: true },
      { method: "POST", path: "/api/hotels/:id/bookings/pay-at-hotel", desc: "Reserve now, pay at the property", auth: true },
      { method: "GET", path: "/api/my-bookings", desc: "Your bookings grouped by hotel", auth: true },
      { method: "PATCH", path: "/api/my-bookings/:bookingId/cancel", desc: "Cancel one of your bookings", auth: true },
    ],
  },
  {
    title: "Accounts",
    endpoints: [
      { method: "POST", path: "/api/users/register", desc: "Create an account" },
      { method: "POST", path: "/api/auth/login", desc: "Sign in with email and password" },
      { method: "GET", path: "/api/auth/validate-token", desc: "Check the current session", auth: true },
      { method: "POST", path: "/api/auth/logout", desc: "Sign out" },
      { method: "GET", path: "/api/users/me", desc: "Current user profile", auth: true },
    ],
  },
  {
    title: "Hotel owners",
    endpoints: [
      { method: "GET", path: "/api/my-hotels", desc: "Your listed hotels", auth: true },
      { method: "POST", path: "/api/my-hotels", desc: "Add a hotel (multipart form with imageFiles)", auth: true },
      { method: "PUT", path: "/api/my-hotels/:id", desc: "Update a hotel", auth: true },
      { method: "DELETE", path: "/api/my-hotels/:id", desc: "Delete a hotel without upcoming bookings", auth: true },
      { method: "GET", path: "/api/bookings/hotel/:hotelId", desc: "Bookings for one of your hotels", auth: true },
      { method: "PATCH", path: "/api/bookings/:id/status", desc: "Update a booking's status", auth: true },
    ],
  },
  {
    title: "Insights & health",
    endpoints: [
      { method: "GET", path: "/api/business-insights/dashboard/public", desc: "Bookings, revenue and inventory analytics" },
      { method: "GET", path: "/api/business-insights/forecast/public", desc: "Weekly booking trend and forecast" },
      { method: "GET", path: "/api/business-insights/system-stats/public", desc: "Measured server metrics" },
      { method: "GET", path: "/api/health", desc: "Health check" },
      { method: "GET", path: "/api/config", desc: "Which features (payments, Google sign-in) are enabled" },
    ],
  },
];

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-emerald-100 text-emerald-800",
  POST: "bg-primary-100 text-primary-800",
  PUT: "bg-amber-100 text-amber-800",
  PATCH: "bg-violet-100 text-violet-800",
  DELETE: "bg-red-100 text-red-800",
};

const ApiDocs = () => {
  const swaggerUrl = `${API_BASE_URL}/api-docs`;
  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">API documentation</h1>
          <p className="mt-1 text-slate-600">REST endpoints served by the StaySmart backend. Authenticated routes accept a Bearer token or the session cookie.</p>
        </div>
        <a href={swaggerUrl} target="_blank" rel="noreferrer" className="btn-primary">
          <BookOpen className="h-4 w-4" /> Open Swagger UI <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
      <div className="mt-6 space-y-6">
        {GROUPS.map((group) => (
          <section key={group.title} className="card p-6">
            <h2 className="text-lg font-semibold text-slate-900">{group.title}</h2>
            <ul className="mt-3 divide-y divide-slate-100">
              {group.endpoints.map((e) => (
                <li key={e.method + e.path} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <span className={`w-16 shrink-0 rounded-md px-2 py-0.5 text-center text-xs font-bold ${METHOD_COLORS[e.method]}`}>{e.method}</span>
                  <code className="shrink-0 text-sm text-slate-800">{e.path}</code>
                  <span className="flex-1 text-sm text-slate-600">{e.desc}</span>
                  {e.auth && (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <Lock className="h-3 w-3" /> sign-in required
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="text-sm text-slate-500">Rate limits: the API allows bursts of normal browsing; payment endpoints are limited to 60 requests per 15 minutes per IP.</p>
      </div>
    </div>
  );
};

export default ApiDocs;
