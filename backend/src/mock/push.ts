// Stands in for the iOS / Android companion apps until they exist.
//
// Emits payloads in each platform's NATIVE shape -- HealthKit unit strings,
// Health Connect record types -- and posts them through the real /api/devices
// endpoints, so the adapters, the pairing flow and the database writes are all
// exercised. Nothing here bypasses the server.
//
//   npm run mock:push                          # healthkit, last 6 hours
//   npm run mock:push -- --platform health_connect --hours 24
//   npm run mock:push                          # run twice to see dedupe work
//
// External ids are derived from the sample's timestamp and type, and every
// timestamp is snapped to a grid, so re-running stores almost nothing: only
// the handful of samples at the moving leading edge of the window are new.
// Sleep and the deliberate breaches are snapped to the hour, so repeat runs
// within the same hour add none of them.
import type { Platform } from "../integrations/index.js";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4000";
const USER_ID = process.env.MOCK_USER_ID ?? "u1";
const SENIOR_ID = process.env.MOCK_SENIOR_ID ?? "s1";
const BATCH_SIZE = 500;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const platform = arg("platform", "healthkit") as Platform;
const hours = Number(arg("hours", "6"));

if (platform !== "healthkit" && platform !== "health_connect") {
  console.error("--platform must be 'healthkit' or 'health_connect'");
  process.exit(1);
}

const iso = (ms: number) => new Date(ms).toISOString();
const id = (kind: string, ms: number) => `mock-${platform}-${kind}-${ms}`;
/** Deterministic jitter, so repeat runs produce identical values. */
const wobble = (ms: number, spread: number) => ((Math.sin(ms / 60_000) + 1) / 2) * spread;

/** Heart rate follows a daily curve; hour is UTC, which is fine for a demo. */
function restingCurve(ms: number): number {
  const hour = new Date(ms).getUTCHours();
  if (hour < 6) return 56;
  if (hour < 9) return 70;
  if (hour < 12) return 77;
  if (hour < 14) return 73;
  if (hour < 18) return 80;
  if (hour < 22) return 71;
  return 61;
}

const now = Date.now();
const start = now - hours * 3_600_000;

// Anything not on a generated grid is anchored here instead of to `now`, so its
// external id is stable across runs within the hour and re-pushing is a no-op.
const hourStart = Math.floor(now / 3_600_000) * 3_600_000;
/** Off-grid by 90s so a breach is visibly its own point on a chart. */
const breachAt = hourStart - 90_000;

/** Timestamps every `minutes` across the window. */
function grid(minutes: number): number[] {
  const step = minutes * 60_000;
  const out: number[] = [];
  for (let t = Math.ceil(start / step) * step; t <= now; t += step) out.push(t);
  return out;
}

