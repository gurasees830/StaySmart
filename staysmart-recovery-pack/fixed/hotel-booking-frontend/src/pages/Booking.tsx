import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "react-query";
import { useForm } from "react-hook-form";
import DatePicker from "react-datepicker";
import { BadgeCheck, Building2, CalendarDays, CheckCircle2, CreditCard, Loader2, Lock, MapPin, Smartphone, Wallet } from "lucide-react";
import HotelImage from "../components/HotelImage";
import StarRating from "../components/StarRating";
import { ErrorState, PageSpinner } from "../components/Spinner";
import { useAppContext } from "../contexts/AppContext";
import { useSearchContext } from "../contexts/SearchContext";
import { bookPayAtHotel, createCheckoutOrder, fetchHotelById, GuestDetails, verifyPayment } from "../lib/api";
import { addDays, cn, errorMessage, formatDate, formatINR, nightsBetween, plural, shortPlace, startOfToday, toDateKey } from "../lib/utils";
import type { Booking as BookingType } from "../types";

type FormValues = { firstName: string; lastName: string; email: string; phone: string; specialRequests: string };

const loadRazorpay = () =>
  new Promise<boolean>((resolve) => {
    if (window.Razorpay) return resolve(true);
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
    const script = existing || document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    if (!existing) document.body.appendChild(script);
  });

