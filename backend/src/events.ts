import { EventEmitter } from "node:events";
import type { Alert, Reading } from "./types.js";

type BusEvents = {
  reading: [Reading];
  alert: [Alert];
};

/** In-process pub/sub that feeds the live stream. */
export const bus = new EventEmitter<BusEvents>();
bus.setMaxListeners(0); // one listener pair per open dashboard
