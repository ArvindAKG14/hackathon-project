try {
  process.loadEnvFile();
} catch {
  // .env is optional; defaults below apply.
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
  simulatorIntervalMs: Number(process.env.SIMULATOR_INTERVAL_MS ?? 2000),
};
