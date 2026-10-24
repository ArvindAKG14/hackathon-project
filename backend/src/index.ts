import { createApp } from "./app.js";
import { config } from "./config.js";
import { seed } from "./data/seed.js";
import { checkConnection, databaseEnabled } from "./db/pool.js";
import { startSimulator } from "./services/simulator.js";

seed();
startSimulator(config.simulatorIntervalMs);

// Fail loudly at startup rather than on the first device sync.
if (databaseEnabled) {
  const version = await checkConnection();
  console.log(`Persisting device syncs to ${version?.split(" ").slice(0, 2).join(" ") ?? "Postgres"}`);
} else {
  console.log("No DATABASE_URL set; device syncs stay in memory only");
}

createApp().listen(config.port, () => {
  console.log(`Backend listening on http://localhost:${config.port}`);
});