function healthKitSamples(): unknown[] {
  const out: unknown[] = [];

  for (const t of grid(3)) {
    out.push({
      uuid: id("hr", t),
      type: "HKQuantityTypeIdentifierHeartRate",
      value: Math.round(restingCurve(t) + wobble(t, 6) - 3),
      unit: "count/min",
      startDate: iso(t),
    });
  }

  for (const t of grid(15)) {
    out.push({
      // HealthKit reports oxygen saturation as a 0–1 fraction, not a percentage.
      uuid: id("spo2", t),
      type: "HKQuantityTypeIdentifierOxygenSaturation",
      value: 0.95 + wobble(t, 0.04),
      unit: "%",
      startDate: iso(t),
    });
    // Interval metrics carry their own span.
    const steps = Math.round(40 + wobble(t, 300));
    out.push({
      uuid: id("steps", t),
      type: "HKQuantityTypeIdentifierStepCount",
      value: steps,
      unit: "count",
      startDate: iso(t - 15 * 60_000),
      endDate: iso(t),
    });
    out.push({
      uuid: id("dist", t),
      type: "HKQuantityTypeIdentifierDistanceWalkingRunning",
      value: Number((steps * 0.00072).toFixed(4)),
      unit: "km", // exercises the km -> m conversion
      startDate: iso(t - 15 * 60_000),
      endDate: iso(t),
    });
    out.push({
      uuid: id("cal", t),
      type: "HKQuantityTypeIdentifierActiveEnergyBurned",
      value: Number((steps * 0.042).toFixed(2)),
      unit: "kcal",
      startDate: iso(t - 15 * 60_000),
      endDate: iso(t),
    });
  }

  for (const t of grid(30)) {
    out.push({
      uuid: id("rr", t),
      type: "HKQuantityTypeIdentifierRespiratoryRate",
      value: Math.round(14 + wobble(t, 4)),
      unit: "count/min",
      startDate: iso(t),
    });
  }

  for (const t of grid(60)) {
    out.push({
      uuid: id("temp", t),
      type: "HKQuantityTypeIdentifierBodyTemperature",
      value: Number((97.7 + wobble(t, 1.1)).toFixed(1)),
      unit: "degF", // exercises the Fahrenheit conversion
      startDate: iso(t),
    });
    out.push({
      uuid: id("flights", t),
      type: "HKQuantityTypeIdentifierFlightsClimbed",
      value: Math.round(wobble(t, 3)),
      unit: "count",
      startDate: iso(t - 3_600_000),
      endDate: iso(t),
    });
    out.push({
      uuid: id("exercise", t),
      type: "HKQuantityTypeIdentifierAppleExerciseTime",
      value: Math.round(wobble(t, 12)),
      unit: "min",
      startDate: iso(t - 3_600_000),
      endDate: iso(t),
    });
    // Systolic and diastolic share a timestamp: that is how persist.ts re-pairs
    // them into one blood_pressure_readings row.
    out.push({
      uuid: id("bp-sys", t),
      type: "HKQuantityTypeIdentifierBloodPressureSystolic",
      value: Math.round(128 + wobble(t, 12)),
      unit: "mmHg",
      startDate: iso(t),
    });
    out.push({
      uuid: id("bp-dia", t),
      type: "HKQuantityTypeIdentifierBloodPressureDiastolic",
      value: Math.round(76 + wobble(t, 8)),
      unit: "mmHg",
      startDate: iso(t),
    });
    out.push({
      uuid: id("glucose", t),
      type: "HKQuantityTypeIdentifierBloodGlucose",
      value: Number((5.1 + wobble(t, 1.4)).toFixed(2)),
      unit: "mmol<180.15588000005408>/L", // the real HKUnit string
      startDate: iso(t),
    });
    out.push({
      uuid: id("weight", t),
      type: "HKQuantityTypeIdentifierBodyMass",
      value: Number((136 + wobble(t, 1.5)).toFixed(1)),
      unit: "lb", // exercises the pound conversion
      startDate: iso(t),
    });
    out.push({
      uuid: id("rhr", t),
      type: "HKQuantityTypeIdentifierRestingHeartRate",
      value: Math.round(56 + wobble(t, 6)),
      unit: "count/min",
      startDate: iso(t),
    });
  }

  // One night of sleep, grouped on-device from HKCategoryTypeIdentifierSleepAnalysis.
  const sleepEnd = hourStart - 3_600_000;
  const sleepStart = sleepEnd - 7 * 3_600_000;
  out.push({
    uuid: id("sleep", sleepStart),
    type: "HKCategoryTypeIdentifierSleepAnalysis",
    startDate: iso(sleepStart),
    endDate: iso(sleepEnd),
    stages: [
      { value: 3, startDate: iso(sleepStart), endDate: iso(sleepStart + 2 * 3_600_000) }, // core
      { value: 4, startDate: iso(sleepStart + 2 * 3_600_000), endDate: iso(sleepStart + 3.5 * 3_600_000) }, // deep
      { value: 5, startDate: iso(sleepStart + 3.5 * 3_600_000), endDate: iso(sleepStart + 5 * 3_600_000) }, // REM
      { value: 2, startDate: iso(sleepStart + 5 * 3_600_000), endDate: iso(sleepStart + 5.4 * 3_600_000) }, // awake
      { value: 3, startDate: iso(sleepStart + 5.4 * 3_600_000), endDate: iso(sleepEnd) },
    ],
  });

  // A deliberate breach, so the alerts table gets something to show.
  out.push({
    uuid: id("hr-spike", breachAt),
    type: "HKQuantityTypeIdentifierHeartRate",
    value: 145,
    unit: "count/min",
    startDate: iso(breachAt),
  });

  return out;
}

