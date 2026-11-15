import mongoose from "mongoose";
import { HotelType } from "../../../shared/types";

const imageCreditSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    thumb: String,
    kind: { type: String, enum: ["property", "representative"], default: "property" },
    source: String,
    author: String,
    authorUrl: String,
    license: String,
    licenseUrl: String,
    pageUrl: String,
    title: String,
  },
  { _id: false }
);

const hotelSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    city: { type: String, required: true, index: true },
    country: { type: String, required: true, index: true },
    description: { type: String, required: true },
    descriptionSource: String,
    descriptionUrl: String,
    type: [{ type: String, required: true }],
    adultCount: { type: Number, required: true },
    childCount: { type: Number, required: true },
    facilities: [{ type: String }],
    pricePerNight: { type: Number, required: true, index: true },
    priceSource: { type: String, enum: ["estimated", "owner"], default: "owner" },
    starRating: { type: Number, required: true, min: 1, max: 5, index: true },
    starRatingSource: { type: String, enum: ["official", "estimated", "owner"], default: "owner" },
    imageUrls: [{ type: String }],
    imageCredits: [imageCreditSchema],
    imageSource: {
      type: String,
      enum: ["property", "mixed", "representative", "none", "pending"],
      default: "property",
    },
    photoScore: { type: Number, default: 0 },
    lastUpdated: { type: Date, required: true },

    // Provenance of imported (real-world) hotels.
    osmId: { type: String, index: true, sparse: true },
    source: String,
    sourceUrl: String,
    brand: String,
    operator: String,
    rooms: Number,
    wikidata: String,
    wikipedia: String,
    paymentMethods: [String],
    // Google Places: only the place ID may be stored (photos are fetched live).
    googlePlaceId: { type: String, index: true, sparse: true },
    googlePhotoCount: Number,
    googleMatch: String,
    googleMatchedAt: Date,

    location: {
      latitude: Number,
      longitude: Number,
      address: {
        street: String,
        locality: String,
        city: String,
        district: String,
        state: String,
        country: String,
        zipCode: String,
      },
    },
    geo: {
      type: { type: String, enum: ["Point"] },
      coordinates: { type: [Number], default: undefined },
    },

    contact: {
      phone: String,
      email: String,
      website: String,
      facebook: String,
      instagram: String,
    },

    policies: {
      checkInTime: String,
      checkOutTime: String,
      cancellationPolicy: String,
      petPolicy: String,
      smokingPolicy: String,
    },

    amenities: {
      parking: Boolean,
      wifi: Boolean,
      pool: Boolean,
      gym: Boolean,
      spa: Boolean,
      restaurant: Boolean,
      bar: Boolean,
      airportShuttle: Boolean,
      businessCenter: Boolean,
    },

    totalBookings: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    occupancyRate: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

hotelSchema.index({ city: 1, starRating: 1 });
hotelSchema.index({ pricePerNight: 1, starRating: 1 });
hotelSchema.index({ userId: 1, createdAt: -1 });
hotelSchema.index({ geo: "2dsphere" });
hotelSchema.index({ photoScore: -1, starRating: -1 });
hotelSchema.index({ imageUrls: 1 }); // image proxy allow-list lookups

const existingHotelModel = mongoose.models.Hotel as mongoose.Model<HotelType> | undefined;
const Hotel: mongoose.Model<HotelType> =
  existingHotelModel ?? mongoose.model<HotelType>("Hotel", hotelSchema);

export default Hotel;
