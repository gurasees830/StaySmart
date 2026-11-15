import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "react-query";
import { ArrowRight, Building2, Camera, Castle, CreditCard, Crown, Database, Home as HomeIcon, MapPinned, Mountain, Palmtree, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import SearchBar from "../components/SearchBar";
import HotelCard, { HotelCardSkeleton } from "../components/HotelCard";
import Reveal from "../components/Reveal";
import { fetchFeaturedHotels, fetchPopularDestinations, fetchSiteStats } from "../lib/api";
import { QUICK_DESTINATIONS } from "../lib/constants";
import { useSearchContext } from "../contexts/SearchContext";
import { formatINR, formatNumber, plural, thumbUrl } from "../lib/utils";
import type { PopularDestination } from "../types";

const HERO_FALLBACK = "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Taj_Mahal_%28Edited%29.jpeg/1280px-Taj_Mahal_%28Edited%29.jpeg";

const CATEGORIES = [
  { label: "Beach resorts", type: "Beach Resort", icon: Palmtree, tone: "from-sky-500 to-cyan-400" },
  { label: "Heritage stays", type: "Heritage", icon: Castle, tone: "from-amber-500 to-orange-400" },
  { label: "Luxury hotels", type: "Luxury", icon: Crown, tone: "from-violet-500 to-fuchsia-400" },
  { label: "Resorts", type: "Resort", icon: Mountain, tone: "from-emerald-500 to-teal-400" },
  { label: "Homestays", type: "Homestay", icon: HomeIcon, tone: "from-rose-500 to-pink-400" },
  { label: "Budget picks", type: "Budget", icon: Wallet, tone: "from-slate-600 to-slate-400" },
];

const DestinationCard = ({ d, big = false }: { d: PopularDestination; big?: boolean }) => (
  <Link
    to={`/search?destination=${encodeURIComponent(d.city)}`}
    className={`group relative block overflow-hidden rounded-2xl bg-gradient-to-br from-primary-700 to-indigo-600 ${big ? "h-80 lg:h-full" : "h-56"}`}
  >
    {d.imageUrl && (
      <img
        src={thumbUrl(d.imageUrl, big ? "full" : "card")}
        alt={d.city}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-110"
        onError={(e) => (e.currentTarget.style.display = "none")}
      />
    )}
    <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
    <div className="absolute inset-x-0 bottom-0 p-5 text-white">
      <p className="text-xs font-medium uppercase tracking-wider text-white/80">{d.state}</p>
      <h3 className={`${big ? "text-3xl" : "text-xl"} font-bold`}>{d.city}</h3>
      <p className="mt-1 text-sm text-white/90">
        {plural(d.hotelsCount, "hotel")} · from {formatINR(d.minPrice)}
      </p>
      {big && d.summary && <p className="mt-2 line-clamp-2 max-w-md text-sm text-white/80">{d.summary}</p>}
    </div>
    {d.imageCredit?.author && (
      <span className="absolute right-2 top-2 max-w-[60%] truncate rounded bg-black/40 px-1.5 py-0.5 text-[10px] text-white/80">
        © {d.imageCredit.author}
      </span>
    )}
  </Link>
);

const Home = () => {
  const navigate = useNavigate();
  const { saveSearch } = useSearchContext();
  const { data: stats } = useQuery("site-stats", fetchSiteStats, { staleTime: 5 * 60 * 1000 });
  const featured = useQuery("featured-hotels", () => fetchFeaturedHotels(8), { staleTime: 5 * 60 * 1000 });
  const destinations = useQuery("popular-destinations", () => fetchPopularDestinations(9), { staleTime: 5 * 60 * 1000 });

  const heroImage = thumbUrl(destinations.data?.find((d) => d.city === "Udaipur" || d.city === "Jaipur")?.imageUrl || HERO_FALLBACK, "full");

  const quickSearch = (destination: string) => {
    saveSearch({ destination });
    navigate(`/search?destination=${encodeURIComponent(destination)}`);
  };

  return (
    <div>
      {/* Hero */}
      <section className="relative isolate overflow-hidden bg-slate-900">
        <img src={heroImage} alt="" referrerPolicy="no-referrer" className="absolute inset-0 -z-10 h-full w-full object-cover opacity-60 animate-ken-burns" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-slate-900/70 via-slate-900/40 to-slate-900/80" />
        <div className="container-page pb-16 pt-16 sm:pb-24 sm:pt-24">
          <div className="max-w-3xl animate-fade-in-up">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-white ring-1 ring-white/20 backdrop-blur">
              <Sparkles className="h-4 w-4 text-amber-300" />
              {stats ? `${formatNumber(stats.hotels)} real hotels across ${stats.states} states & UTs` : "Real hotels across India"}
            </span>
            <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-white sm:text-6xl">
              Find your perfect stay, <span className="bg-gradient-to-r from-amber-300 to-orange-400 bg-clip-text text-transparent">anywhere in India</span>
            </h1>
            <p className="mt-4 max-w-2xl text-lg text-slate-200">
              Search hotels, resorts, heritage havelis and homestays by city, neighbourhood or name. Book with UPI or card, or pay at the hotel.
            </p>
          </div>
          {/* z-30: the animation creates a stacking context, so the search bar
              (and its suggestions / date pickers) must sit above the chips below. */}
          <div className="relative z-30 mt-10 animate-fade-in-up [animation-delay:150ms]">
            <SearchBar variant="hero" />
          </div>
          <div className="relative z-10 mt-5 flex flex-wrap items-center gap-2 animate-fade-in-up [animation-delay:300ms]">
            <span className="text-sm text-slate-300">Popular:</span>
            {QUICK_DESTINATIONS.map((d) => (
              <button key={d} onClick={() => quickSearch(d)} className="rounded-full bg-white/10 px-3 py-1 text-sm text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-white/20">
                {d}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Stats strip */}
      {stats && (
        <section className="border-b border-slate-200 bg-white">
          <div className="container-page grid grid-cols-2 gap-6 py-6 sm:grid-cols-4">
            {[
              { value: formatNumber(stats.hotels), label: "Hotels listed" },
              { value: formatNumber(stats.cities), label: "Cities & towns" },
              { value: String(stats.states), label: "States & UTs" },
              { value: formatNumber(stats.withPhotos), label: "With property photos" },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <p className="text-2xl font-extrabold text-primary-700 sm:text-3xl">{s.value}</p>
                <p className="text-sm text-slate-600">{s.label}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Popular destinations */}
      <section className="container-page py-14">
        <Reveal>
          <div className="mb-8 flex items-end justify-between gap-4">
            <div>
              <h2 className="section-title">Popular destinations</h2>
              <p className="mt-2 text-slate-600">Cities with the most hotels on StaySmart</p>
            </div>
            <Link to="/search" className="hidden items-center gap-1 text-sm font-semibold text-primary-600 hover:text-primary-700 sm:inline-flex">
              Browse all hotels <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </Reveal>
        {destinations.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="skeleton h-56 rounded-2xl" />
            ))}
          </div>
        ) : destinations.data && destinations.data.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {destinations.data.slice(0, 9).map((d, i) => (
              <Reveal key={d.label} delay={(i % 3) * 80}>
                <DestinationCard d={d} />
              </Reveal>
            ))}
          </div>
        ) : null}
      </section>

      {/* Featured hotels */}
      <section className="bg-white py-14">
        <div className="container-page">
          <Reveal>
            <div className="mb-8 flex items-end justify-between gap-4">
              <div>
                <h2 className="section-title">Featured hotels</h2>
                <p className="mt-2 text-slate-600">Top-rated properties with real photos of the hotel</p>
              </div>
              <Link to="/search?photos=property&sortOption=starRating" className="hidden items-center gap-1 text-sm font-semibold text-primary-600 hover:text-primary-700 sm:inline-flex">
                See more <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </Reveal>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {featured.isLoading
              ? Array.from({ length: 8 }, (_, i) => <HotelCardSkeleton key={i} />)
              : featured.data?.map((hotel, i) => (
                  <Reveal key={hotel._id} delay={(i % 4) * 70}>
                    <HotelCard hotel={hotel} />
                  </Reveal>
                ))}
          </div>
          {!featured.isLoading && !featured.data?.length && (
            <p className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-600">Featured hotels will appear here once hotel photos have been gathered.</p>
          )}
        </div>
      </section>

      {/* Categories */}
      <section className="container-page py-14">
        <Reveal>
          <h2 className="section-title">Stay your way</h2>
          <p className="mt-2 text-slate-600">Explore by type of property</p>
        </Reveal>
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {CATEGORIES.map(({ label, type, icon: Icon, tone }, i) => (
            <Reveal key={type} delay={i * 60}>
              <Link to={`/search?types=${encodeURIComponent(type)}`} className="card group flex flex-col items-center gap-3 p-5 text-center transition hover:-translate-y-1 hover:shadow-medium">
                <span className={`rounded-2xl bg-gradient-to-br ${tone} p-3.5 text-white shadow-sm transition group-hover:scale-110`}>
                  <Icon className="h-6 w-6" />
                </span>
                <span className="text-sm font-semibold text-slate-800">{label}</span>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Near me CTA */}
      <section className="container-page">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-700 via-primary-600 to-indigo-600 p-8 text-white sm:p-12">
            <div className="absolute -right-10 -top-10 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
            <div className="absolute -bottom-16 left-1/3 h-56 w-56 rounded-full bg-indigo-400/30 blur-2xl" />
            <div className="relative flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
              <div className="max-w-xl">
                <MapPinned className="h-10 w-10 animate-float text-amber-300" />
                <h2 className="mt-4 text-2xl font-bold sm:text-3xl">Need a room nearby, right now?</h2>
                <p className="mt-2 text-primary-100">Share your location and see the closest hotels on a live map, with distance and directions.</p>
              </div>
              <Link to="/near-me" className="btn bg-white px-6 py-3 text-primary-700 hover:bg-primary-50">
                Find hotels near me <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Why */}
      <section className="container-page py-14">
        <Reveal>
          <h2 className="section-title text-center">Why travellers use StaySmart</h2>
        </Reveal>
        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Database, title: "Real hotels, real places", text: "Every listing is a real property mapped by OpenStreetMap contributors, with its actual address and location." },
            { icon: Camera, title: "Honest photos", text: "Photos of the property are marked as such. Where a hotel hasn't published any, we say so clearly." },
            { icon: CreditCard, title: "Pay your way", text: "UPI, Google Pay and cards via Razorpay — or reserve now and pay at the hotel." },
            { icon: ShieldCheck, title: "Flexible bookings", text: "Manage and cancel upcoming stays from My Bookings at any time before check-out." },
          ].map(({ icon: Icon, title, text }, i) => (
            <Reveal key={title} delay={i * 80}>
              <div className="card h-full p-6">
                <span className="inline-flex rounded-xl bg-primary-50 p-3 text-primary-600">
                  <Icon className="h-6 w-6" />
                </span>
                <h3 className="mt-4 font-semibold text-slate-900">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{text}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal>
          <div className="mt-10 flex flex-col items-center gap-3 text-center">
            <Building2 className="h-8 w-8 text-primary-600" />
            <p className="max-w-xl text-slate-600">Own a hotel, guest house or homestay? List it on StaySmart for free and manage bookings in one place.</p>
            <Link to="/add-hotel" className="btn-primary">
              List your property
            </Link>
          </div>
        </Reveal>
      </section>
    </div>
  );
};

export default Home;
