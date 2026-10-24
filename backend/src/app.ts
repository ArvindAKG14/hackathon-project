import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { config } from "./config.js";
import { requireUser } from "./middleware/auth.js";
import { dashboardRouter } from "./routes/dashboard.js";

export function createApp() {
  const app = express();

  app.use(cors({ origin: config.frontendUrl }));
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api", requireUser, dashboardRouter);

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
