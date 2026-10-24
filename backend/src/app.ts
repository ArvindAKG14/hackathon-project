import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { config } from "./config.js";
import { requireUser } from "./middleware/auth.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { deviceManagementRouter, deviceRouter } from "./routes/devices.js";

export function createApp() {
  const app = express();

  app.use(cors({ origin: config.frontendUrl }));
  app.use(express.json({ limit: "1mb" })); // phone syncs can carry up to 1000 samples

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Phones authenticate with device tokens, so this goes before user auth.
  app.use("/api/devices", deviceRouter);
  app.use("/api", requireUser, dashboardRouter, deviceManagementRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // Errors like malformed JSON carry a 4xx status; anything else is our bug.
    const status = (err as { status?: number }).status;
    if (status && status >= 400 && status < 500) {
      res.status(status).json({ error: (err as Error).message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
