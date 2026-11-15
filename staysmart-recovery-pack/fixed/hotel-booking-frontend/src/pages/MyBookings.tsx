import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { CalendarCheck, CalendarDays, MapPin, Navigation, Users, XCircle } from "lucide-react";
import HotelImage from "../components/HotelImage";
import Modal from "../components/Modal";
import { EmptyState, ErrorState, PageSpinner } from "../components/Spinner";
import { useAppContext } from "../contexts/AppContext";
import { cancelBooking, fetchMyBookings } from "../lib/api";
import { cn, errorMessage, formatDate, formatINR, nightsBetween, plural, shortPlace } from "../lib/utils";
import type { Booking, Hotel } from "../types";

type Row = { booking: Booking; hotel: Hotel };
type Tab = "upcoming" | "past" | "cancelled";

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-700",
  pending: "bg-amber-50 text-amber-700",
  cancelled: "bg-red-50 text-red-700",
  refunded: "bg-slate-100 text-slate-700",
  completed: "bg-primary-50 text-primary-700",
};

const paymentLabel = (b: Booking) => {
  if (b.paymentStatus === "paid") return `Paid${b.paymentMethod ? ` · ${b.paymentMethod.toUpperCase()}` : ""}`;
  if (b.paymentStatus === "refunded") return `Refunded ${formatINR(b.refundAmount || b.totalCost)}`;
  if (b.paymentMethod === "pay_at_hotel") return "Pay at hotel";
  return `Payment ${b.paymentStatus}`;
};

