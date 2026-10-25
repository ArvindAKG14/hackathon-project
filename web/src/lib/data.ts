import "server-only";
import { db } from "./supabase";

// Data access layer. Every function that returns a senior's data takes the
// signed-in caregiver's id and checks caregiver_links first, as the schema's
// README requires (there is no row-level security to fall back on).

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

export type Severity = "info" | "warning" | "critical";

export type Caregiver = { id: string; full_name: string; email: string | null };

export type LinkedSenior = {
  id: string;
  full_name: string;
  date_of_birth: string | null;
  timezone: string;
  relationship: string | null;
};

export type Alert = {
  id: number;
  metric_type: MetricType;
  severity: Severity;
  message: string;
  triggered_at: string;
  acknowledged_at: string | null;
  acknowledged_by_name: string | null;
};

export type Threshold = { min: number | null; max: number | null; severity: Severity };

export type Latest = { value: number; unit: string; recorded_at: string };

export type SeniorDashboard = {
  /** When this snapshot was taken, so "x min ago" labels all agree */
  now: number;
  senior: LinkedSenior;
  lastSyncAt: string | null;
  latest: Partial<Record<MetricType, Latest>>;
  latestBloodPressure: { systolic: number; diastolic: number; pulse: number | null; recorded_at: string } | null;
  thresholds: Partial<Record<MetricType, Threshold>>;
  openAlerts: Alert[];
  recentAlerts: Alert[];
  heartRateByHour: { hour: string; min: number; avg: number; max: number }[];
  stepsByDay: { date: string; steps: number }[];
  sleep: { night: string; total: number; deep: number; light: number; rem: number; awake: number }[];
  bloodPressure: { recorded_at: string; systolic: number; diastolic: number }[];
};

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`Couldn't load ${what}: ${error?.message ?? "unknown error"}`);
}

/** YYYY-MM-DD for an instant, in the senior's own time zone. */
export function localDate(at: Date | string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
}

// The caregiver lookup that used to live here moved to accounts.ts, which
// creates the row when it is missing instead of returning null.

