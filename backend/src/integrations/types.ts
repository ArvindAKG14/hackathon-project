import type { VitalType } from "../types.js";

export type Platform = "healthkit" | "health_connect";

/** A platform sample converted to our vital types and canonical units. */
export interface NormalizedSample {
  /** The platform's own sample ID, used to drop duplicates when a phone re-sends data. */
  externalId: string;
  type: VitalType;
  value: number;
  recordedAt: string;
}

export interface AdapterResult {
  samples: NormalizedSample[];
  /** Entries that were malformed or of a type/unit we don't track. */
  skipped: number;
}

/** Converts a phone's raw upload (untrusted JSON) into normalized samples. */
export type Adapter = (raw: unknown[]) => AdapterResult;
