// Apple HealthKit is on-device only. The iOS companion app reads HKSamples and
// posts one entry per sample.
//
// Quantity samples (point metrics):
//   { uuid, type: "HKQuantityTypeIdentifierHeartRate", value: 72, unit: "count/min", startDate }
// Quantity samples (interval metrics -- steps, distance, energy, exercise, flights):
//   { uuid, type: "HKQuantityTypeIdentifierStepCount", value: 240, unit: "count", startDate, endDate }
// Sleep, grouped on-device from HKCategoryTypeIdentifierSleepAnalysis samples:
//   { uuid, type: "HKCategoryTypeIdentifierSleepAnalysis", startDate, endDate,
//     stages: [{ value: 4, startDate, endDate }] }
//   where `value` is HKCategoryValueSleepAnalysis.
//
// `unit` is the HKUnit's unitString throughout.
import type { MetricType } from "../types.js";
import { INTERVAL_METRICS } from "../types.js";
import type { Adapter, NormalizedSample, NormalizedSleepSession } from "./types.js";
import {
  asRecord,
  fahrenheitToCelsius,
  finiteNumber,
  FT_TO_M,
  isoTime,
  LB_TO_KG,
  MI_TO_M,
  MMOL_TO_MG_DL,
  nonEmptyString,
  type SleepBucket,
  type StageSpan,
  summarizeSleep,
} from "./normalize.js";

const SLEEP_TYPE = "HKCategoryTypeIdentifierSleepAnalysis";

const TYPES = new Map<string, MetricType>([
  ["HKQuantityTypeIdentifierHeartRate", "heart_rate"],
  ["HKQuantityTypeIdentifierRestingHeartRate", "resting_heart_rate"],
  ["HKQuantityTypeIdentifierOxygenSaturation", "spo2"],
  ["HKQuantityTypeIdentifierBodyTemperature", "body_temperature"],
  ["HKQuantityTypeIdentifierRespiratoryRate", "respiratory_rate"],
  ["HKQuantityTypeIdentifierStepCount", "steps"],
  ["HKQuantityTypeIdentifierDistanceWalkingRunning", "distance"],
  ["HKQuantityTypeIdentifierActiveEnergyBurned", "calories_burned"],
  ["HKQuantityTypeIdentifierAppleExerciseTime", "active_minutes"],
  ["HKQuantityTypeIdentifierFlightsClimbed", "floors_climbed"],
  ["HKQuantityTypeIdentifierBodyMass", "weight"],
  ["HKQuantityTypeIdentifierBloodGlucose", "blood_glucose"],
  ["HKQuantityTypeIdentifierBloodPressureSystolic", "blood_pressure_systolic"],
  ["HKQuantityTypeIdentifierBloodPressureDiastolic", "blood_pressure_diastolic"],
]);

// HKCategoryValueSleepAnalysis. 0 (inBed) tells us nothing about sleep quality,
// so it only contributes to the session bounds.
const SLEEP_STAGES = new Map<number, SleepBucket>([
  [0, "ignore"], // inBed
  [1, "light"], // asleepUnspecified -- the pre-iOS 16 value
  [2, "awake"],
  [3, "light"], // asleepCore
  [4, "deep"],
  [5, "rem"],
]);

/** Returns the value in our canonical unit, or undefined for a unit we don't accept. */
function toCanonical(type: MetricType, value: number, unit: string): number | undefined {
  switch (type) {
    case "heart_rate":
    case "resting_heart_rate":
    case "respiratory_rate":
      return unit === "count/min" ? value : undefined;
    case "blood_pressure_systolic":
    case "blood_pressure_diastolic":
      return unit === "mmHg" ? value : undefined;
    case "spo2":
      return unit === "%" ? value * 100 : undefined; // HealthKit percent is a 0–1 fraction
    case "body_temperature":
      if (unit === "degC") return value;
      return unit === "degF" ? fahrenheitToCelsius(value) : undefined;
    case "blood_glucose":
      if (unit === "mg/dL") return value;
      return unit.startsWith("mmol") ? value * MMOL_TO_MG_DL : undefined; // e.g. "mmol<180.15588000005408>/L"
    case "steps":
    case "floors_climbed":
      return unit === "count" ? value : undefined;
    case "distance":
      if (unit === "m") return value;
      if (unit === "km") return value * 1000;
      if (unit === "mi") return value * MI_TO_M;
      return unit === "ft" ? value * FT_TO_M : undefined;
    case "calories_burned":
      if (unit === "kcal" || unit === "Cal") return value;
      return unit === "cal" ? value / 1000 : undefined;
    case "active_minutes":
      if (unit === "min") return value;
      if (unit === "s") return value / 60;
      return unit === "hr" ? value * 60 : undefined;
    case "weight":
      if (unit === "kg") return value;
      if (unit === "lb") return value * LB_TO_KG;
      return unit === "g" ? value / 1000 : undefined;
  }
}

function toSleepSession(s: Record<string, unknown>): NormalizedSleepSession | undefined {
  const id = nonEmptyString(s.uuid);
  const startedAt = isoTime(s.startDate);
  const endedAt = isoTime(s.endDate);
  if (!id || !startedAt || !endedAt) return undefined;

  const spans: StageSpan[] = [];
  for (const entry of Array.isArray(s.stages) ? s.stages : []) {
    const stage = asRecord(entry);
    const value = finiteNumber(stage.value);
    const start = isoTime(stage.startDate);
    const end = isoTime(stage.endDate);
    const bucket = value === undefined ? undefined : SLEEP_STAGES.get(value);
    if (bucket && start && end) spans.push({ bucket, start, end });
  }

  return summarizeSleep(id, startedAt, endedAt, spans);
}

export const healthKitAdapter: Adapter = (raw) => {
  const samples: NormalizedSample[] = [];
  const sleepSessions: NormalizedSleepSession[] = [];
  let skipped = 0;

  for (const item of raw) {
    const s = asRecord(item);

    if (s.type === SLEEP_TYPE) {
      const session = toSleepSession(s);
      if (session) sleepSessions.push(session);
      else skipped++;
      continue;
    }

    const type = typeof s.type === "string" ? TYPES.get(s.type) : undefined;
    const id = nonEmptyString(s.uuid);
    const value = finiteNumber(s.value);
    const unit = nonEmptyString(s.unit);
    const startDate = isoTime(s.startDate);
    const canonical = type && value !== undefined && unit ? toCanonical(type, value, unit) : undefined;

    if (!type || !id || !startDate || canonical === undefined) {
      skipped++;
      continue;
    }

    if (INTERVAL_METRICS.has(type)) {
      // An interval sample covers a span. endDate is required: without it we
      // cannot tell a 15-minute bucket of steps from an instantaneous one, and
      // summing ambiguous rows is how step counts end up wrong.
      const endDate = isoTime(s.endDate);
      if (!endDate || endDate < startDate) {
        skipped++;
        continue;
      }
      samples.push({
        externalId: id,
        type,
        value: canonical,
        recordedAt: endDate,
        periodStart: startDate,
        periodEnd: endDate,
      });
      continue;
    }

    samples.push({ externalId: id, type, value: canonical, recordedAt: startDate });
  }

  return { samples, sleepSessions, skipped };
};
