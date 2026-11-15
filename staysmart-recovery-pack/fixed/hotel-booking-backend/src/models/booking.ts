import mongoose from "mongoose";

export interface IBooking {
  _id: mongoose.Types.ObjectId;
  userId: string;
  hotelId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  adultCount: number;
  childCount: number;
  checkIn: Date;
  checkOut: Date;
  totalCost: number;
  status: "pending" | "confirmed" | "cancelled" | "completed" | "refunded";
  paymentStatus: "pending" | "paid" | "failed" | "refunded";
  paymentMethod: string;
  upiTransactionId: string;
  gatewayOrderId: string;
  gatewayPaymentId: string;
  specialRequests: string;
  cancellationReason: string;
  refundAmount: number;
  createdAt: Date;
  updatedAt: Date;
}

const bookingSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    hotelId: { type: String, required: true, index: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, index: true },
    phone: { type: String },
    adultCount: { type: Number, required: true },
    childCount: { type: Number, required: true },
    checkIn: { type: Date, required: true, index: true },
    checkOut: { type: Date, required: true },
    totalCost: { type: Number, required: true },
    status: {
      type: String,
      enum: ["pending", "confirmed", "cancelled", "completed", "refunded"],
      default: "pending",
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
      index: true,
    },
    paymentMethod: { type: String },
    upiTransactionId: { type: String },
    // Gateway identifiers are retained for reconciliation without storing card data.
    gatewayOrderId: { type: String, index: true, sparse: true },
    gatewayPaymentId: { type: String },
    specialRequests: { type: String },
    cancellationReason: { type: String },
    refundAmount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

// Add compound indexes for better query performance
bookingSchema.index({ userId: 1, createdAt: -1 });
bookingSchema.index({ hotelId: 1, checkIn: 1 });
bookingSchema.index({ status: 1, createdAt: -1 });
bookingSchema.index({ paymentStatus: 1, createdAt: -1 });
bookingSchema.index({ checkIn: 1, status: 1 });
bookingSchema.index({ upiTransactionId: 1 }, { unique: true, sparse: true });
bookingSchema.index({ gatewayPaymentId: 1 }, { unique: true, sparse: true });

export default mongoose.model<IBooking>("Booking", bookingSchema);