export async function listLinkedSeniors(caregiverId: string): Promise<LinkedSenior[]> {
  const { data, error } = await db()
    .from("caregiver_links")
    .select(
      "relationship, senior:users!caregiver_links_senior_id_fkey(id, full_name, date_of_birth, timezone)",
    )
    .eq("caregiver_id", caregiverId)
    .eq("status", "accepted");
  if (error) fail("the people you look after", error);
  return data
    .map((row) => {
      const senior = row.senior as unknown as Omit<LinkedSenior, "relationship">;
      return { ...senior, relationship: row.relationship };
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export async function getLinkedSenior(caregiverId: string, seniorId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(seniorId)) return null;
  const seniors = await listLinkedSeniors(caregiverId);
  return seniors.find((s) => s.id === seniorId) ?? null;
}

type AlertRow = Omit<Alert, "acknowledged_by_name"> & {
  acknowledger: { full_name: string } | null;
};

function toAlert(row: AlertRow): Alert {
  const { acknowledger, ...rest } = row;
  return { ...rest, acknowledged_by_name: acknowledger?.full_name ?? null };
}

export async function getSeniorDashboard(
  caregiverId: string,
  seniorId: string,
): Promise<SeniorDashboard | null> {
  const senior = await getLinkedSenior(caregiverId, seniorId);
  if (!senior) return null;

  const tz = senior.timezone;
  const now = Date.now();
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();
  const client = db();
  const alertColumns =
    "id, metric_type, severity, message, triggered_at, acknowledged_at, acknowledger:users!alerts_acknowledged_by_fkey(full_name)";

  const [sources, latest, bpLatest, thresholds, openAlerts, recentAlerts, heartRate, steps, sleep, bp] =
    await Promise.all([
      client.from("data_sources").select("last_sync_at").eq("senior_id", seniorId),
      client.from("latest_measurements").select("metric_type, value, unit, recorded_at").eq("senior_id", seniorId),
      client
        .from("blood_pressure_readings")
        .select("systolic, diastolic, pulse, recorded_at")
        .eq("senior_id", seniorId)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      client
        .from("alert_thresholds")
        .select("metric_type, min_value, max_value, severity")
        .eq("senior_id", seniorId)
        .eq("enabled", true),
      client
        .from("alerts")
        .select(alertColumns)
        .eq("senior_id", seniorId)
        .is("acknowledged_at", null)
        .order("triggered_at", { ascending: false }),
      client
        .from("alerts")
        .select(alertColumns)
        .eq("senior_id", seniorId)
        .not("acknowledged_at", "is", null)
        .order("triggered_at", { ascending: false })
        .limit(6),
      client
        .from("measurements")
        .select("value, recorded_at")
        .eq("senior_id", seniorId)
        .eq("metric_type", "heart_rate")
        .gte("recorded_at", hoursAgo(24))
        .order("recorded_at")
        .limit(1000),
      client
        .from("measurements")
        .select("value, recorded_at")
        .eq("senior_id", seniorId)
        .eq("metric_type", "steps")
        .gte("recorded_at", hoursAgo(24 * 8))
        .limit(1000),
      client
        .from("sleep_sessions")
        .select("started_at, ended_at, total_minutes, deep_minutes, light_minutes, rem_minutes, awake_minutes")
        .eq("senior_id", seniorId)
        .order("started_at", { ascending: false })
        .limit(7),
      client
        .from("blood_pressure_readings")
        .select("systolic, diastolic, recorded_at")
        .eq("senior_id", seniorId)
        .gte("recorded_at", hoursAgo(24 * 7))
        .order("recorded_at"),
    ]);

  for (const [what, res] of Object.entries({
    sources, latest, bpLatest, thresholds, openAlerts, recentAlerts, heartRate, steps, sleep, bp,
  })) {
    if (res.error) fail(what, res.error);
  }

  const lastSyncAt =
    (sources.data ?? [])
      .map((s) => s.last_sync_at as string | null)
      .filter((s): s is string => !!s)
      // By instant, not as text: the database answers in Eastern time, and
      // "-04:00" and "-05:00" strings don't sort chronologically across a DST change.
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
      .at(-1) ?? null;

  const latestByMetric: SeniorDashboard["latest"] = {};
  for (const m of latest.data ?? []) {
    latestByMetric[m.metric_type as MetricType] = {
      value: Number(m.value),
      unit: m.unit,
      recorded_at: m.recorded_at,
    };
  }

  const thresholdByMetric: SeniorDashboard["thresholds"] = {};
  for (const t of thresholds.data ?? []) {
    thresholdByMetric[t.metric_type as MetricType] = {
      min: t.min_value === null ? null : Number(t.min_value),
      max: t.max_value === null ? null : Number(t.max_value),
      severity: t.severity,
    };
  }

  // Heart rate: min / average / max for each hour of the last 24
  const hours = new Map<string, number[]>();
  for (const r of heartRate.data ?? []) {
    const hour = new Date(r.recorded_at);
    hour.setUTCMinutes(0, 0, 0);
    const key = hour.toISOString();
    const bucket = hours.get(key) ?? [];
    bucket.push(Number(r.value));
    hours.set(key, bucket);
  }
  const heartRateByHour = [...hours.entries()].map(([hour, values]) => ({
    hour,
    min: Math.min(...values),
    max: Math.max(...values),
    avg: values.reduce((a, b) => a + b, 0) / values.length,
  }));

  // Steps are interval samples: summing them per local day gives the daily total
  const stepTotals = new Map<string, number>();
  for (const r of steps.data ?? []) {
    const day = localDate(r.recorded_at, tz);
    stepTotals.set(day, (stepTotals.get(day) ?? 0) + Number(r.value));
  }
  const stepsByDay = Array.from({ length: 7 }, (_, i) => {
    const date = localDate(new Date(now - (6 - i) * 86_400_000), tz);
    return { date, steps: Math.round(stepTotals.get(date) ?? 0) };
  });

  return {
    now,
    senior,
    lastSyncAt,
    latest: latestByMetric,
    latestBloodPressure: bpLatest.data,
    thresholds: thresholdByMetric,
    openAlerts: (openAlerts.data as unknown as AlertRow[]).map(toAlert),
    recentAlerts: (recentAlerts.data as unknown as AlertRow[]).map(toAlert),
    heartRateByHour,
    stepsByDay,
    sleep: (sleep.data ?? [])
      .map((s) => ({
        // A night belongs to the date it ended on: "last night" is this morning's date
        night: localDate(s.ended_at, tz),
        total: s.total_minutes,
        deep: s.deep_minutes,
        light: s.light_minutes,
        rem: s.rem_minutes,
        awake: s.awake_minutes,
      }))
      .reverse(),
    bloodPressure: bp.data ?? [],
  };
}

export async function acknowledgeAlert(caregiverId: string, alertId: number) {
  const client = db();
  const { data: alert, error } = await client
    .from("alerts")
    .select("senior_id")
    .eq("id", alertId)
    .maybeSingle();
  if (error) fail("the alert", error);
  if (!alert || !(await getLinkedSenior(caregiverId, alert.senior_id))) return null;

  const { error: updateError } = await client
    .from("alerts")
    .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: caregiverId })
    .eq("id", alertId)
    .is("acknowledged_at", null);
  if (updateError) fail("the alert", updateError);
  return alert.senior_id as string;
}
