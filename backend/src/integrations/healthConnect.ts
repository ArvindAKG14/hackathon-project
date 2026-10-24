// Android Health Connect is on-device only. The Android companion app reads records and
// posts them in this simplified shape (`id` is the record's metadata.id):
//   { id, recordType: "HeartRate",        time, beatsPerMinute }
//   { id, recordType: "BloodPressure",    time, systolic, diastolic }       // mmHg
//   { id, recordType: "OxygenSaturation", time, percentage }                // 0–100
//   { id, recordType: "BodyTemperature",  time, temperature, unit?: "celsius" | "fahrenheit" }
//   { id, recordType: "BloodGlucose",     time, level, unit: "mg/dL" | "mmol/L" }
// A HeartRateRecord holds many samples: send one entry per sample, with id `${metadata.id}:${index}`.
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

/** [id suffix, vital, value in canonical units]; one record can yield several vitals. */
type Part = [string, VitalType, number | undefined];

function toParts(r: Record<string, unknown>): Part[] | undefined {
  switch (r.recordType) {
    case "HeartRate":
      return [["", "heart_rate", finiteNumber(r.beatsPerMinute)]];
    case "BloodPressure":
      return [
        [":sys", "bp_systolic", finiteNumber(r.systolic)],
        [":dia", "bp_diastolic", finiteNumber(r.diastolic)],
      ];
    case "OxygenSaturation":
      return [["", "spo2", finiteNumber(r.percentage)]];
    case "BodyTemperature": {
      const t = finiteNumber(r.temperature);
      return [["", "temperature", t !== undefined && r.unit === "fahrenheit" ? fahrenheitToCelsius(t) : t]];
    }
    case "BloodGlucose": {
      const level = finiteNumber(r.level);
      const factor = r.unit === "mmol/L" ? MMOL_TO_MG_DL : r.unit === "mg/dL" ? 1 : undefined;
      return [["", "glucose", level !== undefined && factor ? level * factor : undefined]];
    }
    default:
      return undefined;
  }
}

export const healthConnectAdapter: Adapter = (raw) => {
  const samples: NormalizedSample[] = [];
  let skipped = 0;

  for (const item of raw) {
    const r = asRecord(item);
    const id = nonEmptyString(r.id);
    const recordedAt = isoTime(r.time);
    const parts = toParts(r);

    if (!id || !recordedAt || !parts || parts.some(([, , value]) => value === undefined)) {
      skipped++;
      continue;
    }
    for (const [suffix, type, value] of parts) {
      samples.push({ externalId: id + suffix, type, value: value!, recordedAt });
    }
  }

  return { samples, skipped };
};
