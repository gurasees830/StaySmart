import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import L from "leaflet";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { cn, formatINR, thumbUrl } from "../lib/utils";

export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  price?: number;
  href?: string;
  imageUrl?: string;
};

type Props = {
  markers: MapMarker[];
  center?: [number, number];
  zoom?: number;
  userLocation?: [number, number] | null;
  route?: [number, number][];
  activeId?: string | null;
  onMarkerClick?: (id: string) => void;
  className?: string;
  showPrices?: boolean;
};

// Price pills have a variable width, so the icon box is 0x0 and the pill is
// centred on the coordinate with a CSS transform.
const priceIcon = (label: string, active: boolean) =>
  L.divIcon({
    className: "",
    html: `<div class="hotel-marker${active ? " active" : ""}" style="position:absolute;height:26px;transform:translate(-50%,-50%)">${label}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });

const dotIcon = (active: boolean) =>
  L.divIcon({
    className: "",
    html: `<div class="hotel-marker${active ? " active" : ""}" style="width:18px;height:18px;padding:0"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

const youIcon = L.divIcon({ className: "", html: '<div class="you-marker" style="width:18px;height:18px"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });

const shortPrice = (price: number) => (price >= 100000 ? `₹${Math.round(price / 1000)}k` : formatINR(price));

/** Keeps the map framed on whatever is shown. */
const FitBounds = ({ points, fallback, zoom }: { points: [number, number][]; fallback?: [number, number]; zoom: number }) => {
  const map = useMap();
  const key = points.map((p) => p.join(",")).join("|");
  useEffect(() => {
    if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
    } else if (points.length === 1) {
      map.setView(points[0], zoom);
    } else if (fallback) {
      map.setView(fallback, zoom);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    // Leaflet needs a size recalculation when its container appears/resizes.
    const t = window.setTimeout(() => map.invalidateSize(), 150);
    return () => window.clearTimeout(t);
  }, [map]);
  return null;
};

const MapView = ({ markers, center, zoom = 13, userLocation, route, activeId, onMarkerClick, className, showPrices = true }: Props) => {
  const valid = useMemo(() => markers.filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng)), [markers]);
  const points = useMemo<[number, number][]>(() => {
    const list: [number, number][] = valid.map((m) => [m.lat, m.lng]);
    if (userLocation) list.push(userLocation);
    if (route?.length) list.push(...route);
    return list;
  }, [valid, userLocation, route]);
  const initialCenter: [number, number] = center || points[0] || [22.5, 79];

  return (
    <div className={cn("overflow-hidden rounded-2xl border border-slate-200", className)}>
      <MapContainer center={initialCenter} zoom={zoom} scrollWheelZoom={false} className="h-full w-full" style={{ minHeight: 260 }}>
        {/* OpenStreetMap's standard tiles: free with attribution, no API key
            (CARTO's basemaps now return "API key required" tiles). */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <FitBounds points={points} fallback={center} zoom={zoom} />
        {userLocation && (
          <Marker position={userLocation} icon={youIcon}>
            <Popup>You are here</Popup>
          </Marker>
        )}
        {route && route.length > 1 && <Polyline positions={route} pathOptions={{ color: "#2563eb", weight: 5, opacity: 0.8 }} />}
        {valid.map((m) => (
          <Marker
            key={m.id}
            position={[m.lat, m.lng]}
            icon={showPrices && m.price ? priceIcon(shortPrice(m.price), activeId === m.id) : dotIcon(activeId === m.id)}
            zIndexOffset={activeId === m.id ? 1000 : 0}
            eventHandlers={{ click: () => onMarkerClick?.(m.id) }}
          >
            <Popup>
              <div className="w-48">
                {m.imageUrl && (
                  <img src={thumbUrl(m.imageUrl, "card")} alt="" referrerPolicy="no-referrer" className="mb-2 h-24 w-full rounded-md object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
                )}
                <p className="font-semibold text-slate-900">{m.title}</p>
                {m.subtitle && <p className="text-xs text-slate-500">{m.subtitle}</p>}
                {m.price ? <p className="mt-1 text-sm font-semibold text-slate-900">{formatINR(m.price)} / night</p> : null}
                {m.href && (
                  <Link to={m.href} className="mt-1 inline-block text-sm font-semibold text-primary-600">
                    View hotel →
                  </Link>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
};

export default MapView;