const Booking = () => {
  const { hotelId = "" } = useParams();
  const { user, config, showToast } = useAppContext();
  const search = useSearchContext();
  const queryClient = useQueryClient();
  const { data: hotel, isLoading, isError, error } = useQuery(["hotel", hotelId], () => fetchHotelById(hotelId));
  const [checkIn, setCheckIn] = useState(search.checkIn);
  const [checkOut, setCheckOut] = useState(search.checkOut);
  const [adults, setAdults] = useState(search.adultCount);
  const [children, setChildren] = useState(search.childCount);
  const [method, setMethod] = useState<"online" | "hotel">(config?.payments.razorpay === false ? "hotel" : "online");
  const [processing, setProcessing] = useState(false);
  const [confirmed, setConfirmed] = useState<BookingType | null>(null);

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    defaultValues: { firstName: user?.firstName || "", lastName: user?.lastName || "", email: user?.email || "", phone: "", specialRequests: "" },
  });

  // Config arrives after first render; fall back to pay-at-hotel if the
  // payment gateway is unavailable.
  useEffect(() => {
    if (config && !config.payments.razorpay) setMethod("hotel");
  }, [config]);

  if (isLoading) return <PageSpinner label="Preparing your booking..." />;
  if (isError || !hotel) return <div className="container-page py-16"><ErrorState message={errorMessage(error, "Could not load this hotel")} /></div>;

  const nights = nightsBetween(checkIn, checkOut);
  const total = nights * hotel.pricePerNight;
  const onlineAvailable = config?.payments.razorpay !== false;

  const finish = (booking: BookingType) => {
    setConfirmed(booking);
    search.saveSearch({ checkIn, checkOut, adultCount: adults, childCount: children });
    queryClient.invalidateQueries("my-bookings");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const onSubmit = async (values: FormValues) => {
    if (nights < 1) {
      showToast({ title: "Check your dates", description: "Check-out must be after check-in.", type: "error" });
      return;
    }
    const guest: GuestDetails = {
      ...values,
      phone: values.phone.trim(),
      adultCount: adults,
      childCount: children,
      checkIn: toDateKey(checkIn),
      checkOut: toDateKey(checkOut),
    };
    setProcessing(true);
    try {
      if (method === "hotel" || !onlineAvailable) {
        const { booking } = await bookPayAtHotel(hotel._id, guest);
        showToast({ title: "Booking confirmed", description: `Pay ${formatINR(booking.totalCost)} at ${hotel.name} on arrival.` });
        finish(booking);
        setProcessing(false);
        return;
      }

      const loaded = await loadRazorpay();
      if (!loaded || !window.Razorpay) throw new Error("Could not load the secure payment checkout. Check your internet connection or choose “Pay at hotel”.");
      const order = await createCheckoutOrder(hotel._id, { numberOfNights: nights, checkIn: guest.checkIn, checkOut: guest.checkOut });

      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: "StaySmart",
        description: `${hotel.name} · ${plural(nights, "night")}`,
        prefill: { name: `${values.firstName} ${values.lastName}`, email: values.email, contact: values.phone },
        notes: { hotel: hotel.name },
        theme: { color: "#2563eb" },
        handler: async (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            const { booking } = await verifyPayment(hotel._id, { ...guest, ...response });
            showToast({ title: "Payment successful", description: "Your stay is confirmed." });
            finish(booking);
          } catch (e) {
            showToast({ title: "Payment needs attention", description: errorMessage(e), type: "error" });
          } finally {
            setProcessing(false);
          }
        },
        modal: { ondismiss: () => setProcessing(false) },
      });
      rzp.on("payment.failed", (response: any) => {
        setProcessing(false);
        showToast({ title: "Payment failed", description: response?.error?.description || "Please try again or choose another method.", type: "error" });
      });
      rzp.open();
    } catch (e) {
      setProcessing(false);
      showToast({ title: "Could not complete booking", description: errorMessage(e), type: "error" });
    }
  };

  if (confirmed) {
    return (
      <div className="container-page max-w-2xl py-12">
        <div className="card overflow-hidden text-center animate-scale-in">
          <div className="bg-gradient-to-br from-emerald-500 to-teal-500 px-6 py-10 text-white">
            <CheckCircle2 className="mx-auto h-16 w-16" />
            <h1 className="mt-4 text-3xl font-bold">Booking confirmed!</h1>
            <p className="mt-2 text-emerald-50">Booking reference {confirmed._id.slice(-8).toUpperCase()}</p>
          </div>
          <div className="space-y-3 p-6 text-left">
            <p className="text-lg font-semibold text-slate-900">{hotel.name}</p>
            <p className="flex items-center gap-1.5 text-sm text-slate-600"><MapPin className="h-4 w-4" /> {shortPlace(hotel)}</p>
            <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-sm">
              <div><p className="text-slate-500">Check-in</p><p className="font-semibold">{formatDate(confirmed.checkIn, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</p></div>
              <div><p className="text-slate-500">Check-out</p><p className="font-semibold">{formatDate(confirmed.checkOut, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</p></div>
              <div><p className="text-slate-500">Guests</p><p className="font-semibold">{plural(confirmed.adultCount, "adult")}{confirmed.childCount ? `, ${plural(confirmed.childCount, "child", "children")}` : ""}</p></div>
              <div><p className="text-slate-500">{confirmed.paymentStatus === "paid" ? "Paid" : "Pay at hotel"}</p><p className="font-semibold">{formatINR(confirmed.totalCost)}</p></div>
            </div>
            <p className="text-sm text-slate-600">A summary has been saved to My Bookings. {hotel.contact?.phone ? `For special requests call the hotel on ${hotel.contact.phone}.` : ""}</p>
            <div className="flex flex-col gap-2 pt-2 sm:flex-row">
              <Link to="/my-bookings" className="btn-primary flex-1">View my bookings</Link>
              <Link to={`/detail/${hotel._id}`} className="btn-secondary flex-1">Back to hotel</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container-page py-8">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Complete your booking</h1>
      <p className="mt-1 text-slate-600">Review your stay and enter the lead guest's details.</p>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <section className="card p-6">
            <h2 className="text-lg font-semibold">Your stay</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <label className="sm:col-span-1">
                <span className="label flex items-center gap-1"><CalendarDays className="h-4 w-4" /> Check-in</span>
                <DatePicker selected={checkIn} onChange={(d: Date | null) => { if (!d) return; setCheckIn(d); if (checkOut <= d) setCheckOut(addDays(d, 1)); }} minDate={startOfToday()} selectsStart startDate={checkIn} endDate={checkOut} dateFormat="d MMM yyyy" className="input" />
              </label>
              <label className="sm:col-span-1">
                <span className="label flex items-center gap-1"><CalendarDays className="h-4 w-4" /> Check-out</span>
                <DatePicker selected={checkOut} onChange={(d: Date | null) => d && setCheckOut(d)} minDate={addDays(checkIn, 1)} maxDate={addDays(checkIn, 30)} selectsEnd startDate={checkIn} endDate={checkOut} dateFormat="d MMM yyyy" className="input" />
              </label>
              <label>
                <span className="label">Adults</span>
                <select className="input" value={adults} onChange={(e) => setAdults(Number(e.target.value))}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label>
                <span className="label">Children</span>
                <select className="input" value={children} onChange={(e) => setChildren(Number(e.target.value))}>
                  {Array.from({ length: 7 }, (_, i) => i).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
          </section>

          <section className="card p-6">
            <h2 className="text-lg font-semibold">Lead guest</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="firstName">First name</label>
                <input id="firstName" className="input" {...register("firstName", { required: "First name is required" })} />
                {errors.firstName && <p className="field-error">{errors.firstName.message}</p>}
              </div>
              <div>
                <label className="label" htmlFor="lastName">Last name</label>
                <input id="lastName" className="input" {...register("lastName", { required: "Last name is required" })} />
                {errors.lastName && <p className="field-error">{errors.lastName.message}</p>}
              </div>
              <div>
                <label className="label" htmlFor="email">Email</label>
                <input id="email" type="email" className="input" {...register("email", { required: "Email is required", pattern: { value: /^\S+@\S+\.\S+$/, message: "Enter a valid email" } })} />
                {errors.email && <p className="field-error">{errors.email.message}</p>}
              </div>
              <div>
                <label className="label" htmlFor="phone">Mobile number</label>
                <input id="phone" type="tel" placeholder="+91 98765 43210" className="input" {...register("phone", { required: "Mobile number is required", pattern: { value: /^[+\d][\d\s-]{9,15}$/, message: "Enter a valid mobile number" } })} />
                {errors.phone && <p className="field-error">{errors.phone.message}</p>}
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="specialRequests">Special requests <span className="font-normal text-slate-400">(optional)</span></label>
                <textarea id="specialRequests" rows={3} className="input" placeholder="Early check-in, extra bed, accessibility needs..." {...register("specialRequests", { maxLength: { value: 1000, message: "Keep it under 1000 characters" } })} />
              </div>
            </div>
          </section>

          <section className="card p-6">
            <h2 className="text-lg font-semibold">Payment</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled={!onlineAvailable}
                onClick={() => setMethod("online")}
                className={cn("rounded-xl border-2 p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50", method === "online" ? "border-primary-600 bg-primary-50" : "border-slate-200 hover:border-slate-300")}
              >
                <div className="flex items-center gap-2 font-semibold text-slate-900"><Smartphone className="h-5 w-5 text-primary-600" /> Pay now</div>
                <p className="mt-1 text-sm text-slate-600">UPI, Google Pay, PhonePe, debit & credit cards via Razorpay.</p>
                {!onlineAvailable && <p className="mt-1 text-xs text-amber-700">Online payment is temporarily unavailable — you can still reserve and pay at the hotel.</p>}
              </button>
              <button
                type="button"
                onClick={() => setMethod("hotel")}
                className={cn("rounded-xl border-2 p-4 text-left transition", method === "hotel" ? "border-primary-600 bg-primary-50" : "border-slate-200 hover:border-slate-300")}
              >
                <div className="flex items-center gap-2 font-semibold text-slate-900"><Wallet className="h-5 w-5 text-primary-600" /> Pay at hotel</div>
                <p className="mt-1 text-sm text-slate-600">Reserve now and pay the property during your stay.</p>
              </button>
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500"><Lock className="h-3.5 w-3.5" /> Card and UPI details are handled by Razorpay — StaySmart never sees them.</p>
          </section>
        </div>

        <aside>
          <div className="sticky top-24 space-y-4">
            <div className="card overflow-hidden">
              <HotelImage urls={hotel.imageUrls} alt={hotel.name} className="h-40 w-full" />
              <div className="p-5">
                <StarRating rating={hotel.starRating} source={hotel.starRatingSource} />
                <p className="mt-1 font-bold text-slate-900">{hotel.name}</p>
                <p className="mt-0.5 flex items-center gap-1 text-sm text-slate-600"><MapPin className="h-3.5 w-3.5" /> {shortPlace(hotel)}</p>
                <div className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm">
                  <div className="flex justify-between"><span className="text-slate-600">Dates</span><span className="font-medium">{formatDate(checkIn, { day: "numeric", month: "short" })} – {formatDate(checkOut, { day: "numeric", month: "short" })}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">Guests</span><span className="font-medium">{plural(adults, "adult")}{children ? `, ${children} ch.` : ""}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">{formatINR(hotel.pricePerNight)} × {plural(nights, "night")}</span><span className="font-medium">{formatINR(total)}</span></div>
                  <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-bold"><span>Total</span><span>{formatINR(total)}</span></div>
                </div>
              </div>
            </div>
            <button type="submit" className="btn-primary w-full py-3 text-base" disabled={processing || nights < 1}>
              {processing ? <Loader2 className="h-5 w-5 animate-spin" /> : method === "online" && onlineAvailable ? <CreditCard className="h-5 w-5" /> : <BadgeCheck className="h-5 w-5" />}
              {processing ? "Processing..." : method === "online" && onlineAvailable ? `Pay ${formatINR(total)}` : "Confirm booking"}
            </button>
            <p className="flex items-start gap-1.5 text-xs text-slate-500"><Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> You can cancel from My Bookings any time before check-out.</p>
          </div>
        </aside>
      </form>
    </div>
  );
};

export default Booking;
