-- verify_alert_dedup.sql -- a sustained breach must not bury the caregiver,
-- but a deterioration must still get through.
--
--   docker exec my-postgres psql "$DATABASE_URL" -f /tmp/db/verify_alert_dedup.sql

\set ON_ERROR_STOP on
\set SENIOR '''aaaaaaaa-0000-0000-0000-0000000000de'''

\echo '=== setup: a senior whose SpO2 must stay above 92 ==='
BEGIN;
INSERT INTO users (id, full_name, role) VALUES (:SENIOR, 'Dedup Test Senior', 'senior');
INSERT INTO alert_thresholds (senior_id, metric_type, min_value, severity)
VALUES (:SENIOR, 'spo2', 92, 'warning');
COMMIT;

\echo ''
\echo '=== 20 breaching readings arrive, as a phone syncing for an hour would ==='
BEGIN;
-- Stand in for the ingest path: insert the readings, then run the same
-- alert rule persist.ts uses.
INSERT INTO measurements (senior_id, metric_type, value, unit, recorded_at, external_id)
SELECT :SENIOR, 'spo2', 88, '%', now() - (g || ' minutes')::interval, 'dedup-' || g
FROM generate_series(1, 20) g;

INSERT INTO alerts
    (senior_id, metric_type, severity, triggered_value, threshold_min, threshold_max,
     message, measurement_id, triggered_at)
SELECT DISTINCT ON (m.senior_id, m.metric_type)
       m.senior_id, m.metric_type, t.severity, m.value, t.min_value, t.max_value,
       public.threshold_alert_message(m.metric_type, m.value, m.unit, t.min_value, t.max_value),
       m.id, m.recorded_at
FROM measurements m
JOIN alert_thresholds t ON t.senior_id = m.senior_id AND t.metric_type = m.metric_type AND t.enabled
WHERE m.external_id LIKE 'dedup-%'
  AND ((t.min_value IS NOT NULL AND m.value < t.min_value)
    OR (t.max_value IS NOT NULL AND m.value > t.max_value))
  AND NOT EXISTS (
      SELECT 1 FROM alerts open
      WHERE open.senior_id = m.senior_id AND open.metric_type = m.metric_type
        AND open.alert_kind = 'threshold' AND open.acknowledged_at IS NULL
        AND open.severity >= t.severity)
ORDER BY m.senior_id, m.metric_type, m.recorded_at DESC;
COMMIT;

SELECT count(*) AS alerts_from_20_readings, max(message) AS wording
FROM alerts WHERE senior_id = :SENIOR;

\echo ''
\echo '=== the breach continues: another batch raises nothing (expect still 1) ==='
BEGIN;
INSERT INTO measurements (senior_id, metric_type, value, unit, recorded_at, external_id)
SELECT :SENIOR, 'spo2', 89, '%', now() + (g || ' seconds')::interval, 'dedup2-' || g
FROM generate_series(1, 20) g;

INSERT INTO alerts
    (senior_id, metric_type, severity, triggered_value, threshold_min, threshold_max,
     message, measurement_id, triggered_at)
SELECT DISTINCT ON (m.senior_id, m.metric_type)
       m.senior_id, m.metric_type, t.severity, m.value, t.min_value, t.max_value,
       public.threshold_alert_message(m.metric_type, m.value, m.unit, t.min_value, t.max_value),
       m.id, m.recorded_at
FROM measurements m
JOIN alert_thresholds t ON t.senior_id = m.senior_id AND t.metric_type = m.metric_type AND t.enabled
WHERE m.external_id LIKE 'dedup2-%'
  AND ((t.min_value IS NOT NULL AND m.value < t.min_value)
    OR (t.max_value IS NOT NULL AND m.value > t.max_value))
  AND NOT EXISTS (
      SELECT 1 FROM alerts open
      WHERE open.senior_id = m.senior_id AND open.metric_type = m.metric_type
        AND open.alert_kind = 'threshold' AND open.acknowledged_at IS NULL
        AND open.severity >= t.severity)
ORDER BY m.senior_id, m.metric_type, m.recorded_at DESC;
COMMIT;

