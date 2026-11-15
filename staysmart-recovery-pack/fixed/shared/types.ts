// Types shared by the backend (models/routes). The frontend keeps its own copy
// in hotel-booking-frontend/src/types.ts so it can be built on its own.

export type UserRole = "user" | "admin" | "hotel_owner";

export type UserType = {
  _id: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  image?: string;
  role?: UserRole;
  phone?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    country?: string;
    zipCode?: string;
  };
  preferences?: {
    preferredDestinations?: string[];
    preferredHotelTypes?: string[];
    budgetRange?: { min?: number; max?: number };
  };
  totalBookings?: number;
  totalSpent?: number;
  lastLogin?: Date;
  isActive?: boolean;
  emailVerified?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

export type ImageCredit = {
  url: string;
  thumb?: string;
  /** "property" = a photo of this hotel; "representative" = a real photo of a similar hotel */
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

export type HotelType = {
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
  photoScore?: number;
  lastUpdated: Date;
  osmId?: string;
  source?: string;
  sourceUrl?: string;
  brand?: string;
  operator?: string;
  rooms?: number;
  wikidata?: string;
  wikipedia?: string;
  paymentMethods?: string[];
  location?: {
    latitude?: number;
    longitude?: number;
    address?: HotelAddress;
  };
  geo?: { type: "Point"; coordinates: [number, number] };
  contact?: {
    phone?: string;
    email?: string;
    website?: string;
    facebook?: string;
    instagram?: string;
  };
  policies?: {
    checkInTime?: string;
    checkOutTime?: string;
    cancellationPolicy?: string;
    petPolicy?: string;
    smokingPolicy?: string;
  };
  amenities?: {
    parking?: boolean;
    wifi?: boolean;
    pool?: boolean;
    gym?: boolean;
    spa?: boolean;
    restaurant?: boolean;
    bar?: boolean;
    airportShuttle?: boolean;
    businessCenter?: boolean;
  };
  totalBookings?: number;
  totalRevenue?: number;
  averageRating?: number;
  reviewCount?: number;
  occupancyRate?: number;
  isActive?: boolean;
  isFeatured?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

export type BookingType = {
  _id: string;
  userId: string;
  hotelId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  adultCount: number;
  childCount: number;
  checkIn: Date;
  checkOut: Date;
  totalCost: number;
  status: "pending" | "confirmed" | "cancelled" | "completed" | "refunded";
  paymentStatus: "pending" | "paid" | "failed" | "refunded";
  paymentMethod?: string;
  specialRequests?: string;
  cancellationReason?: string;
  refundAmount?: number;
  createdAt: Date;
  updatedAt: Date;
};

export type HotelSearchResponse = {
  data: HotelType[];
  pagination: {
    total: number;
    page: number;
    pages: number;
  };
};

export type HotelWithBookingsType = HotelType & {
  bookings: BookingType[];
};
