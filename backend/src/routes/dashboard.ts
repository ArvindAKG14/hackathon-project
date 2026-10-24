import { Router, type Request, type Response } from "express";
import * as store from "../data/store.js";
import { bus } from "../events.js";
import { currentUserId } from "../middleware/auth.js";
import { recordReading } from "../services/readings.js";
import { isVitalType, worst } from "../services/thresholds.js";
import type { Alert, Reading, Senior } from "../types.js";

export const dashboardRouter = Router();

function summary(senior: Senior) {
  const latest = store.latestVitals(senior.id);
  return { ...senior, status: worst(Object.values(latest).map((r) => r.status)), latest };
}

function parseLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

function requireSenior(req: Request<{ id: string }>, res: Response): Senior | undefined {
  const senior = store.seniors.get(req.params.id);
  if (senior && store.canAccess(currentUserId(res), senior.id)) return senior;
  // Same response for "doesn't exist" and "no access", so IDs can't be probed.
  res.status(404).json({ error: "Senior not found" });
  return undefined;
}

dashboardRouter.get("/me", (_req, res) => {
  res.json(store.users.get(currentUserId(res)));
});

dashboardRouter.get("/seniors", (_req, res) => {
  res.json(store.seniorsFor(currentUserId(res)).map(summary));
});

dashboardRouter.get("/seniors/:id", (req, res) => {
  const senior = requireSenior(req, res);
  if (senior) res.json(summary(senior));
});

dashboardRouter.get("/seniors/:id/vitals/latest", (req, res) => {
  const senior = requireSenior(req, res);
  if (senior) res.json(store.latestVitals(senior.id));
});

dashboardRouter.get("/seniors/:id/vitals", (req, res) => {
  const senior = requireSenior(req, res);
  if (!senior) return;
  const { type } = req.query;
  if (type !== undefined && !isVitalType(type)) {
    res.status(400).json({ error: `Unknown vital type: ${String(type)}` });
    return;
  }
  res.json(store.getReadings(senior.id, type, parseLimit(req.query.limit, 100, 1000)));
});

dashboardRouter.post("/seniors/:id/readings", (req, res) => {
  const senior = requireSenior(req, res);
  if (!senior) return;
  const { type, value } = req.body ?? {};
  if (!isVitalType(type) || typeof value !== "number" || !Number.isFinite(value)) {
    res.status(400).json({ error: "Body must be { type: <vital type>, value: <number> }" });
    return;
  }
  res.status(201).json(recordReading({ seniorId: senior.id, type, value, source: "manual" }));
});

dashboardRouter.get("/seniors/:id/alerts", (req, res) => {
  const senior = requireSenior(req, res);
  if (senior) res.json(store.getAlerts([senior.id], parseLimit(req.query.limit, 50, 500)));
});

dashboardRouter.get("/alerts", (req, res) => {
  const ids = store.seniorsFor(currentUserId(res)).map((s) => s.id);
  res.json(store.getAlerts(ids, parseLimit(req.query.limit, 50, 500)));
});

dashboardRouter.patch("/alerts/:id/ack", (req, res) => {
  const userId = currentUserId(res);
  const alert = store.findAlert(req.params.id);
  if (!alert || !store.canAccess(userId, alert.seniorId)) {
    res.status(404).json({ error: "Alert not found" });
    return;
  }
  alert.acknowledgedAt ??= new Date().toISOString();
  alert.acknowledgedBy ??= userId;
  res.json(alert);
});

/** Server-Sent Events: pushes `reading` and `alert` events for seniors this user can see. */
dashboardRouter.get("/stream", (req, res) => {
  const userId = currentUserId(res);
  const onlySenior = typeof req.query.seniorId === "string" ? req.query.seniorId : undefined;
  const wants = (seniorId: string) =>
    store.canAccess(userId, seniorId) && (!onlySenior || onlySenior === seniorId);

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const onReading = (reading: Reading) => wants(reading.seniorId) && send("reading", reading);
  const onAlert = (alert: Alert) => wants(alert.seniorId) && send("alert", alert);

  bus.on("reading", onReading);
  bus.on("alert", onAlert);
  // Comment lines keep proxies from closing an idle connection.
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    bus.off("reading", onReading);
    bus.off("alert", onAlert);
  });
});