SELECT count(*) AS still_one FROM alerts WHERE senior_id = :SENIOR;

\echo ''
\echo '=== it gets WORSE: a critical threshold must still get through (expect 2) ==='
BEGIN;
UPDATE alert_thresholds SET severity = 'critical' WHERE senior_id = :SENIOR AND metric_type = 'spo2';
INSERT INTO measurements (senior_id, metric_type, value, unit, recorded_at, external_id)
VALUES (:SENIOR, 'spo2', 81, '%', now() + interval '2 minutes', 'dedup3-worse');

INSERT INTO alerts
    (senior_id, metric_type, severity, triggered_value, threshold_min, threshold_max,
     message, measurement_id, triggered_at)
SELECT DISTINCT ON (m.senior_id, m.metric_type)
       m.senior_id, m.metric_type, t.severity, m.value, t.min_value, t.max_value,
       public.threshold_alert_message(m.metric_type, m.value, m.unit, t.min_value, t.max_value),
       m.id, m.recorded_at
FROM measurements m
JOIN alert_thresholds t ON t.senior_id = m.senior_id AND t.metric_type = m.metric_type AND t.enabled
WHERE m.external_id = 'dedup3-worse'
  AND ((t.min_value IS NOT NULL AND m.value < t.min_value)
    OR (t.max_value IS NOT NULL AND m.value > t.max_value))
  AND NOT EXISTS (
      SELECT 1 FROM alerts open
      WHERE open.senior_id = m.senior_id AND open.metric_type = m.metric_type
        AND open.alert_kind = 'threshold' AND open.acknowledged_at IS NULL
        AND open.severity >= t.severity)
ORDER BY m.senior_id, m.metric_type, m.recorded_at DESC;
COMMIT;

SELECT severity, triggered_value, message FROM alerts WHERE senior_id = :SENIOR ORDER BY triggered_at;

\echo ''
\echo '=== after acknowledging, a later breach alerts again (expect 3) ==='
BEGIN;
UPDATE alerts SET acknowledged_at = now(), acknowledged_by = '22222222-2222-2222-2222-222222222222'
WHERE senior_id = :SENIOR;
INSERT INTO measurements (senior_id, metric_type, value, unit, recorded_at, external_id)
VALUES (:SENIOR, 'spo2', 87, '%', now() + interval '5 minutes', 'dedup4-after-ack');

INSERT INTO alerts
    (senior_id, metric_type, severity, triggered_value, threshold_min, threshold_max,
     message, measurement_id, triggered_at)
SELECT DISTINCT ON (m.senior_id, m.metric_type)
       m.senior_id, m.metric_type, t.severity, m.value, t.min_value, t.max_value,
       public.threshold_alert_message(m.metric_type, m.value, m.unit, t.min_value, t.max_value),
       m.id, m.recorded_at
FROM measurements m
JOIN alert_thresholds t ON t.senior_id = m.senior_id AND t.metric_type = m.metric_type AND t.enabled
WHERE m.external_id = 'dedup4-after-ack'
  AND ((t.min_value IS NOT NULL AND m.value < t.min_value)
    OR (t.max_value IS NOT NULL AND m.value > t.max_value))
  AND NOT EXISTS (
      SELECT 1 FROM alerts open
      WHERE open.senior_id = m.senior_id AND open.metric_type = m.metric_type
        AND open.alert_kind = 'threshold' AND open.acknowledged_at IS NULL
        AND open.severity >= t.severity)
ORDER BY m.senior_id, m.metric_type, m.recorded_at DESC;
COMMIT;

SELECT count(*) AS total_three FROM alerts WHERE senior_id = :SENIOR;

\echo ''
\echo '=== cleanup ==='
BEGIN;
DELETE FROM alerts WHERE senior_id = :SENIOR;
DELETE FROM measurements WHERE senior_id = :SENIOR;
DELETE FROM alert_thresholds WHERE senior_id = :SENIOR;
DELETE FROM users WHERE id = :SENIOR;
COMMIT;
\echo 'test senior removed'