function healthConnectSamples(): unknown[] {
  const out: unknown[] = [];

  for (const t of grid(3)) {
    out.push({
      id: id("hr", t),
      recordType: "HeartRate",
      time: iso(t),
      beatsPerMinute: Math.round(restingCurve(t) + wobble(t, 6) - 3),
    });
  }

  for (const t of grid(15)) {
    out.push({
      // Health Connect reports a percentage, not a fraction.
      id: id("spo2", t),
      recordType: "OxygenSaturation",
      time: iso(t),
      percentage: Number((95 + wobble(t, 4)).toFixed(1)),
    });
    const steps = Math.round(40 + wobble(t, 300));
    out.push({
      id: id("steps", t),
      recordType: "Steps",
      startTime: iso(t - 15 * 60_000),
      endTime: iso(t),
      count: steps,
    });
    out.push({
      id: id("dist", t),
      recordType: "Distance",
      startTime: iso(t - 15 * 60_000),
      endTime: iso(t),
      distanceMeters: Number((steps * 0.72).toFixed(2)),
    });
    out.push({
      id: id("cal", t),
      recordType: "ActiveCaloriesBurned",
      startTime: iso(t - 15 * 60_000),
      endTime: iso(t),
      energyKcal: Number((steps * 0.042).toFixed(2)),
    });
  }

  for (const t of grid(30)) {
    out.push({ id: id("rr", t), recordType: "RespiratoryRate", time: iso(t), rate: Math.round(14 + wobble(t, 4)) });
  }

  for (const t of grid(60)) {
    out.push({
      id: id("temp", t),
      recordType: "BodyTemperature",
      time: iso(t),
      temperature: Number((97.7 + wobble(t, 1.1)).toFixed(1)),
      unit: "fahrenheit",
    });
    out.push({
      id: id("floors", t),
      recordType: "FloorsClimbed",
      startTime: iso(t - 3_600_000),
      endTime: iso(t),
      floors: Math.round(wobble(t, 3)),
    });
    // No "active minutes" record exists; the session's duration is the value.
    out.push({
      id: id("exercise", t),
      recordType: "ExerciseSession",
      startTime: iso(t - Math.round(wobble(t, 12)) * 60_000 - 60_000),
      endTime: iso(t),
    });
    // One record carrying both numbers -- the adapter splits it, persist.ts rejoins it.
    out.push({
      id: id("bp", t),
      recordType: "BloodPressure",
      time: iso(t),
      systolic: Math.round(128 + wobble(t, 12)),
      diastolic: Math.round(76 + wobble(t, 8)),
    });
    out.push({
      id: id("glucose", t),
      recordType: "BloodGlucose",
      time: iso(t),
      level: Number((5.1 + wobble(t, 1.4)).toFixed(2)),
      unit: "mmol/L",
    });
    out.push({ id: id("weight", t), recordType: "Weight", time: iso(t), weightKg: Number((61.8 + wobble(t, 0.7)).toFixed(2)) });
    out.push({
      id: id("rhr", t),
      recordType: "RestingHeartRate",
      time: iso(t),
      beatsPerMinute: Math.round(56 + wobble(t, 6)),
    });
  }

  const sleepEnd = hourStart - 3_600_000;
  const sleepStart = sleepEnd - 7 * 3_600_000;
  out.push({
    id: id("sleep", sleepStart),
    recordType: "SleepSession",
    startTime: iso(sleepStart),
    endTime: iso(sleepEnd),
    stages: [
      { stage: "light", startTime: iso(sleepStart), endTime: iso(sleepStart + 2 * 3_600_000) },
      { stage: "deep", startTime: iso(sleepStart + 2 * 3_600_000), endTime: iso(sleepStart + 3.5 * 3_600_000) },
      { stage: "rem", startTime: iso(sleepStart + 3.5 * 3_600_000), endTime: iso(sleepStart + 5 * 3_600_000) },
      { stage: "awake", startTime: iso(sleepStart + 5 * 3_600_000), endTime: iso(sleepStart + 5.4 * 3_600_000) },
      { stage: "light", startTime: iso(sleepStart + 5.4 * 3_600_000), endTime: iso(sleepEnd) },
    ],
  });

  out.push({ id: id("spo2-dip", breachAt), recordType: "OxygenSaturation", time: iso(breachAt), percentage: 87 });

  return out;
}

async function post(path: string, body: unknown, headers: Record<string, string>): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

async function main(): Promise<void> {
  console.log(`Pairing a ${platform} device for senior ${SENIOR_ID} at ${BASE_URL}`);

  const { code } = await post(`/api/seniors/${SENIOR_ID}/devices/pairing-code`, {}, { "x-user-id": USER_ID });
  const { token, device } = await post("/api/devices/pair", {
    code,
    platform,
    name: platform === "healthkit" ? "Mock iPhone" : "Mock Galaxy",
  }, {});
  console.log(`Paired device ${device.id}`);

  const samples = platform === "healthkit" ? healthKitSamples() : healthConnectSamples();
  console.log(`Generated ${samples.length} native ${platform} entries over ${hours}h`);

  const totals = { accepted: 0, duplicates: 0, skipped: 0, measurements: 0, bloodPressure: 0, sleep: 0, alerts: 0, unpairedBloodPressure: 0 };
  for (let i = 0; i < samples.length; i += BATCH_SIZE) {
    const batch = samples.slice(i, i + BATCH_SIZE);
    const result = await post("/api/devices/sync", { samples: batch }, { authorization: `Bearer ${token}` });
    totals.accepted += result.accepted;
    totals.duplicates += result.duplicates;
    totals.skipped += result.skipped;
    if (result.stored) {
      totals.measurements += result.stored.measurements;
      totals.bloodPressure += result.stored.bloodPressure;
      totals.sleep += result.stored.sleep;
      totals.alerts += result.stored.alerts;
      totals.unpairedBloodPressure += result.stored.unpairedBloodPressure;
    }
    console.log(`  batch ${i / BATCH_SIZE + 1}: ${JSON.stringify(result)}`);
  }

  console.log("\nTotals:", totals);
  if (totals.skipped > 0) console.log(`Note: ${totals.skipped} entries were skipped (unknown type or unit).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
