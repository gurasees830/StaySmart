import { useQuery } from "react-query";
import { Link } from "react-router-dom";
import { Activity, CheckCircle2, Cpu, Database, RefreshCw, Server, XCircle } from "lucide-react";
import { fetchHealth, fetchHealthDetailed, fetchSystemStats } from "../lib/api";
import { cn, formatINR, formatNumber } from "../lib/utils";

const Stat = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="rounded-xl bg-slate-50 p-4">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
    {hint && <p className="text-xs text-slate-500">{hint}</p>}
  </div>
);

const ApiStatus = () => {
  const health = useQuery("health", fetchHealth, { refetchInterval: 15000, retry: false });
  const detailed = useQuery("health-detailed", fetchHealthDetailed, { refetchInterval: 15000, retry: false });
  const stats = useQuery("system-stats", fetchSystemStats, { refetchInterval: 15000, retry: false });
  const healthy = health.data?.status === "healthy";
  const down = health.isError;

  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">API status</h1>
          <p className="mt-1 text-slate-600">Live health of the StaySmart backend. Refreshes every 15 seconds.</p>
        </div>
        <button className="btn-secondary" onClick={() => { health.refetch(); detailed.refetch(); stats.refetch(); }}>
          <RefreshCw className={cn("h-4 w-4", health.isFetching && "animate-spin")} /> Refresh
        </button>
      </div>

      <div className={cn("mt-6 flex items-center gap-4 rounded-2xl p-6", down ? "bg-red-50" : healthy ? "bg-emerald-50" : "bg-amber-50")}>
        {down ? <XCircle className="h-10 w-10 text-red-600" /> : <CheckCircle2 className={cn("h-10 w-10", healthy ? "text-emerald-600" : "text-amber-600")} />}
        <div>
          <p className="text-xl font-bold text-slate-900">{down ? "API unavailable" : healthy ? "All systems operational" : "Checking..."}</p>
          <p className="text-sm text-slate-600">
            {down ? "The frontend cannot reach the backend. Start it with start-staysmart.ps1." : health.data ? `Database ${health.data.database?.status} · uptime ${Math.floor((health.data.uptime || 0) / 60)} min · ${health.data.environment}` : ""}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="card p-6">
          <h2 className="flex items-center gap-2 font-semibold"><Database className="h-5 w-5 text-primary-600" /> Database</h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Stat label="Status" value={health.data?.database?.status || "—"} />
            <Stat label="Collections" value={String(stats.data?.database?.collections ?? "—")} />
            <Stat label="Hotels" value={stats.data ? formatNumber(stats.data.database.totalHotels) : "—"} />
            <Stat label="Bookings" value={stats.data ? formatNumber(stats.data.database.totalBookings) : "—"} />
          </div>
          {detailed.data?.database && <p className="mt-3 text-xs text-slate-500">{detailed.data.database.host}:{detailed.data.database.port} / {detailed.data.database.name}</p>}
        </section>
        <section className="card p-6">
          <h2 className="flex items-center gap-2 font-semibold"><Activity className="h-5 w-5 text-primary-600" /> Requests (last 15 min)</h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Stat label="Avg response" value={stats.data ? `${stats.data.application.avgResponseTime} ms` : "—"} />
            <Stat label="p95 response" value={stats.data ? `${stats.data.application.p95ResponseTime} ms` : "—"} />
            <Stat label="Requests / min" value={stats.data ? String(stats.data.application.requestsPerMinute) : "—"} />
            <Stat label="Error rate" value={stats.data ? `${(stats.data.application.errorRate * 100).toFixed(1)}%` : "—"} />
          </div>
          <p className="mt-3 text-xs text-slate-500">Measured by the server for every API request.</p>
        </section>
        <section className="card p-6">
          <h2 className="flex items-center gap-2 font-semibold"><Cpu className="h-5 w-5 text-primary-600" /> Server</h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Stat label="Heap used" value={stats.data ? `${stats.data.system.memory.used} MB` : "—"} hint={stats.data ? `of ${stats.data.system.memory.total} MB` : undefined} />
            <Stat label="RSS" value={stats.data ? `${stats.data.system.memory.rss} MB` : "—"} />
            <Stat label="Node" value={detailed.data?.system?.nodeVersion || "—"} />
            <Stat label="Platform" value={detailed.data?.system ? `${detailed.data.system.platform}/${detailed.data.system.arch}` : "—"} />
          </div>
          {stats.data && <p className="mt-3 text-xs text-slate-500">Paid revenue recorded: {formatINR(stats.data.database.totalRevenue)}</p>}
        </section>
      </div>

      <section className="card mt-6 p-6">
        <h2 className="flex items-center gap-2 font-semibold"><Server className="h-5 w-5 text-primary-600" /> Endpoints checked</h2>
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {[
            { path: "/api/health", q: health },
            { path: "/api/health/detailed", q: detailed },
            { path: "/api/business-insights/system-stats/public", q: stats },
          ].map(({ path, q }) => (
            <li key={path} className="flex items-center justify-between py-2">
              <code className="text-slate-700">{path}</code>
              <span className={cn("chip", q.isError ? "bg-red-50 text-red-700" : q.data ? "bg-emerald-50 text-emerald-700" : "")}>{q.isError ? "failing" : q.data ? "OK" : "…"}</span>
            </li>
          ))}
        </ul>
        <Link to="/api-reference" className="mt-4 inline-block text-sm font-semibold text-primary-600">View API documentation →</Link>
      </section>
    </div>
  );
};

export default ApiStatus;
