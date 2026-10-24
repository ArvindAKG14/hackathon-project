import "server-only";
import type { PoolClient } from "pg";
import { pg } from "../pg";
import { METRIC_UNITS, type MetricType } from "./metrics";
import type { NormalizedSample, NormalizedSleepSession } from "./types";

// Writes a device sync into Postgres.
//
// Every write is idempotent: the partial unique indexes in migrations 004 and
// 005 mean a phone can re-send an overlapping window and ON CONFLICT DO
// NOTHING turns it into a no-op. There is no retry bookkeeping in the route.

const BP_METRICS = new Set<MetricType>(["blood_pressure_systolic", "blood_pressure_diastolic"]);

export interface SyncInput {
  seniorId: string;
  dataSourceId: string;
  samples: NormalizedSample[];
  sleepSessions: NormalizedSleepSession[];
}

export interface SyncPersistResult {
  measurements: number;
  bloodPressure: number;
  sleep: number;
  /** Systolic or diastolic readings with no partner at the same instant. */
  unpairedBloodPressure: number;
  alerts: number;
}

async function insertMeasurements(
  client: PoolClient,
  seniorId: string,
  dataSourceId: string,
  samples: NormalizedSample[],
): Promise<number[]> {
  if (samples.length === 0) return [];

  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO measurements
       (senior_id, data_source_id, metric_type, value, unit, recorded_at, period_start, period_end, external_id)
     SELECT $1, $2, s.metric_type::metric_type, s.value, s.unit,
            s.recorded_at, s.period_start, s.period_end, s.external_id
     FROM unnest($3::text[], $4::numeric[], $5::text[], $6::timestamptz[], $7::timestamptz[], $8::timestamptz[], $9::text[])
       AS s(metric_type, value, unit, recorded_at, period_start, period_end, external_id)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      seniorId,
      dataSourceId,
      samples.map((s) => s.type),
      samples.map((s) => s.value),
      samples.map((s) => METRIC_UNITS[s.type]),
      samples.map((s) => s.recordedAt),
      samples.map((s) => s.periodStart ?? null),
      samples.map((s) => s.periodEnd ?? null),
      samples.map((s) => s.externalId),
    ],
  );
  return rows.map((r) => Number(r.id));
}

interface PairedBp {
  systolic: number;
  diastolic: number;
  recordedAt: string;
  externalId: string;
}

/**
 * Re-pairs blood pressure.
 *
 * Both platforms measure systolic and diastolic together -- HealthKit as an
 * HKCorrelation, Health Connect as one BloodPressureRecord -- but both deliver
 * them as separate samples, and blood_pressure_readings wants one row with a
 * systolic > diastolic CHECK. They share a timestamp, so that is the join key.
 *
 * A half that arrives without its partner (the pair split across two batches)
 * is counted and dropped rather than written as an invented reading.
 */
function pairBloodPressure(samples: NormalizedSample[]): { paired: PairedBp[]; unpaired: number } {
  const byInstant = new Map<string, { sys?: NormalizedSample; dia?: NormalizedSample }>();
  for (const sample of samples) {
    const slot = byInstant.get(sample.recordedAt) ?? {};
    if (sample.type === "blood_pressure_systolic") slot.sys = sample;
    else slot.dia = sample;
    byInstant.set(sample.recordedAt, slot);
  }

  const paired: PairedBp[] = [];
  let unpaired = 0;
  for (const [recordedAt, { sys, dia }] of byInstant) {
    if (!sys || !dia) {
      unpaired += sys || dia ? 1 : 0;
      continue;
    }
    // Reject rather than write a row the CHECK would refuse anyway.
    if (sys.value <= dia.value) {
      unpaired += 2;
      continue;
    }
    paired.push({
      systolic: Math.round(sys.value),
      diastolic: Math.round(dia.value),
      recordedAt,
      // Strip the adapter's :sys/:dia suffix so the pair has one stable id.
      externalId: sys.externalId.replace(/:sys$/, ""),
    });
  }
  return { paired, unpaired };
}

async function insertBloodPressure(
  client: PoolClient,
  seniorId: string,
  dataSourceId: string,
  readings: PairedBp[],
): Promise<number[]> {
  if (readings.length === 0) return [];

  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO blood_pressure_readings
       (senior_id, data_source_id, systolic, diastolic, recorded_at, external_id)
     SELECT $1, $2, b.systolic, b.diastolic, b.recorded_at, b.external_id
     FROM unnest($3::int[], $4::int[], $5::timestamptz[], $6::text[])
       AS b(systolic, diastolic, recorded_at, external_id)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      seniorId,
      dataSourceId,
      readings.map((r) => r.systolic),
      readings.map((r) => r.diastolic),
      readings.map((r) => r.recordedAt),
      readings.map((r) => r.externalId),
    ],
  );
  return rows.map((r) => Number(r.id));
}

