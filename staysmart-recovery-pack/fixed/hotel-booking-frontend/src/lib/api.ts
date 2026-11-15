import type {
  AppConfig,
  Booking,
  Hotel,
  HotelWithBookings,
  LocationSuggestion,
  PopularDestination,
  SearchParams,
  SearchResponse,
  SiteStats,
  User,
} from "../types";

/** Empty in development (Vite proxies /api); an absolute origin in production builds. */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

const TOKEN_KEY = "session_id";
const USER_KEY = "staysmart_user";

export const authStorage = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  setSession: (token: string, user?: Partial<User>) => {
    localStorage.setItem(TOKEN_KEY, token);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  getUser: (): Partial<User> | null => {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || "null");
    } catch {
      return null;
    }
  },
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    // keys used by the previous version of the app
    ["user_id", "user_email", "user_name", "user_image"].forEach((k) => localStorage.removeItem(k));
  },
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  form?: FormData;
  signal?: AbortSignal;
};

async function request<T>(path: string, { method = "GET", body, form, signal }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = authStorage.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      credentials: "include",
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
      signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new ApiError("Cannot reach the StaySmart server. Please check that the backend is running.", 0);
  }

  const text = await response.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!response.ok) {
    if (response.status === 401 && token) {
      authStorage.clear();
      window.dispatchEvent(new Event("staysmart:signed-out"));
    }
    const message =
      (data && (typeof data.message === "string" ? data.message : Array.isArray(data.message) ? data.message[0]?.msg : data.error)) ||
      `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return data as T;
}

const qs = (params: Record<string, string | string[] | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) value.filter(Boolean).forEach((v) => search.append(key, v));
    else search.append(key, value);
  }
  const s = search.toString();
  return s ? `?${s}` : "";
};

// ---------------------------------------------------------------- config / auth

export const fetchConfig = () => request<AppConfig>("/api/config");

export type AuthResponse = { token: string; userId: string; user: User };

export const register = (data: { firstName: string; lastName: string; email: string; password: string }) =>
  request<AuthResponse>("/api/users/register", { method: "POST", body: data });

export const signIn = (data: { email: string; password: string }) =>
  request<AuthResponse>("/api/auth/login", { method: "POST", body: data });

export const validateToken = () => request<{ userId: string; user: User }>("/api/auth/validate-token");

/** Always 200: `user` is null for signed-out visitors. */
export const fetchSession = () => request<{ user: User | null; userId?: string }>("/api/auth/session");

export const signOut = () => request<{ message: string }>("/api/auth/logout", { method: "POST" });

export const fetchCurrentUser = () => request<User>("/api/users/me");

export const googleSignInUrl = () => `${API_BASE_URL}/api/auth/google`;

// ---------------------------------------------------------------- hotels

export const searchHotels = (params: SearchParams, signal?: AbortSignal) =>
  request<SearchResponse>(
    `/api/hotels/search${qs({
      destination: params.destination,
      adultCount: params.adultCount,
      childCount: params.childCount,
      page: params.page,
      pageSize: params.pageSize,
      stars: params.stars,
      types: params.types,
      facilities: params.facilities,
      minPrice: params.minPrice,
      maxPrice: params.maxPrice,
      sortOption: params.sortOption,
      photos: params.photos,
    })}`,
    { signal }
  );

export const fetchLocationSuggestions = (query: string, signal?: AbortSignal) =>
  request<LocationSuggestion[]>(`/api/hotels/locations${qs({ query, limit: "6" })}`, { signal });

export const fetchPopularDestinations = (limit = 8) =>
  request<PopularDestination[]>(`/api/hotels/popular-destinations?limit=${limit}`);

export const fetchFeaturedHotels = (limit = 8) => request<Hotel[]>(`/api/hotels/featured?limit=${limit}`);

export const fetchSiteStats = () => request<SiteStats>("/api/hotels/stats");

export type GooglePhotoCredits = {
  mapsUrl?: string;
  photos: { index: number; widthPx: number; heightPx: number; authors: { name: string; uri: string }[] }[];
};
/** Live author attributions for a hotel's Google Maps photos. */
export const fetchGooglePhotoCredits = (hotelId: string) => request<GooglePhotoCredits>(`/api/gphoto/${hotelId}/credits`);

export const fetchLatestHotels = (limit = 6) => request<Hotel[]>(`/api/hotels?limit=${limit}`);

export const fetchHotelById = (id: string) => request<Hotel>(`/api/hotels/${encodeURIComponent(id)}`);

export const fetchSimilarHotels = (id: string) => request<Hotel[]>(`/api/hotels/${encodeURIComponent(id)}/similar`);

export const fetchNearbyHotels = (params: { lat: number; lng: number; radiusKm: number; types?: string[]; limit?: number }) =>
  request<{ data: Hotel[]; pagination: { total: number } }>(
    `/api/hotels/nearby${qs({
      lat: String(params.lat),
      lng: String(params.lng),
      radiusKm: String(params.radiusKm),
      limit: String(params.limit || 80),
      types: params.types,
    })}`
  );

// ---------------------------------------------------------------- booking

export type GuestDetails = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  adultCount: number;
  childCount: number;
  checkIn: string;
  checkOut: string;
  specialRequests?: string;
};

export const createCheckoutOrder = (hotelId: string, data: { numberOfNights: number; checkIn: string; checkOut: string }) =>
  request<{ orderId: string; amount: number; currency: string; keyId: string; hotelName: string }>(
    `/api/hotels/${hotelId}/bookings/checkout-order`,
    { method: "POST", body: data }
  );

export const verifyPayment = (
  hotelId: string,
  data: GuestDetails & { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }
) => request<{ booking: Booking }>(`/api/hotels/${hotelId}/bookings/verify-payment`, { method: "POST", body: data });

export const bookPayAtHotel = (hotelId: string, data: GuestDetails) =>
  request<{ booking: Booking }>(`/api/hotels/${hotelId}/bookings/pay-at-hotel`, { method: "POST", body: data });

export const fetchMyBookings = (includeCancelled = true) =>
  request<HotelWithBookings[]>(`/api/my-bookings${includeCancelled ? "?includeCancelled=true" : ""}`);

export const cancelBooking = (bookingId: string, cancellationReason: string) =>
  request<Booking>(`/api/my-bookings/${bookingId}/cancel`, { method: "PATCH", body: { cancellationReason } });

// ---------------------------------------------------------------- owner

export const fetchMyHotels = () => request<Hotel[]>("/api/my-hotels");
export const fetchMyHotelById = (id: string) => request<Hotel>(`/api/my-hotels/${id}`);
export const addMyHotel = (form: FormData) => request<Hotel>("/api/my-hotels", { method: "POST", form });
export const updateMyHotel = (id: string, form: FormData) => request<Hotel>(`/api/my-hotels/${id}`, { method: "PUT", form });
export const deleteMyHotel = (id: string) => request<{ message: string }>(`/api/my-hotels/${id}`, { method: "DELETE" });
export const fetchHotelBookings = (hotelId: string) => request<Booking[]>(`/api/bookings/hotel/${hotelId}`);
export const updateBookingStatus = (bookingId: string, status: Booking["status"]) =>
  request<Booking>(`/api/bookings/${bookingId}/status`, { method: "PATCH", body: { status } });
export const updatePaymentStatus = (bookingId: string, paymentStatus: Booking["paymentStatus"]) =>
  request<Booking>(`/api/bookings/${bookingId}/payment`, { method: "PATCH", body: { paymentStatus } });

// ---------------------------------------------------------------- insights / status

export const fetchDashboard = () => request<any>("/api/business-insights/dashboard/public");
export const fetchForecast = () => request<any>("/api/business-insights/forecast/public");
export const fetchSystemStats = () => request<any>("/api/business-insights/system-stats/public");
export const fetchHealth = () => request<any>("/api/health");
export const fetchHealthDetailed = () => request<any>("/api/health/detailed");
