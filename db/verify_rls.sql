-- verify_rls.sql -- proves migration 010's policies actually isolate families.
--
-- Simulates a signed-in browser by assuming the `authenticated` role and
-- setting the JWT claims Supabase would have validated. Creates a second,
-- unrelated family, checks neither can see the other, then cleans up.
--
--   docker exec my-postgres psql "$DATABASE_URL" -f /tmp/db/verify_rls.sql

\set ON_ERROR_STOP on

\echo '=== setup: a second family that must stay invisible ==='
BEGIN;
INSERT INTO users (id, auth0_sub, full_name, role) VALUES
    ('dddddddd-0000-0000-0000-00000000000b', NULL, 'Test Senior B', 'senior'),
    ('cccccccc-0000-0000-0000-00000000000b', 'test|caregiver-b', 'Test Caregiver B', 'caregiver');
INSERT INTO caregiver_links (caregiver_id, senior_id, status)
VALUES ('cccccccc-0000-0000-0000-00000000000b', 'dddddddd-0000-0000-0000-00000000000b', 'accepted');
INSERT INTO measurements (senior_id, metric_type, value, unit, recorded_at, external_id)
VALUES ('dddddddd-0000-0000-0000-00000000000b', 'heart_rate', 71, 'bpm', now(), 'rls-test-b');
COMMIT;

\echo ''
\echo '=== 1. David (his real Auth0 sub) sees Margaret, and only Margaret ==='
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', 'google-oauth2|102850771993917674735')::text, true);
SELECT
    (SELECT count(*) FROM measurements
       WHERE senior_id = '11111111-1111-1111-1111-111111111111') > 0  AS sees_margaret,
    (SELECT count(*) FROM measurements
       WHERE senior_id = 'dddddddd-0000-0000-0000-00000000000b') = 0  AS blind_to_family_b,
    (SELECT count(*) FROM users WHERE full_name = 'Test Senior B') = 0 AS cannot_see_their_senior_row;
ROLLBACK;

\echo ''
\echo '=== 2. Caregiver B sees their own senior and NOT Margaret (the leak test) ==='
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', 'test|caregiver-b')::text, true);
SELECT
    (SELECT count(*) FROM measurements
       WHERE senior_id = 'dddddddd-0000-0000-0000-00000000000b') > 0 AS sees_own_senior,
    (SELECT count(*) FROM measurements
       WHERE senior_id = '11111111-1111-1111-1111-111111111111') = 0 AS blind_to_margaret,
    (SELECT count(*) FROM alerts) = 0                                AS no_alerts_leaked,
    (SELECT count(*) FROM sleep_sessions) = 0                        AS no_sleep_leaked,
    (SELECT count(*) FROM blood_pressure_readings) = 0               AS no_bp_leaked;
ROLLBACK;

\echo ''
\echo '=== 3. A signed-in account nobody has linked sees nothing (all must be 0) ==='
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', 'test|stranger-never-linked')::text, true);
SELECT
    (SELECT count(*) FROM measurements)        AS measurements,
    (SELECT count(*) FROM alerts)              AS alerts,
    (SELECT count(*) FROM sleep_sessions)      AS sleep,
    (SELECT count(*) FROM latest_measurements) AS via_the_view;
ROLLBACK;

\echo ''
\echo '=== 4. No token at all -- claims unset (all must be 0) ==='
BEGIN;
SET LOCAL ROLE authenticated;
SELECT (SELECT count(*) FROM measurements) AS measurements,
       (SELECT count(*) FROM users)        AS users;
ROLLBACK;

\echo ''
\echo '=== 5. anon reads nothing, and authenticated cannot write ==='
DO $$
DECLARE
    failures text[] := '{}';
    n int;
BEGIN
    -- anon was revoked in 008 and must still be refused.
    BEGIN
        SET LOCAL ROLE anon;
        EXECUTE 'SELECT count(*) FROM measurements' INTO n;
        failures := failures || format('anon READ measurements succeeded (%s rows)', n);
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;

    -- authenticated has SELECT only: a stolen browser token must not mutate.
    BEGIN
        SET LOCAL ROLE authenticated;
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', 'google-oauth2|102850771993917674735')::text, true);
        EXECUTE $q$ UPDATE measurements SET value = 999
                    WHERE senior_id = '11111111-1111-1111-1111-111111111111' $q$;
        failures := failures || 'authenticated UPDATE on measurements succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;

    BEGIN
        SET LOCAL ROLE authenticated;
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', 'google-oauth2|102850771993917674735')::text, true);
        EXECUTE $q$ DELETE FROM alerts $q$;
        failures := failures || 'authenticated DELETE on alerts succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;

    -- Codes grant access; the browser must never read one, not even its own.
    BEGIN
        SET LOCAL ROLE authenticated;
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', 'google-oauth2|102850771993917674735')::text, true);
        EXECUTE 'SELECT count(*) FROM link_invitations' INTO n;
        IF n > 0 THEN
            failures := failures || format('authenticated read %s link_invitations', n);
        END IF;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;

    IF array_length(failures, 1) IS NULL THEN
        RAISE NOTICE 'anon blocked, authenticated is read-only, share codes hidden.';
    ELSE
        RAISE EXCEPTION 'RLS FAILURES: %', array_to_string(failures, '; ');
    END IF;
END $$;

\echo ''
\echo '=== cleanup ==='
BEGIN;
DELETE FROM measurements WHERE external_id = 'rls-test-b';
DELETE FROM caregiver_links WHERE caregiver_id = 'cccccccc-0000-0000-0000-00000000000b';
DELETE FROM users WHERE id IN ('dddddddd-0000-0000-0000-00000000000b',
                               'cccccccc-0000-0000-0000-00000000000b');
COMMIT;
\echo 'test family removed'
