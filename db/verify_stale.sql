-- verify_stale.sql -- proves detect_stale_data() alerts once per silence
-- episode, and alerts again when a phone goes quiet a second time.
--
--   docker exec my-postgres psql "$DATABASE_URL" -f /tmp/db/verify_stale.sql
--
-- Note on ordering: last_sync_at only ever moves forward in reality, because
-- a sync is the only thing that writes it. Tests that move it backwards
-- create sequences the system cannot actually produce, so the second-episode
-- case below backdates the earlier alert instead.

\set ON_ERROR_STOP on
\set SENIOR '''eeeeeeee-0000-0000-0000-00000000000c'''
\set SOURCE '''ffffffff-0000-0000-0000-00000000000c'''

\echo '=== setup: a senior whose only paired phone stopped 9 hours ago ==='
BEGIN;
INSERT INTO users (id, full_name, role) VALUES (:SENIOR, 'Stale Test Senior', 'senior');
INSERT INTO caregiver_links (caregiver_id, senior_id, status)
VALUES ('22222222-2222-2222-2222-222222222222', :SENIOR, 'accepted');
INSERT INTO data_sources (id, senior_id, provider, source_app, token_hash, device_name, last_sync_at)
VALUES (:SOURCE, :SENIOR, 'health_connect', 'stale-test', 'stale-test-token-hash',
        'Test Phone', now() - interval '9 hours');
COMMIT;

\echo ''
\echo '=== 1. silence is detected (expect 1 alert, metric_type NULL) ==='
SELECT public.detect_stale_data(6) AS raised_all_seniors;
SELECT alert_kind, severity, triggered_value AS hours_silent, threshold_max AS limit_hours,
       metric_type IS NULL AS no_metric, left(message, 44) AS message
FROM alerts WHERE senior_id = :SENIOR;

\echo ''
\echo '=== 2. re-running does NOT pile up alerts (expect 0, 0, total still 1) ==='
SELECT public.detect_stale_data(6) AS second_run, public.detect_stale_data(6) AS third_run;
SELECT count(*) AS total_still_one FROM alerts WHERE senior_id = :SENIOR;

\echo ''
\echo '=== 3. the caregiver can see it through RLS ==='
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', 'google-oauth2|102850771993917674735')::text, true);
SELECT count(*) AS visible_to_david FROM alerts WHERE senior_id = :SENIOR;
ROLLBACK;

\echo ''
\echo '=== 4. an unrelated caregiver cannot (expect 0) ==='
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', 'test|nobody-linked-here')::text, true);
SELECT count(*) AS visible_to_stranger FROM alerts WHERE senior_id = :SENIOR;
ROLLBACK;

\echo ''
\echo '=== 5. phone healthy again -> nothing raised ==='
UPDATE data_sources SET last_sync_at = now() - interval '10 minutes' WHERE id = :SOURCE;
SELECT public.detect_stale_data(6) AS raised_while_healthy;

\echo ''
\echo '=== 6. a SECOND silence episode does alert again (expect 1, total 2) ==='
-- Realistic ordering: the first alert belongs to an earlier episode, and the
-- phone synced after it before falling quiet once more.
UPDATE alerts SET triggered_at = now() - interval '20 hours'
WHERE senior_id = :SENIOR AND alert_kind = 'no_data';
UPDATE data_sources SET last_sync_at = now() - interval '7 hours' WHERE id = :SOURCE;
SELECT public.detect_stale_data(6) AS raised_second_episode;
SELECT count(*) AS total_now_two FROM alerts WHERE senior_id = :SENIOR;

\echo ''
\echo '=== 7. a revoked phone is not expected to report (expect 0) ==='
DELETE FROM alerts WHERE senior_id = :SENIOR;
UPDATE data_sources SET revoked_at = now(), last_sync_at = now() - interval '30 hours'
WHERE id = :SOURCE;
SELECT public.detect_stale_data(6) AS raised_for_revoked;
UPDATE data_sources SET revoked_at = NULL WHERE id = :SOURCE;

\echo ''
\echo '=== 8. threshold alerts still require a metric ==='
DO $$
BEGIN
    BEGIN
        INSERT INTO alerts (senior_id, alert_kind, severity, triggered_value, message)
        VALUES ('eeeeeeee-0000-0000-0000-00000000000c', 'threshold', 'warning', 1, 'no metric');
        RAISE EXCEPTION 'FAIL: a threshold alert with no metric_type was accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK: threshold alerts still require metric_type.';
    END;
END $$;

\echo ''
\echo '=== 9. the hourly job is registered ==='
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'detect-stale-data';

\echo ''
\echo '=== cleanup ==='
BEGIN;
DELETE FROM alerts WHERE senior_id = :SENIOR;
DELETE FROM data_sources WHERE id = :SOURCE;
DELETE FROM caregiver_links WHERE senior_id = :SENIOR;
DELETE FROM users WHERE id = :SENIOR;
COMMIT;
\echo 'test senior removed'
