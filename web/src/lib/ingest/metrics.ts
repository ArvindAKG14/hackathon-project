import type { MetricType } from "../data";

export type { MetricType };

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
