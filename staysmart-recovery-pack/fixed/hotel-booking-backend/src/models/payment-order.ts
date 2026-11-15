import mongoose from "mongoose";

// A short-lived server record means payment verification never trusts an order
// identifier supplied by the browser.
const paymentOrderSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true },
    hotelId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    nights: { type: Number, required: true },
    paymentId: { type: String, sparse: true },
  },
  { timestamps: true }
);

paymentOrderSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

export default mongoose.model("PaymentOrder", paymentOrderSchema);
