import { createApp } from "./app.js";
import { config } from "./config.js";
import { seed } from "./data/seed.js";
import { seedFromDatabase } from "./data/seedFromDb.js";
import { checkConnection, databaseEnabled } from "./db/pool.js";
import { startSimulator } from "./services/simulator.js";

// Fail loudly at startup rather than on the first device sync.
if (databaseEnabled) {
  const version = await checkConnection();
  console.log(`Connected to ${version?.split(" ").slice(0, 2).join(" ") ?? "Postgres"}`);
} else {
  console.log("No DATABASE_URL set; running on in-memory demo data only");
}

// With a database, identities come from it, so the API and the web app agree
// on who exists. Without one, the hardcoded demo seniors keep the API usable.
const fromDatabase = await seedFromDatabase();
if (!fromDatabase) seed();

// The simulator invents vitals every couple of seconds. That is fine for the
// demo seed, but against real seniors it would write fake readings into the
// in-memory store that do not exist in the database -- the live view and the
// stored history would quietly disagree. Set SIMULATOR=on to force it anyway.
if (!fromDatabase || config.simulator === "on") {
  startSimulator(config.simulatorIntervalMs);
  if (fromDatabase) console.log("Simulator forced on against database-backed seniors");
} else {
  console.log("Simulator off: live readings come from device syncs (SIMULATOR=on overrides)");
}

createApp().listen(config.port, () => {
  console.log(`Backend listening on http://localhost:${config.port}`);
});