async function insertSleep(
  client: PoolClient,
  seniorId: string,
  dataSourceId: string,
  sessions: NormalizedSleepSession[],
): Promise<number> {
  if (sessions.length === 0) return 0;

  const { rowCount } = await client.query(
    `INSERT INTO sleep_sessions
       (senior_id, data_source_id, started_at, ended_at, total_minutes,
        deep_minutes, light_minutes, rem_minutes, awake_minutes, external_id)
     SELECT $1, $2, s.started_at, s.ended_at, s.total_minutes,
            s.deep_minutes, s.light_minutes, s.rem_minutes, s.awake_minutes, s.external_id
     FROM unnest($3::timestamptz[], $4::timestamptz[], $5::int[], $6::int[], $7::int[], $8::int[], $9::int[], $10::text[])
       AS s(started_at, ended_at, total_minutes, deep_minutes, light_minutes, rem_minutes, awake_minutes, external_id)
     ON CONFLICT DO NOTHING`,
    [
      seniorId,
      dataSourceId,
      sessions.map((s) => s.startedAt),
      sessions.map((s) => s.endedAt),
      sessions.map((s) => s.totalMinutes),
      sessions.map((s) => s.deepMinutes),
      sessions.map((s) => s.lightMinutes),
      sessions.map((s) => s.remMinutes),
      sessions.map((s) => s.awakeMinutes),
      sessions.map((s) => s.externalId),
    ],
  );
  return rowCount ?? 0;
}

/**
 * Raises alerts for newly stored readings outside the senior's safe range,
 * using the alert_thresholds table.
 *
 * Only freshly inserted ids are considered, so a re-sync that inserts nothing
 * raises nothing -- deduplication at the measurement level gives us alert
 * deduplication for free.
 */
async function raiseAlerts(
  client: PoolClient,
  measurementIds: number[],
  bloodPressureIds: number[],
): Promise<number> {
  let count = 0;

  if (measurementIds.length > 0) {
    const { rowCount } = await client.query(
      `INSERT INTO alerts
         (senior_id, metric_type, severity, triggered_value, threshold_min, threshold_max,
          message, measurement_id, triggered_at)
       SELECT m.senior_id, m.metric_type, t.severity, m.value, t.min_value, t.max_value,
              format('%s is %s %s, outside the safe range',
                     initcap(replace(m.metric_type::text, '_', ' ')),
                     trim_scale(m.value), m.unit),
              m.id, m.recorded_at
       FROM measurements m
       JOIN alert_thresholds t
         ON t.senior_id = m.senior_id AND t.metric_type = m.metric_type AND t.enabled
       WHERE m.id = ANY($1::bigint[])
         AND ((t.min_value IS NOT NULL AND m.value < t.min_value)
           OR (t.max_value IS NOT NULL AND m.value > t.max_value))`,
      [measurementIds],
    );
    count += rowCount ?? 0;
  }

  if (bloodPressureIds.length > 0) {
    // measurement_id stays NULL: the reading lives in its own table.
    const { rowCount } = await client.query(
      `INSERT INTO alerts
         (senior_id, metric_type, severity, triggered_value, threshold_min, threshold_max,
          message, triggered_at)
       SELECT b.senior_id, v.metric_type, t.severity, v.value, t.min_value, t.max_value,
              format('Blood pressure %s/%s mmHg is outside the safe range', b.systolic, b.diastolic),
              b.recorded_at
       FROM blood_pressure_readings b
       CROSS JOIN LATERAL (VALUES
           ('blood_pressure_systolic'::metric_type, b.systolic::numeric),
           ('blood_pressure_diastolic'::metric_type, b.diastolic::numeric)
         ) AS v(metric_type, value)
       JOIN alert_thresholds t
         ON t.senior_id = b.senior_id AND t.metric_type = v.metric_type AND t.enabled
       WHERE b.id = ANY($1::bigint[])
         AND ((t.min_value IS NOT NULL AND v.value < t.min_value)
           OR (t.max_value IS NOT NULL AND v.value > t.max_value))`,
      [bloodPressureIds],
    );
    count += rowCount ?? 0;
  }

  return count;
}

/**
 * Persists one device sync in a single transaction: it either lands completely
 * or not at all, and a partially written batch can simply be re-sent.
 */
export async function persistSync(input: SyncInput): Promise<SyncPersistResult> {
  const client = await pg().connect();
  try {
    await client.query("BEGIN");

    const { seniorId, dataSourceId } = input;
    const bpSamples = input.samples.filter((s) => BP_METRICS.has(s.type));
    const plainSamples = input.samples.filter((s) => !BP_METRICS.has(s.type));
    const { paired, unpaired } = pairBloodPressure(bpSamples);

    const measurementIds = await insertMeasurements(client, seniorId, dataSourceId, plainSamples);
    const bloodPressureIds = await insertBloodPressure(client, seniorId, dataSourceId, paired);
    const sleep = await insertSleep(client, seniorId, dataSourceId, input.sleepSessions);
    const alerts = await raiseAlerts(client, measurementIds, bloodPressureIds);

    await client.query(
      `UPDATE data_sources SET last_sync_at = now(), last_sync_status = 'ok' WHERE id = $1`,
      [dataSourceId],
    );

    await client.query("COMMIT");

    return {
      measurements: measurementIds.length,
      bloodPressure: bloodPressureIds.length,
      sleep,
      unpairedBloodPressure: unpaired,
      alerts,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
