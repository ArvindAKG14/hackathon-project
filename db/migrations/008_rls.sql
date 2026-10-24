-- 008: Lock the tables down before anything is exposed over HTTP
--
-- Supabase publishes every table in the `public` schema through PostgREST.
-- The `anon` key that reaches those endpoints is a CLIENT-SIDE PUBLIC
-- credential -- it ships inside the web app's JavaScript bundle. Without row
-- level security, anyone who opens devtools can read every senior's health
-- data from /rest/v1/measurements.
--
-- We authenticate with Auth0, not Supabase Auth, so auth.uid() policies are
-- not available to us. The correct posture is therefore:
--
--   * RLS enabled on every table, with NO policies -> anon and authenticated
--     can read and write nothing at all.
--   * The REST API connects with the `service_role` key, which has BYPASSRLS.
--     Authorization lives in the API, as the caregiver_links check.
--
-- The service_role key must never be shipped to a browser. If it leaks,
-- rotate it in the Supabase dashboard immediately.
--
-- This migration is a no-op safety net on plain PostgreSQL (no PostgREST, no
-- anon role) and is safe to run anywhere.

BEGIN;

ALTER TABLE users                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE caregiver_links         ENABLE ROW LEVEL SECURITY;
ALTER TABLE link_invitations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_sources            ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurements            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sleep_sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE blood_pressure_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_thresholds        ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts                  ENABLE ROW LEVEL SECURITY;

-- A view runs with its OWNER's permissions unless told otherwise, which would
-- let latest_measurements hand out rows that RLS on `measurements` is
-- supposed to be protecting. security_invoker makes the caller's permissions
-- -- and the caller's RLS -- apply instead. Requires PG 15+.
ALTER VIEW latest_measurements SET (security_invoker = on);

-- Belt and braces: drop the grants PostgREST relies on. RLS alone is enough,
-- but a future migration that adds a permissive policy should not silently
-- re-open the whole dataset.
--
-- Guarded, because the anon/authenticated roles only exist on Supabase.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
        REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
        RAISE NOTICE 'Revoked public-schema grants from anon.';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM authenticated;
        REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
        RAISE NOTICE 'Revoked public-schema grants from authenticated.';
    END IF;
END $$;

COMMIT;
