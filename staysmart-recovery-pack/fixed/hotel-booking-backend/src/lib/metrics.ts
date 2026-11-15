import { NextFunction, Request, Response } from "express";

/** Real request metrics, measured in-process (replaces random numbers). */
type Sample = { at: number; ms: number; status: number };

const WINDOW_MS = 15 * 60 * 1000;
const samples: Sample[] = [];
let totalRequests = 0;
let totalErrors = 0;
const startedAt = Date.now();

export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (!req.path.startsWith("/api")) return next();
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    totalRequests += 1;
    if (res.statusCode >= 500) totalErrors += 1;
    samples.push({ at: Date.now(), ms, status: res.statusCode });
    const cutoff = Date.now() - WINDOW_MS;
    while (samples.length && samples[0].at < cutoff) samples.shift();
  });
  next();
};

export const getRequestMetrics = () => {
  const now = Date.now();
  const lastMinute = samples.filter((s) => s.at >= now - 60_000);
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  const pct = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);
  const errors = samples.filter((s) => s.status >= 500).length;
  return {
    windowMinutes: WINDOW_MS / 60000,
    requestsInWindow: samples.length,
    requestsPerMinute: lastMinute.length,
    avgResponseTime: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0,
    p95ResponseTime: Math.round(pct(95)),
    errorRate: samples.length ? Number((errors / samples.length).toFixed(4)) : 0,
    totalRequests,
    totalErrors,
    uptimeSeconds: Math.round((now - startedAt) / 1000),
  };
};
