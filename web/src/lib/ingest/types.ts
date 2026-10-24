import type { MetricType } from "./metrics";

export type Platform = "healthkit" | "health_connect";

/** A platform sample converted to our metric types and canonical units. */
export interface NormalizedSample {
  /** The platform's own sample ID, used to drop duplicates when a phone re-sends data. */
  externalId: string;
  type: MetricType;
  value: number;
  recordedAt: string;
  /** Set only for interval metrics (steps, distance, ...); recordedAt is then the period end. */
  periodStart?: string;
  periodEnd?: string;
}

/** A night's sleep. Both platforms report stages, so we keep the breakdown. */
export interface NormalizedSleepSession {
  externalId: string;
  startedAt: string;
  endedAt: string;
  totalMinutes: number;
  deepMinutes: number;
  lightMinutes: number;
  remMinutes: number;
  awakeMinutes: number;
}

export interface AdapterResult {
  samples: NormalizedSample[];
  sleepSessions: NormalizedSleepSession[];
  /** Entries that were malformed or of a type/unit we don't track. */
  skipped: number;
}

/** Converts a phone's raw upload (untrusted JSON) into normalized samples. */
export type Adapter = (raw: unknown[]) => AdapterResult;
