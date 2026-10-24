import { createApp } from "./app.js";
import { config } from "./config.js";
import { seed } from "./data/seed.js";
import { startSimulator } from "./services/simulator.js";

seed();
startSimulator(config.simulatorIntervalMs);

createApp().listen(config.port, () => {
  console.log(`Backend listening on http://localhost:${config.port}`);
});
