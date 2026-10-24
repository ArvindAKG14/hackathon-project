// Apple HealthKit is on-device only. The iOS companion app reads HKQuantitySamples and
// posts one entry per sample in this shape:
//   { uuid, type: "HKQuantityTypeIdentifierHeartRate", value: 72, unit: "count/min", startDate }
// where `unit` is the HKUnit's unitString.
import type { VitalType } from "../types.js";
import type { Adapter, NormalizedSample } from "./types.js";
import {
  asRecord,
  fahrenheitToCelsius,
  finiteNumber,
  isoTime,
  MMOL_TO_MG_DL,
  nonEmptyString,
} from "./normalize.js";

const TYPES = new Map<string, VitalType>([
  ["HKQuantityTypeIdentifierHeartRate", "heart_rate"],
  ["HKQuantityTypeIdentifierBloodPressureSystolic", "bp_systolic"],
  ["HKQuantityTypeIdentifierBloodPressureDiastolic", "bp_diastolic"],
  ["HKQuantityTypeIdentifierOxygenSaturation", "spo2"],
  ["HKQuantityTypeIdentifierBodyTemperature", "temperature"],
  ["HKQuantityTypeIdentifierBloodGlucose", "glucose"],
]);

/** Returns the value in our canonical unit, or undefined for a unit we don't accept. */
function toCanonical(type: VitalType, value: number, unit: string): number | undefined {
  switch (type) {
    case "heart_rate":
      return unit === "count/min" ? value : undefined;
    case "bp_systolic":
    case "bp_diastolic":
      return unit === "mmHg" ? value : undefined;
    case "spo2":
      return unit === "%" ? value * 100 : undefined; // HealthKit percent is a 0–1 fraction
    case "temperature":
      if (unit === "degC") return value;
      return unit === "degF" ? fahrenheitToCelsius(value) : undefined;
    case "glucose":
      if (unit === "mg/dL") return value;
      return unit.startsWith("mmol") ? value * MMOL_TO_MG_DL : undefined; // e.g. "mmol<180.15588000005408>/L"
  }
}

export const healthKitAdapter: Adapter = (raw) => {
  const samples: NormalizedSample[] = [];
  let skipped = 0;

  for (const item of raw) {
    const s = asRecord(item);
    const type = typeof s.type === "string" ? TYPES.get(s.type) : undefined;
    const id = nonEmptyString(s.uuid);
    const value = finiteNumber(s.value);
    const unit = nonEmptyString(s.unit);
    const recordedAt = isoTime(s.startDate);
    const canonical = type && value !== undefined && unit ? toCanonical(type, value, unit) : undefined;

    if (!type || !id || !recordedAt || canonical === undefined) {
      skipped++;
      continue;
    }
    samples.push({ externalId: id, type, value: canonical, recordedAt });
  }

  return { samples, skipped };
};
