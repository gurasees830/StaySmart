import { ReactNode, useState } from "react";
import { useQuery } from "react-query";
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, RefreshCw, Table2 } from "lucide-react";
import { fetchDashboard, fetchForecast } from "../lib/api";
import { ErrorState, PageSpinner } from "../components/Spinner";
import { cn, errorMessage, formatDate, formatINR, formatNumber } from "../lib/utils";

// Chart tokens (validated: scripts/validate_palette.js, light mode, white surface).
const VIZ = {
  series1: "#2a78d6",
  series2: "#eb6834",
  series3: "#1baf7a",
  grid: "#e1e0d9",
  axis: "#c3c2b7",
  muted: "#898781",
  ink: "#0b0b0b",
  inkSecondary: "#52514e",
};

const compact = (n: number) => (n >= 10000 ? new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(n) : formatNumber(n));

const StatTile = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="card p-5">
    <p className="text-sm text-slate-600">{label}</p>
    <p className="mt-1 text-3xl font-semibold text-slate-900">{value}</p>
    {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
  </div>
);

type Column = { key: string; label: string; format?: (v: any) => string };

/** Card with a chart and its table-view twin. */
const ChartCard = ({ title, subtitle, rows, columns, children, empty }: { title: string; subtitle?: string; rows: any[]; columns: Column[]; children: ReactNode; empty?: string }) => {
  const [table, setTable] = useState(false);
  return (
    <section className="card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
        </div>
        {rows.length > 0 && (
          <button onClick={() => setTable((v) => !v)} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100" aria-pressed={table}>
            {table ? <BarChart3 className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />} {table ? "Chart" : "Table"}
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="flex h-40 items-center justify-center rounded-xl bg-slate-50 px-4 text-center text-sm text-slate-500">{empty || "No data yet"}</p>
      ) : table ? (
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>{columns.map((c) => <th key={c.key} className="py-2 pr-3 font-semibold">{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {rows.map((r, i) => (
                <tr key={i}>{columns.map((c) => <td key={c.key} className="py-1.5 pr-3 text-slate-700">{c.format ? c.format(r[c.key]) : r[c.key]}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  );
};

const TooltipBox = ({ active, payload, label, format }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-medium">
      <p className="font-semibold text-slate-900">{label ?? payload[0]?.payload?.name}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="mt-0.5 flex items-center gap-1.5 text-slate-700">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color || p.fill }} />
          {p.name}: <span className="font-semibold text-slate-900">{format ? format(p.value) : formatNumber(p.value)}</span>
        </p>
      ))}
    </div>
  );
};

/** Ranked horizontal bars: one hue, value at the tip, largest first. */
const RankedBars = ({ data, valueKey, nameKey, format = formatNumber, valueName }: { data: any[]; valueKey: string; nameKey: string; format?: (n: number) => string; valueName: string }) => (
  <div style={{ height: Math.max(160, data.length * 30 + 20) }}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 64, bottom: 0, left: 0 }} barCategoryGap={6}>
        <XAxis type="number" hide domain={[0, "dataMax"]} />
        <YAxis type="category" dataKey={nameKey} width={150} tickLine={false} axisLine={{ stroke: VIZ.axis }} tick={{ fill: VIZ.inkSecondary, fontSize: 12 }} interval={0} />
        <Tooltip cursor={{ fill: "rgba(42,120,214,0.06)" }} content={<TooltipBox format={format} />} />
        <Bar dataKey={valueKey} name={valueName} fill={VIZ.series1} barSize={16} radius={[0, 4, 4, 0]} isAnimationActive>
          <LabelList dataKey={valueKey} position="right" formatter={(v: any) => format(Number(v))} style={{ fill: VIZ.inkSecondary, fontSize: 12 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  </div>
);

/** One whole split into parts (tall segmented bar + legend). */
const SegmentedBar = ({ parts }: { parts: { name: string; value: number; color: string; text: string }[] }) => {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div>
      <div className="flex h-7 w-full gap-[2px]" role="img" aria-label={parts.map((p) => `${p.name}: ${formatNumber(p.value)} (${Math.round((p.value / total) * 100)}%)`).join(", ")}>
        {parts.filter((p) => p.value > 0).map((p) => {
          const pct = (p.value / total) * 100;
          return (
            <div key={p.name} title={`${p.name}: ${formatNumber(p.value)} (${pct.toFixed(1)}%)`} className="flex items-center rounded px-2 text-xs font-semibold transition-all duration-700" style={{ width: `${pct}%`, background: p.color, color: p.text }} tabIndex={0}>
              {pct >= 9 ? `${Math.round(pct)}%` : ""}
            </div>
          );
        })}
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {parts.map((p) => (
          <li key={p.name} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-slate-700">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: p.color }} /> {p.name}
            </span>
            <span className="font-medium text-slate-900">{formatNumber(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const PHOTO_LABELS: Record<string, string> = {
  property: "Photos of the property",
  mixed: "Property + representative photos",
  representative: "Representative photos only",
  pending: "Photos being gathered",
  none: "No photo",
};

const BusinessInsights = () => {
  const dashboard = useQuery("insights-dashboard", fetchDashboard, { keepPreviousData: true, refetchInterval: 60000 });
  const forecast = useQuery("insights-forecast", fetchForecast, { keepPreviousData: true });

  if (dashboard.isLoading) return <PageSpinner label="Loading business insights..." />;
  if (dashboard.isError || !dashboard.data) {
    return <div className="container-page py-12"><ErrorState message={errorMessage(dashboard.error, "Failed to load business insights data")} onRetry={() => dashboard.refetch()} /></div>;
  }

  const d = dashboard.data;
  const o = d.overview;
  const daily = d.dailyBookings.map((x: any) => ({ ...x, name: formatDate(x.date, { day: "numeric", month: "short" }) }));
  const hasBookings = o.totalBookings > 0;
  const byState = d.inventory.byState.map((s: any) => ({ name: s.state, hotels: s.count }));
  const byType = d.inventory.byType.map((t: any) => ({ name: t.type, hotels: t.count }));
  const byStar = [1, 2, 3, 4, 5].map((s) => {
    const hit = d.inventory.byStar.find((x: any) => x.stars === s);
    return { name: `${s}★`, hotels: hit?.count || 0, official: hit?.official || 0 };
  });
  const prices = d.inventory.priceByCity.map((c: any) => ({ name: c.city, avgPrice: c.avgPrice, hotels: c.hotels }));
  const coverageOrder = ["property", "mixed", "representative", "pending", "none"];
  const coverageColors: Record<string, [string, string]> = { property: [VIZ.series1, "#ffffff"], mixed: [VIZ.series2, "#ffffff"], representative: [VIZ.series3, "#ffffff"], pending: ["#c3c2b7", "#0b0b0b"], none: ["#e1e0d9", "#0b0b0b"] };
  const coverage = coverageOrder
    .map((key) => ({ key, value: d.inventory.photoCoverage.find((p: any) => p.source === key)?.count || 0 }))
    .filter((p) => p.value > 0)
    .map((p) => ({ name: PHOTO_LABELS[p.key], value: p.value, color: coverageColors[p.key][0], text: coverageColors[p.key][1] }));
  const statusRows = d.bookingStatus.map((s: any) => ({ name: s.status, bookings: s.count })).sort((a: any, b: any) => b.bookings - a.bookings);
  const methodRows = d.paymentMethods
    .map((m: any) => ({ name: m.method === "pay_at_hotel" ? "Pay at hotel" : String(m.method).toUpperCase(), bookings: m.count }))
    .sort((a: any, b: any) => b.bookings - a.bookings);
  const fc = forecast.data;
  const trendRows = fc ? [...fc.historical.map((h: any) => ({ week: h.week, actual: h.bookings, revenue: h.revenue })), ...fc.forecasts.map((f: any) => ({ week: f.week, forecast: f.bookings, revenue: f.revenue }))] : [];
  if (fc && fc.historical.length && fc.forecasts.length) {
    // connect the projection to the last actual point
    const lastActual = trendRows[fc.historical.length - 1];
    lastActual.forecast = lastActual.actual;
  }

  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Business insights</h1>
          <p className="mt-1 text-slate-600">Live bookings, revenue and inventory across StaySmart. Updated {formatDate(d.lastUpdated, { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}.</p>
        </div>
        <button className="btn-secondary" onClick={() => { dashboard.refetch(); forecast.refetch(); }}>
          <RefreshCw className={cn("h-4 w-4", dashboard.isFetching && "animate-spin")} /> Refresh
        </button>
      </div>

      <div className={cn("mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 transition-opacity", dashboard.isFetching && "opacity-80")}>
        <StatTile label="Hotels listed" value={compact(o.totalHotels)} hint={`${d.inventory.byState.length ? "Across India" : ""}`} />
        <StatTile label="Bookings" value={formatNumber(o.totalBookings)} hint={`${formatNumber(o.recentBookings)} in the last 30 days`} />
        <StatTile label="Revenue collected" value={formatINR(o.totalRevenue)} hint={`${formatINR(o.bookedValue)} booked value (incl. pay at hotel)`} />
        <StatTile label="Registered users" value={formatNumber(o.totalUsers)} hint={o.revenueGrowth ? `Revenue ${o.revenueGrowth > 0 ? "+" : ""}${o.revenueGrowth}% vs last month` : "Month-on-month growth appears after two months of bookings"} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ChartCard title="Daily bookings" subtitle="Bookings created per day, last 14 days" rows={daily} columns={[{ key: "date", label: "Date" }, { key: "bookings", label: "Bookings" }, { key: "value", label: "Value", format: formatINR }]}>
          <div className="relative h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={daily} margin={{ top: 16, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid vertical={false} stroke={VIZ.grid} />
                <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: VIZ.axis }} tick={{ fill: VIZ.muted, fontSize: 11 }} interval={1} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: VIZ.muted, fontSize: 11 }} />
                <Tooltip cursor={{ fill: "rgba(42,120,214,0.06)" }} content={<TooltipBox />} />
                <Bar dataKey="bookings" name="Bookings" fill={VIZ.series1} barSize={18} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            {!daily.some((x: any) => x.bookings > 0) && (
              <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-500">No bookings in the last 14 days yet</p>
            )}
          </div>
        </ChartCard>

        <ChartCard
          title="Booking trend & forecast"
          subtitle="Weekly bookings; dashed line is a linear projection"
          rows={trendRows}
          empty="The forecast appears after two weeks of bookings."
          columns={[{ key: "week", label: "Week of" }, { key: "actual", label: "Actual", format: (v) => (v ?? "—") }, { key: "forecast", label: "Forecast", format: (v) => (v ?? "—") }, { key: "revenue", label: "Revenue", format: formatINR }]}
        >
          {fc && fc.enoughData ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendRows} margin={{ top: 16, right: 16, bottom: 0, left: -16 }}>
                  <CartesianGrid vertical={false} stroke={VIZ.grid} />
                  <XAxis dataKey="week" tickFormatter={(w) => formatDate(w, { day: "numeric", month: "short" })} tickLine={false} axisLine={{ stroke: VIZ.axis }} tick={{ fill: VIZ.muted, fontSize: 11 }} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: VIZ.muted, fontSize: 11 }} />
                  <Tooltip cursor={{ stroke: VIZ.axis }} content={<TooltipBox />} />
                  <Line type="monotone" dataKey="actual" name="Actual" stroke={VIZ.series1} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "#fff", fill: VIZ.series1 }} activeDot={{ r: 5 }} connectNulls={false} />
                  <Line type="monotone" dataKey="forecast" name="Forecast" stroke={VIZ.series1} strokeOpacity={0.6} strokeWidth={2} strokeDasharray="6 4" dot={{ r: 4, strokeWidth: 2, stroke: "#fff", fill: "#86b6ef" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="flex h-64 items-center justify-center rounded-xl bg-slate-50 px-6 text-center text-sm text-slate-500">
              {hasBookings ? "A forecast needs at least two weeks of booking history." : "No bookings yet. Make a booking to start the trend."}
            </p>
          )}
        </ChartCard>

        <ChartCard title="Photo coverage" subtitle="How many hotels show real photos of the property" rows={coverage} columns={[{ key: "name", label: "Photos" }, { key: "value", label: "Hotels", format: formatNumber }]}>
          <SegmentedBar parts={coverage} />
          <p className="mt-4 text-xs text-slate-500">Representative photos are real hotel photographs, shown when a property has not published its own.</p>
        </ChartCard>

        <ChartCard title="Hotels by star category" subtitle="Official ratings where published, otherwise estimated" rows={byStar} columns={[{ key: "name", label: "Stars" }, { key: "hotels", label: "Hotels", format: formatNumber }, { key: "official", label: "Officially rated", format: formatNumber }]}>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byStar} margin={{ top: 20, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid vertical={false} stroke={VIZ.grid} />
                <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: VIZ.axis }} tick={{ fill: VIZ.inkSecondary, fontSize: 12 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: VIZ.muted, fontSize: 11 }} tickFormatter={compact} />
                <Tooltip cursor={{ fill: "rgba(42,120,214,0.06)" }} content={<TooltipBox />} />
                <Bar dataKey="hotels" name="Hotels" fill={VIZ.series1} barSize={24} radius={[4, 4, 0, 0]}>
                  <LabelList dataKey="hotels" position="top" formatter={(v: any) => compact(Number(v))} style={{ fill: VIZ.inkSecondary, fontSize: 11 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Hotels by state" subtitle="Top 12 states and union territories" rows={byState} columns={[{ key: "name", label: "State" }, { key: "hotels", label: "Hotels", format: formatNumber }]}>
          <RankedBars data={byState} valueKey="hotels" nameKey="name" valueName="Hotels" />
        </ChartCard>

        <ChartCard title="Property types" subtitle="A hotel can belong to more than one type" rows={byType} columns={[{ key: "name", label: "Type" }, { key: "hotels", label: "Hotels", format: formatNumber }]}>
          <RankedBars data={byType} valueKey="hotels" nameKey="name" valueName="Hotels" />
        </ChartCard>

        <ChartCard title="Average nightly price by city" subtitle="Ten cities with the most hotels" rows={prices} columns={[{ key: "name", label: "City" }, { key: "avgPrice", label: "Avg price", format: formatINR }, { key: "hotels", label: "Hotels", format: formatNumber }]}>
          <RankedBars data={[...prices].sort((a, b) => b.avgPrice - a.avgPrice)} valueKey="avgPrice" nameKey="name" valueName="Average price" format={formatINR} />
        </ChartCard>

        <div className="grid gap-6">
          <ChartCard title="Bookings by status" rows={statusRows} empty="No bookings yet" columns={[{ key: "name", label: "Status" }, { key: "bookings", label: "Bookings" }]}>
            <RankedBars data={statusRows} valueKey="bookings" nameKey="name" valueName="Bookings" />
          </ChartCard>
          <ChartCard title="Bookings by payment method" rows={methodRows} empty="No bookings yet" columns={[{ key: "name", label: "Method" }, { key: "bookings", label: "Bookings" }]}>
            <RankedBars data={methodRows} valueKey="bookings" nameKey="name" valueName="Bookings" />
          </ChartCard>
        </div>
      </div>

      {d.hotelPerformance.length > 0 && hasBookings && (
        <section className="card mt-6 overflow-x-auto p-5">
          <h2 className="font-semibold text-slate-900">Top hotels by bookings</h2>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="py-2 pr-4">Hotel</th><th className="py-2 pr-4">City</th><th className="py-2 pr-4">Stars</th><th className="py-2 pr-4 text-right">Bookings</th><th className="py-2 text-right">Booked value</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {d.hotelPerformance.map((h: any) => (
                <tr key={h._id}><td className="py-2 pr-4 font-medium text-slate-900">{h.name}</td><td className="py-2 pr-4 text-slate-600">{h.city}</td><td className="py-2 pr-4">{h.starRating}★</td><td className="py-2 pr-4 text-right">{h.bookingCount}</td><td className="py-2 text-right">{formatINR(h.totalRevenue)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
};

export default BusinessInsights;
