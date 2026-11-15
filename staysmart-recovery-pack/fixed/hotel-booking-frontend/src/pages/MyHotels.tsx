import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { BookOpen, Building2, Eye, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import HotelImage from "../components/HotelImage";
import Modal from "../components/Modal";
import StarRating from "../components/StarRating";
import { EmptyState, ErrorState, PageSpinner, Spinner } from "../components/Spinner";
import { useAppContext } from "../contexts/AppContext";
import { deleteMyHotel, fetchHotelBookings, fetchMyHotels, updateBookingStatus, updatePaymentStatus } from "../lib/api";
import { cn, errorMessage, formatDate, formatINR, plural, shortPlace } from "../lib/utils";
import type { Booking, Hotel } from "../types";

const BookingLog = ({ hotel, onClose }: { hotel: Hotel; onClose: () => void }) => {
  const { showToast } = useAppContext();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery(["hotel-bookings", hotel._id], () => fetchHotelBookings(hotel._id));
  const refresh = () => queryClient.invalidateQueries(["hotel-bookings", hotel._id]);
  const statusMutation = useMutation(({ id, status }: { id: string; status: Booking["status"] }) => updateBookingStatus(id, status), {
    onSuccess: () => {
      refresh();
      showToast({ title: "Booking updated" });
    },
    onError: (e) => showToast({ title: "Update failed", description: errorMessage(e), type: "error" }),
  });
  const paymentMutation = useMutation(({ id, status }: { id: string; status: Booking["paymentStatus"] }) => updatePaymentStatus(id, status), {
    onSuccess: () => {
      refresh();
      showToast({ title: "Payment status updated" });
    },
    onError: (e) => showToast({ title: "Update failed", description: errorMessage(e), type: "error" }),
  });

  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title={`Bookings · ${hotel.name}`} description="Manage reservations for this property" size="xl">
      {isLoading ? (
        <div className="flex justify-center py-10"><Spinner className="h-8 w-8" /></div>
      ) : isError ? (
        <ErrorState message={errorMessage(error, "Could not load bookings")} />
      ) : !data?.length ? (
        <p className="py-10 text-center text-sm text-slate-600">No bookings for this property yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-4">Guest</th>
                <th className="py-2 pr-4">Stay</th>
                <th className="py-2 pr-4">Total</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Payment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((b) => (
                <tr key={b._id} className="align-top">
                  <td className="py-3 pr-4">
                    <p className="font-medium text-slate-900">{b.firstName} {b.lastName}</p>
                    <p className="text-xs text-slate-500">{b.email}{b.phone ? ` · ${b.phone}` : ""}</p>
                    {b.specialRequests && <p className="mt-1 max-w-xs text-xs italic text-slate-600">“{b.specialRequests}”</p>}
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap">
                    {formatDate(b.checkIn, { day: "numeric", month: "short" })} → {formatDate(b.checkOut, { day: "numeric", month: "short", year: "numeric" })}
                    <p className="text-xs text-slate-500">{plural(b.adultCount, "adult")}{b.childCount ? `, ${b.childCount} ch.` : ""}</p>
                  </td>
                  <td className="py-3 pr-4 font-semibold">{formatINR(b.totalCost)}</td>
                  <td className="py-3 pr-4">
                    <select className="input py-1.5 text-xs" value={b.status} disabled={statusMutation.isLoading} onChange={(e) => statusMutation.mutate({ id: b._id, status: e.target.value as Booking["status"] })}>
                      {["pending", "confirmed", "completed", "cancelled", "refunded"].map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="py-3">
                    <select className="input py-1.5 text-xs" value={b.paymentStatus} disabled={paymentMutation.isLoading} onChange={(e) => paymentMutation.mutate({ id: b._id, status: e.target.value as Booking["paymentStatus"] })}>
                      {["pending", "paid", "failed", "refunded"].map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <p className="mt-1 text-xs text-slate-500">{b.paymentMethod === "pay_at_hotel" ? "Pay at hotel" : b.paymentMethod?.toUpperCase()}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
};

const MyHotels = () => {
  const { showToast } = useAppContext();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery("my-hotels", fetchMyHotels);
  const [logHotel, setLogHotel] = useState<Hotel | null>(null);
  const [toDelete, setToDelete] = useState<Hotel | null>(null);
  const remove = useMutation((id: string) => deleteMyHotel(id), {
    onSuccess: () => {
      showToast({ title: "Hotel deleted" });
      setToDelete(null);
      queryClient.invalidateQueries("my-hotels");
    },
    onError: (e) => showToast({ title: "Could not delete hotel", description: errorMessage(e), type: "error" }),
  });

  if (isLoading) return <PageSpinner label="Loading your hotels..." />;
  if (isError) return <div className="container-page py-12"><ErrorState message={errorMessage(error, "Could not load your hotels")} onRetry={() => refetch()} /></div>;

  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">My hotels</h1>
          <p className="mt-1 text-slate-600">Manage your listings and their bookings.</p>
        </div>
        <Link to="/add-hotel" className="btn-primary"><Plus className="h-4 w-4" /> Add hotel</Link>
      </div>

      <div className="mt-6">
        {!data?.length ? (
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title="You haven't listed a property yet"
            description="Add your hotel, guest house or homestay with photos, prices and facilities. It appears in search immediately."
            action={<Link to="/add-hotel" className="btn-primary"><Plus className="h-4 w-4" /> Add your first hotel</Link>}
          />
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {data.map((hotel) => (
              <article key={hotel._id} className="card flex flex-col overflow-hidden animate-fade-in sm:flex-row">
                <HotelImage urls={hotel.imageUrls} alt={hotel.name} className="h-44 w-full sm:h-auto sm:w-48 sm:shrink-0" />
                <div className="flex flex-1 flex-col p-5">
                  <StarRating rating={hotel.starRating} source={hotel.starRatingSource} />
                  <h2 className="mt-1 text-lg font-bold text-slate-900">{hotel.name}</h2>
                  <p className="flex items-center gap-1 text-sm text-slate-600"><MapPin className="h-3.5 w-3.5" /> {shortPlace(hotel)}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="chip">{formatINR(hotel.pricePerNight)} / night</span>
                    <span className="chip">{plural(hotel.totalBookings || 0, "booking")}</span>
                    {(hotel.totalRevenue || 0) > 0 && <span className="chip bg-emerald-50 text-emerald-700">{formatINR(hotel.totalRevenue)} earned</span>}
                  </div>
                  <div className="mt-auto flex flex-wrap gap-2 pt-4">
                    <button className="btn-primary py-2" onClick={() => setLogHotel(hotel)}><BookOpen className="h-4 w-4" /> Bookings</button>
                    <Link to={`/edit-hotel/${hotel._id}`} className="btn-secondary py-2"><Pencil className="h-4 w-4" /> Edit</Link>
                    <Link to={`/detail/${hotel._id}`} className="btn-secondary py-2"><Eye className="h-4 w-4" /> View</Link>
                    <button className={cn("btn py-2 text-red-600 hover:bg-red-50")} onClick={() => setToDelete(hotel)} aria-label={`Delete ${hotel.name}`}><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {logHotel && <BookingLog hotel={logHotel} onClose={() => setLogHotel(null)} />}

      <Modal
        open={Boolean(toDelete)}
        onOpenChange={(open) => !open && setToDelete(null)}
        title="Delete this hotel?"
        description={toDelete?.name}
        size="sm"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setToDelete(null)}>Cancel</button>
            <button className="btn-danger" disabled={remove.isLoading} onClick={() => toDelete && remove.mutate(toDelete._id)}>{remove.isLoading ? "Deleting..." : "Delete"}</button>
          </>
        }
      >
        <p className="text-sm text-slate-600">The listing will be removed from search. Hotels with upcoming bookings can't be deleted.</p>
      </Modal>
    </div>
  );
};

export default MyHotels;
