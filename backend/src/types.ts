/** A vital sign we alert on. Drives the live dashboard and `VITALS` in thresholds.ts. */
export type VitalType =
  | "heart_rate"
  | "bp_systolic"
  | "bp_diastolic"
  | "spo2"
  | "temperature"
  | "glucose";

/**
 * Everything the database can store -- the `metric_type` enum in
 * db/migrations/001. A superset of VitalType: activity metrics like step count
 * are worth recording but meaningless to call "critical", so they are not vitals.
 */
export type MetricType =
  | "heart_rate"
  | "resting_heart_rate"
  | "spo2"
  | "body_temperature"
  | "respiratory_rate"
  | "steps"
  | "distance"
  | "calories_burned"
  | "active_minutes"
  | "floors_climbed"
  | "weight"
  | "blood_glucose"
  | "blood_pressure_systolic"
  | "blood_pressure_diastolic";

/** Canonical unit stored alongside every measurement. */
export const METRIC_UNITS: Record<MetricType, string> = {
  heart_rate: "bpm",
  resting_heart_rate: "bpm",
  spo2: "%",
  body_temperature: "degC",
  respiratory_rate: "breaths/min",
  steps: "count",
  distance: "m",
  calories_burned: "kcal",
  active_minutes: "min",
  floors_climbed: "count",
  weight: "kg",
  blood_glucose: "mg/dL",
  blood_pressure_systolic: "mmHg",
  blood_pressure_diastolic: "mmHg",
};

/**
 * Metrics measured over a span rather than at an instant. Both HealthKit and
 * Health Connect deliver these as interval samples with their own start/end,
 * which become period_start/period_end in the database.
 */
export const INTERVAL_METRICS: ReadonlySet<MetricType> = new Set<MetricType>([
  "steps",
  "distance",
  "calories_burned",
  "active_minutes",
  "floors_climbed",
]);

/** The database name for each alertable vital. */
export const VITAL_TO_METRIC: Record<VitalType, MetricType> = {
  heart_rate: "heart_rate",
  bp_systolic: "blood_pressure_systolic",
  bp_diastolic: "blood_pressure_diastolic",
  spo2: "spo2",
  temperature: "body_temperature",
  glucose: "blood_glucose",
};

const METRIC_TO_VITAL = new Map<MetricType, VitalType>(
  (Object.entries(VITAL_TO_METRIC) as [VitalType, MetricType][]).map(([vital, metric]) => [metric, vital]),
);

/** The live-dashboard vital for a metric, or undefined if we do not alert on it. */
export function vitalFor(metric: MetricType): VitalType | undefined {
  return METRIC_TO_VITAL.get(metric);
}

export type Status = "normal" | "warning" | "critical";

/** Someone who logs in to monitor seniors (relative, caregiver). */
export interface User {
  id: string;
  name: string;
}

export interface Senior {
  id: string;
  name: string;
  age: number;
  conditions: string[];
  emergencyContact: string;
}

export interface Reading {
  id: string;
  seniorId: string;
  type: VitalType;
  value: number;
  unit: string;
  status: Status;
  source: "simulator" | "manual" | "healthkit" | "health_connect";
  recordedAt: string;
}

export interface Alert {
  id: string;
  seniorId: string;
  type: VitalType;
  value: number;
  status: Exclude<Status, "normal">;
  message: string;
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}