const MyBookings = () => {
  const { showToast } = useAppContext();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("upcoming");
  const [toCancel, setToCancel] = useState<Row | null>(null);
  const [reason, setReason] = useState("");
  const { data, isLoading, isError, error, refetch } = useQuery("my-bookings", () => fetchMyBookings(true));

  const cancel = useMutation(({ id, reason }: { id: string; reason: string }) => cancelBooking(id, reason), {
    onSuccess: (booking) => {
      showToast({
        title: "Booking cancelled",
        description: booking.paymentStatus === "refunded" ? `A refund of ${formatINR(booking.refundAmount || booking.totalCost)} has been recorded.` : "No payment was taken for this booking.",
      });
      setToCancel(null);
      setReason("");
      queryClient.invalidateQueries("my-bookings");
    },
    onError: (e) => showToast({ title: "Cancellation failed", description: errorMessage(e), type: "error" }),
  });

  const rows = useMemo(() => {
    const all: Row[] = (data || []).flatMap((hotel) => hotel.bookings.map((booking) => ({ booking, hotel })));
    const now = Date.now();
    const groups: Record<Tab, Row[]> = { upcoming: [], past: [], cancelled: [] };
    for (const row of all) {
      if (["cancelled", "refunded"].includes(row.booking.status)) groups.cancelled.push(row);
      else if (new Date(row.booking.checkOut).getTime() >= now) groups.upcoming.push(row);
      else groups.past.push(row);
    }
    groups.upcoming.sort((a, b) => +new Date(a.booking.checkIn) - +new Date(b.booking.checkIn));
    groups.past.sort((a, b) => +new Date(b.booking.checkIn) - +new Date(a.booking.checkIn));
    groups.cancelled.sort((a, b) => +new Date(b.booking.updatedAt) - +new Date(a.booking.updatedAt));
    return groups;
  }, [data]);

  if (isLoading) return <PageSpinner label="Loading your bookings..." />;
  if (isError) return <div className="container-page py-12"><ErrorState message={errorMessage(error, "Could not load your bookings")} onRetry={() => refetch()} /></div>;

  const list = rows[tab];

  return (
    <div className="container-page py-8">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">My bookings</h1>
      <p className="mt-1 text-slate-600">Your upcoming trips and booking history.</p>

      <div className="mt-6 inline-flex rounded-xl border border-slate-200 bg-white p-1">
        {(["upcoming", "past", "cancelled"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("rounded-lg px-4 py-2 text-sm font-semibold capitalize transition", tab === t ? "bg-primary-600 text-white" : "text-slate-600 hover:bg-slate-100")}>
            {t} <span className={cn("ml-1 rounded-full px-1.5 text-xs", tab === t ? "bg-white/20" : "bg-slate-100")}>{rows[t].length}</span>
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-4">
        {list.length === 0 ? (
          <EmptyState
            icon={<CalendarCheck className="h-8 w-8" />}
            title={tab === "upcoming" ? "No upcoming trips" : tab === "past" ? "No past stays yet" : "No cancelled bookings"}
            description={tab === "upcoming" ? "When you book a stay it will appear here." : undefined}
            action={tab === "upcoming" ? <Link to="/search" className="btn-primary">Find a hotel</Link> : undefined}
          />
        ) : (
          list.map(({ booking, hotel }) => {
            const nights = nightsBetween(new Date(booking.checkIn), new Date(booking.checkOut));
            const lat = hotel.location?.latitude;
            const lng = hotel.location?.longitude;
            return (
              <article key={booking._id} className="card flex flex-col overflow-hidden animate-fade-in md:flex-row">
                <Link to={`/detail/${hotel._id}`} className="md:w-64 md:shrink-0">
                  <HotelImage urls={hotel.imageUrls || []} alt={hotel.name} className="h-44 w-full md:h-full" />
                </Link>
                <div className="flex flex-1 flex-col gap-3 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <Link to={`/detail/${hotel._id}`} className="text-lg font-bold text-slate-900 hover:text-primary-700">{hotel.name}</Link>
                      <p className="mt-0.5 flex items-center gap-1 text-sm text-slate-600"><MapPin className="h-3.5 w-3.5" /> {shortPlace(hotel)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className={cn("chip capitalize", STATUS_STYLES[booking.status])}>{booking.status}</span>
                      <span className="chip">{paymentLabel(booking)}</span>
                    </div>
                  </div>
                  <div className="grid gap-3 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-3">
                    <p className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary-600" /> {formatDate(booking.checkIn, { day: "numeric", month: "short" })} → {formatDate(booking.checkOut, { day: "numeric", month: "short", year: "numeric" })}</p>
                    <p className="flex items-center gap-2"><Users className="h-4 w-4 text-primary-600" /> {plural(booking.adultCount, "adult")}{booking.childCount ? `, ${plural(booking.childCount, "child", "children")}` : ""}</p>
                    <p className="font-semibold">{formatINR(booking.totalCost)} · {plural(nights, "night")}</p>
                  </div>
                  {booking.cancellationReason && <p className="text-sm text-slate-600">Reason: {booking.cancellationReason}</p>}
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                    <p className="text-xs text-slate-500">Ref {booking._id.slice(-8).toUpperCase()} · booked {formatDate(booking.createdAt)}</p>
                    <div className="flex flex-wrap gap-2">
                      {lat && lng && tab === "upcoming" && (
                        <a href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`} target="_blank" rel="noreferrer" className="btn-secondary py-2">
                          <Navigation className="h-4 w-4" /> Directions
                        </a>
                      )}
                      {tab === "upcoming" && (
                        <button className="btn py-2 text-red-600 ring-1 ring-red-200 hover:bg-red-50" onClick={() => setToCancel({ booking, hotel })}>
                          <XCircle className="h-4 w-4" /> Cancel
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>

      <Modal
        open={Boolean(toCancel)}
        onOpenChange={(open) => !open && setToCancel(null)}
        title="Cancel this booking?"
        description={toCancel ? `${toCancel.hotel.name} · ${formatDate(toCancel.booking.checkIn)} – ${formatDate(toCancel.booking.checkOut)}` : ""}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setToCancel(null)}>Keep booking</button>
            <button className="btn-danger" disabled={cancel.isLoading} onClick={() => toCancel && cancel.mutate({ id: toCancel.booking._id, reason })}>
              {cancel.isLoading ? "Cancelling..." : "Cancel booking"}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          {toCancel?.booking.paymentStatus === "paid" ? `The amount of ${formatINR(toCancel.booking.totalCost)} will be marked for refund.` : "You haven't been charged for this booking."}
        </p>
        <label className="label mt-4" htmlFor="reason">Reason (optional)</label>
        <textarea id="reason" rows={3} className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Change of plans..." maxLength={500} />
      </Modal>
    </div>
  );
};

export default MyBookings;
