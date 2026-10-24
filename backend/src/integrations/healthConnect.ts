// Android Health Connect is on-device only. The Android companion app reads records and
// posts them in this simplified shape (`id` is the record's metadata.id):
//   { id, recordType: "HeartRate",         time, beatsPerMinute }
//   { id, recordType: "RestingHeartRate",  time, beatsPerMinute }
//   { id, recordType: "BloodPressure",     time, systolic, diastolic }       // mmHg
//   { id, recordType: "OxygenSaturation",  time, percentage }                // 0–100
//   { id, recordType: "BodyTemperature",   time, temperature, unit?: "celsius" | "fahrenheit" }
//   { id, recordType: "RespiratoryRate",   time, rate }
//   { id, recordType: "BloodGlucose",      time, level, unit: "mg/dL" | "mmol/L" }
//   { id, recordType: "Weight",            time, weightKg }
// Interval records carry their own span:
//   { id, recordType: "Steps",                startTime, endTime, count }
//   { id, recordType: "Distance",             startTime, endTime, distanceMeters }
//   { id, recordType: "ActiveCaloriesBurned", startTime, endTime, energyKcal }
//   { id, recordType: "FloorsClimbed",        startTime, endTime, floors }
//   { id, recordType: "ExerciseSession",      startTime, endTime }           // duration = active minutes
//   { id, recordType: "SleepSession",         startTime, endTime,
//     stages: [{ stage: "deep" | "light" | "rem" | "awake" | ..., startTime, endTime }] }
//
// A HeartRateRecord holds many samples: send one entry per sample, with id `${metadata.id}:${index}`.
import type { MetricType } from "../types.js";
import type { Adapter, NormalizedSample, NormalizedSleepSession } from "./types.js";
import {
  asRecord,
  fahrenheitToCelsius,
  finiteNumber,
  isoTime,
  MMOL_TO_MG_DL,
  nonEmptyString,
  type SleepBucket,
  type StageSpan,
  summarizeSleep,
} from "./normalize.js";

/** [id suffix, metric, value in canonical units]; one record can yield several metrics. */
type Part = [string, MetricType, number | undefined];

// Health Connect's SleepSessionRecord.Stage types, as the companion app serializes
// them. Numeric constants are accepted too, since the SDK exposes ints.
const SLEEP_STAGES = new Map<string, SleepBucket>([
  ["unknown", "ignore"],
  ["awake", "awake"],
  ["sleeping", "light"], // generic "asleep" with no finer detail
  ["outofbed", "ignore"],
  ["light", "light"],
  ["deep", "deep"],
  ["rem", "rem"],
  ["awakeinbed", "awake"],
  ["0", "ignore"],
  ["1", "awake"],
  ["2", "light"],
  ["3", "ignore"],
  ["4", "light"],
  ["5", "deep"],
  ["6", "rem"],
  ["7", "awake"],
]);

function toParts(r: Record<string, unknown>): Part[] | undefined {
  switch (r.recordType) {
    case "HeartRate":
      return [["", "heart_rate", finiteNumber(r.beatsPerMinute)]];
    case "RestingHeartRate":
      return [["", "resting_heart_rate", finiteNumber(r.beatsPerMinute)]];
    case "BloodPressure":
      return [
        [":sys", "blood_pressure_systolic", finiteNumber(r.systolic)],
        [":dia", "blood_pressure_diastolic", finiteNumber(r.diastolic)],
      ];
    case "OxygenSaturation":
      return [["", "spo2", finiteNumber(r.percentage)]];
    case "RespiratoryRate":
      return [["", "respiratory_rate", finiteNumber(r.rate)]];
    case "BodyTemperature": {
      const t = finiteNumber(r.temperature);
      return [["", "body_temperature", t !== undefined && r.unit === "fahrenheit" ? fahrenheitToCelsius(t) : t]];
    }
    case "BloodGlucose": {
      const level = finiteNumber(r.level);
      const factor = r.unit === "mmol/L" ? MMOL_TO_MG_DL : r.unit === "mg/dL" ? 1 : undefined;
      return [["", "blood_glucose", level !== undefined && factor ? level * factor : undefined]];
    }
    case "Weight":
      return [["", "weight", finiteNumber(r.weightKg)]];
    default:
      return undefined;
  }
}

/** Interval records: [metric, value]. Their span comes from startTime/endTime. */
function toIntervalPart(r: Record<string, unknown>, minutes: number): [MetricType, number | undefined] | undefined {
  switch (r.recordType) {
    case "Steps":
      return ["steps", finiteNumber(r.count)];
    case "Distance":
      return ["distance", finiteNumber(r.distanceMeters)];
    case "ActiveCaloriesBurned":
      return ["calories_burned", finiteNumber(r.energyKcal)];
    case "FloorsClimbed":
      return ["floors_climbed", finiteNumber(r.floors)];
    case "ExerciseSession":
      // Health Connect has no "active minutes" record; the session's duration is it.
      return ["active_minutes", minutes];
    default:
      return undefined;
  }
}

function toSleepSession(r: Record<string, unknown>): NormalizedSleepSession | undefined {
  const id = nonEmptyString(r.id);
  const startedAt = isoTime(r.startTime);
  const endedAt = isoTime(r.endTime);
  if (!id || !startedAt || !endedAt) return undefined;

  const spans: StageSpan[] = [];
  for (const entry of Array.isArray(r.stages) ? r.stages : []) {
    const stage = asRecord(entry);
    const key = typeof stage.stage === "number" ? String(stage.stage) : nonEmptyString(stage.stage)?.toLowerCase();
    const bucket = key ? SLEEP_STAGES.get(key) : undefined;
    const start = isoTime(stage.startTime);
    const end = isoTime(stage.endTime);
    if (bucket && start && end) spans.push({ bucket, start, end });
  }

  return summarizeSleep(id, startedAt, endedAt, spans);
}

export const healthConnectAdapter: Adapter = (raw) => {
  const samples: NormalizedSample[] = [];
  const sleepSessions: NormalizedSleepSession[] = [];
  let skipped = 0;

  for (const item of raw) {
    const r = asRecord(item);
    const id = nonEmptyString(r.id);

    if (r.recordType === "SleepSession") {
      const session = toSleepSession(r);
      if (session) sleepSessions.push(session);
      else skipped++;
      continue;
    }

    // Interval records carry startTime/endTime instead of a single time.
    const startTime = isoTime(r.startTime);
    const endTime = isoTime(r.endTime);
    if (startTime && endTime) {
      const minutes = (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60_000;
      const part = toIntervalPart(r, minutes);
      if (!id || !part || part[1] === undefined || endTime < startTime) {
        skipped++;
        continue;
      }
      samples.push({
        externalId: id,
        type: part[0],
        value: part[1],
        recordedAt: endTime,
        periodStart: startTime,
        periodEnd: endTime,
      });
      continue;
    }

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

  return { samples, sleepSessions, skipped };
};
