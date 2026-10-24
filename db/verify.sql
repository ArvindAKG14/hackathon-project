-- verify.sql -- proves the schema answers the questions the app will ask.
-- Read-only except for the idempotency check, which rolls itself back.
--
--   docker exec my-postgres psql -U postgres -d health_monitor -f /tmp/db/verify.sql

\echo '=== 1. Row counts ==='
SELECT 'users' AS table_name, count(*) FROM users
UNION ALL SELECT 'caregiver_links', count(*) FROM caregiver_links
UNION ALL SELECT 'link_invitations', count(*) FROM link_invitations
UNION ALL SELECT 'data_sources', count(*) FROM data_sources
UNION ALL SELECT 'measurements', count(*) FROM measurements
UNION ALL SELECT 'sleep_sessions', count(*) FROM sleep_sessions
UNION ALL SELECT 'blood_pressure_readings', count(*) FROM blood_pressure_readings
UNION ALL SELECT 'alert_thresholds', count(*) FROM alert_thresholds
UNION ALL SELECT 'alerts', count(*) FROM alerts
ORDER BY 1;

\echo ''
\echo '=== 2. Dashboard tile row: latest value per metric (the latest_measurements view) ==='
SELECT metric_type, value, unit, recorded_at
FROM latest_measurements
WHERE senior_id = '11111111-1111-1111-1111-111111111111'
ORDER BY metric_type;

\echo ''
\echo '=== 3. Authorization: which caregivers may view this senior ==='
SELECT u.full_name, cl.relationship, cl.status
FROM caregiver_links cl
JOIN users u ON u.id = cl.caregiver_id
WHERE cl.senior_id = '11111111-1111-1111-1111-111111111111'
  AND cl.status = 'accepted';

\echo ''
\echo '=== 4. Chart data: heart rate, last 24h, hourly min/avg/max ==='
SELECT date_trunc('hour', recorded_at) AS hour,
       round(min(value))  AS min_bpm,
       round(avg(value))  AS avg_bpm,
       round(max(value))  AS max_bpm,
       count(*)           AS samples
FROM measurements
WHERE senior_id = '11111111-1111-1111-1111-111111111111'
  AND metric_type = 'heart_rate'
  AND recorded_at > now() - interval '24 hours'
GROUP BY 1 ORDER BY 1 DESC LIMIT 8;

\echo ''
\echo '=== 5. Interval metrics sum correctly: daily step totals ==='
SELECT (period_start AT TIME ZONE 'America/New_York')::date AS local_day,
       sum(value)::int AS steps,
       count(*)        AS interval_samples
FROM measurements
WHERE senior_id = '11111111-1111-1111-1111-111111111111'
  AND metric_type = 'steps'
GROUP BY 1 ORDER BY 1;

\echo ''
\echo '=== 6. Open alerts (what the caregiver dashboard polls) ==='
SELECT metric_type, severity, triggered_value, threshold_min, threshold_max,
       triggered_at, message
FROM alerts
WHERE senior_id = '11111111-1111-1111-1111-111111111111'
  AND acknowledged_at IS NULL
ORDER BY triggered_at DESC;

\echo ''
\echo '=== 7. Alert history including acknowledged ==='
SELECT a.metric_type, a.severity, a.triggered_value,
       a.acknowledged_at IS NOT NULL AS acknowledged,
       u.full_name AS acknowledged_by
FROM alerts a
LEFT JOIN users u ON u.id = a.acknowledged_by
WHERE a.senior_id = '11111111-1111-1111-1111-111111111111'
ORDER BY a.triggered_at DESC;

\echo ''
\echo '=== 8. Sleep: last 7 nights ==='
SELECT (started_at AT TIME ZONE 'America/New_York')::date AS night,
       total_minutes, deep_minutes, light_minutes, rem_minutes, awake_minutes
FROM sleep_sessions
WHERE senior_id = '11111111-1111-1111-1111-111111111111'
ORDER BY started_at DESC;

\echo ''
\echo '=== 9. Sync freshness (the "data is stale" badge) ==='
SELECT provider, device_model, last_sync_at, last_sync_status,
       round(extract(epoch FROM now() - last_sync_at) / 60) AS minutes_ago
FROM data_sources
WHERE senior_id = '11111111-1111-1111-1111-111111111111';

\echo ''
\echo '=== 10. IDEMPOTENCY: re-sending readings must insert nothing ==='
BEGIN;
-- Simulate the mobile app re-pushing an overlapping window after a flaky upload.
INSERT INTO measurements
    (senior_id, data_source_id, metric_type, value, unit, recorded_at, external_id)
SELECT senior_id, data_source_id, metric_type, value, unit, recorded_at, external_id
FROM measurements
WHERE senior_id = '11111111-1111-1111-1111-111111111111'
  AND metric_type = 'heart_rate'
  AND recorded_at > now() - interval '30 minutes'
ON CONFLICT DO NOTHING;
\echo '    ^ expect "INSERT 0 0" above -- duplicates rejected by the unique indexes'
ROLLBACK;

\echo ''
\echo '=== 11. Index usage: the dashboard query must not seq-scan ==='
EXPLAIN (COSTS OFF)
SELECT value, recorded_at FROM measurements
WHERE senior_id = '11111111-1111-1111-1111-111111111111'
  AND metric_type = 'heart_rate'
  AND recorded_at > now() - interval '24 hours'
ORDER BY recorded_at DESC;

\echo ''
\echo '=== 12. Constraints actually reject bad data ==='
DO $$
DECLARE
    failures text[] := '{}';
BEGIN
    -- systolic must exceed diastolic
    BEGIN
        INSERT INTO blood_pressure_readings (senior_id, systolic, diastolic, recorded_at)
        VALUES ('11111111-1111-1111-1111-111111111111', 80, 120, now());
        failures := failures || 'bp_systolic_above_diastolic NOT enforced';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- period_start and period_end are both-or-neither
    BEGIN
        INSERT INTO measurements (senior_id, metric_type, value, unit, recorded_at, period_start)
        VALUES ('11111111-1111-1111-1111-111111111111', 'steps', 100, 'count', now(), now());
        failures := failures || 'measurements_period_both_or_neither NOT enforced';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- a caregiver cannot monitor themselves
    BEGIN
        INSERT INTO caregiver_links (caregiver_id, senior_id)
        VALUES ('22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222');
        failures := failures || 'caregiver_links_not_self NOT enforced';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- a threshold needs at least one bound
    BEGIN
        INSERT INTO alert_thresholds (senior_id, metric_type)
        VALUES ('11111111-1111-1111-1111-111111111111', 'steps');
        failures := failures || 'alert_thresholds_bound_present NOT enforced';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- invitation codes must match the readable format
    BEGIN
        INSERT INTO link_invitations (code, senior_id, created_by, expires_at)
        VALUES ('nope', '11111111-1111-1111-1111-111111111111',
                '22222222-2222-2222-2222-222222222222', now() + interval '1 day');
        failures := failures || 'link_invitations_code_format NOT enforced';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    IF array_length(failures, 1) IS NULL THEN
        RAISE NOTICE 'All 5 constraint checks correctly rejected bad data.';
    ELSE
        RAISE EXCEPTION 'CONSTRAINT FAILURES: %', array_to_string(failures, '; ');
    END IF;
END $$;
