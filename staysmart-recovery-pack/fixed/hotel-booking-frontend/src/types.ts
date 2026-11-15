export type ImageCredit = {
  url: string;
  thumb?: string;
  kind: "property" | "representative";
  source: string;
  author?: string;
  authorUrl?: string;
  license?: string;
  licenseUrl?: string;
  pageUrl?: string;
  title?: string;
};

export type HotelAddress = {
  street?: string;
  locality?: string;
  city?: string;
  district?: string;
  state?: string;
  country?: string;
  zipCode?: string;
};

export type Hotel = {
  _id: string;
  userId: string;
  name: string;
  city: string;
  country: string;
  description: string;
  descriptionSource?: string;
  descriptionUrl?: string;
  type: string[];
  adultCount: number;
  childCount: number;
  facilities: string[];
  pricePerNight: number;
  priceSource?: "estimated" | "owner";
  starRating: number;
  starRatingSource?: "official" | "estimated" | "owner";
  imageUrls: string[];
  imageCredits?: ImageCredit[];
  imageSource?: "property" | "mixed" | "representative" | "none" | "pending";
  lastUpdated?: string;
  source?: string;
  sourceUrl?: string;
  brand?: string;
  operator?: string;
  rooms?: number;
  wikidata?: string;
  paymentMethods?: string[];
  location?: { latitude?: number; longitude?: number; address?: HotelAddress };
  contact?: { phone?: string; email?: string; website?: string; facebook?: string; instagram?: string };
  policies?: {
    checkInTime?: string;
    checkOutTime?: string;
    cancellationPolicy?: string;
    petPolicy?: string;
    smokingPolicy?: string;
  };
  totalBookings?: number;
  totalRevenue?: number;
  averageRating?: number;
  reviewCount?: number;
  isFeatured?: boolean;
  createdAt?: string;
  updatedAt?: string;
  distanceKm?: number;
};

export type Booking = {
  _id: string;
  userId: string;
  hotelId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  adultCount: number;
  childCount: number;
  checkIn: string;
  checkOut: string;
  totalCost: number;
  status: "pending" | "confirmed" | "cancelled" | "completed" | "refunded";
  paymentStatus: "pending" | "paid" | "failed" | "refunded";
  paymentMethod?: string;
  specialRequests?: string;
  cancellationReason?: string;
  refundAmount?: number;
  gatewayPaymentId?: string;
  createdAt: string;
  updatedAt: string;
  user?: { _id: string; firstName: string; lastName: string; email: string } | null;
};

export type HotelWithBookings = Hotel & { bookings: Booking[] };

export type User = {
  _id: string;
  id?: string;
  email: string;
  firstName: string;
  lastName: string;
  image?: string;
  role?: "user" | "admin" | "hotel_owner";
  phone?: string;
  totalBookings?: number;
  totalSpent?: number;
  createdAt?: string;
};

export type SearchResponse = {
  data: Hotel[];
  pagination: { total: number; page: number; pages: number };
};

export type LocationSuggestion = {
  type: "city" | "area" | "hotel";
  label: string;
  city: string;
  state: string;
  area?: string;
  count?: number;
  hotelId?: string;
  imageUrl?: string;
};

export type PopularDestination = {
  city: string;
  state: string;
  country: string;
  hotelsCount: number;
  minPrice: number;
  avgPrice: number;
  imageUrl: string;
  imageCredit?: { source?: string; author?: string; license?: string; pageUrl?: string } | null;
  summary?: string;
  label: string;
  latitude?: number;
  longitude?: number;
};

export type SiteStats = { hotels: number; cities: number; states: number; withPhotos: number; officialStars: number };

export type AppConfig = {
  photos?: { google: boolean };
  payments: { razorpay: boolean; payAtHotel: boolean; razorpayStatus?: string };
  auth: { google: boolean };
  uploads: { maxImages: number; maxSizeMb: number };
};

export type SearchParams = {
  destination?: string;
  checkIn?: string;
  checkOut?: string;
  adultCount?: string;
  childCount?: string;
  page?: string;
  pageSize?: string;
  facilities?: string[];
  types?: string[];
  stars?: string[];
  minPrice?: string;
  maxPrice?: string;
  sortOption?: string;
  photos?: string;
};
