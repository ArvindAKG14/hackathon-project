-- 010: Real row-level security, keyed on the Auth0 subject
--
-- 008 locked every table with RLS enabled and no policies, because auth was
-- Auth0 and Supabase could not verify an Auth0 token. With Supabase's
-- Third-Party Auth the browser presents its Auth0 access token, Supabase
-- validates it against the tenant's JWKS, and auth.jwt() carries the claims.
-- That makes per-user policies possible for the first time.
--
-- Two things this buys:
--   * Defence in depth. Today authorization rests entirely on data.ts calling
--     getLinkedSenior(). One query that forgets would leak another family's
--     health data, because service_role bypasses everything. These policies
--     make the database refuse regardless of what the application asks for.
--   * Realtime. postgres_changes honours RLS, so a browser can subscribe to
--     its own seniors and nothing else -- which is what replaces polling.
--
-- SELECT ONLY. Writes stay server-side (device ingest on a direct connection,
-- mutations through server actions). `authenticated` gets no INSERT, UPDATE or
-- DELETE anywhere, so a stolen browser token cannot alter a single row.
--
-- Adding these cannot break the current app: it reads with service_role, which
-- has BYPASSRLS. This is purely additive until the client starts using a user
-- token.

BEGIN;

-- ---------------------------------------------------------------------------
-- Who is asking
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER on purpose. These read users and caregiver_links, which are
-- themselves RLS-protected; without it, a policy on caregiver_links that calls
-- a function reading caregiver_links recurses forever.
--
-- Both are STABLE, so Postgres evaluates them once per statement rather than
-- once per row -- which matters on a measurements table with thousands of rows.

CREATE OR REPLACE FUNCTION public.current_caregiver_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
    SELECT id FROM public.users
    WHERE auth0_sub = (auth.jwt() ->> 'sub')
      AND role = 'caregiver'
    LIMIT 1
$$;

COMMENT ON FUNCTION public.current_caregiver_id() IS
    'users.id for the Auth0 subject in the current JWT, or NULL. NULL means every policy below matches nothing.';

CREATE OR REPLACE FUNCTION public.visible_senior_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
    SELECT senior_id FROM public.caregiver_links
    WHERE caregiver_id = public.current_caregiver_id()
      AND status = 'accepted'
$$;

COMMENT ON FUNCTION public.visible_senior_ids() IS
    'Seniors the current caregiver may see. The single source of truth for every policy in this migration.';

REVOKE EXECUTE ON FUNCTION public.current_caregiver_id() FROM public;
REVOKE EXECUTE ON FUNCTION public.visible_senior_ids() FROM public;


-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- 008 revoked everything from `authenticated`. Policies are only consulted
-- after a grant passes, so without this the policies below would be dead code.
-- `anon` stays revoked: an unauthenticated visitor reads nothing.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT EXECUTE ON FUNCTION public.current_caregiver_id() TO authenticated;
        GRANT EXECUTE ON FUNCTION public.visible_senior_ids() TO authenticated;
        GRANT SELECT ON
            users, caregiver_links, data_sources, measurements,
            sleep_sessions, blood_pressure_readings, alert_thresholds, alerts,
            latest_measurements
        TO authenticated;
    END IF;
END $$;


-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
-- The `IN (SELECT visible_senior_ids())` form is deliberate: it runs the
-- subquery once as an InitPlan, instead of calling a function per row.

-- A caregiver sees their own row, the seniors they look after, and the other
-- caregivers of those seniors (the dashboard names whoever acknowledged an alert).
CREATE POLICY users_select ON users
    FOR SELECT TO authenticated
    USING (
        id = (SELECT public.current_caregiver_id())
        OR id IN (SELECT public.visible_senior_ids())
        OR id IN (
            SELECT caregiver_id FROM public.caregiver_links
            WHERE senior_id IN (SELECT public.visible_senior_ids())
              AND status = 'accepted'
        )
    );

-- Their own links, plus co-caregivers on the seniors they share.
CREATE POLICY caregiver_links_select ON caregiver_links
    FOR SELECT TO authenticated
    USING (
        caregiver_id = (SELECT public.current_caregiver_id())
        OR senior_id IN (SELECT public.visible_senior_ids())
    );

CREATE POLICY data_sources_select ON data_sources
    FOR SELECT TO authenticated
    USING (senior_id IN (SELECT public.visible_senior_ids()));

CREATE POLICY measurements_select ON measurements
    FOR SELECT TO authenticated
    USING (senior_id IN (SELECT public.visible_senior_ids()));

CREATE POLICY sleep_sessions_select ON sleep_sessions
    FOR SELECT TO authenticated
    USING (senior_id IN (SELECT public.visible_senior_ids()));

CREATE POLICY blood_pressure_select ON blood_pressure_readings
    FOR SELECT TO authenticated
    USING (senior_id IN (SELECT public.visible_senior_ids()));

CREATE POLICY alert_thresholds_select ON alert_thresholds
    FOR SELECT TO authenticated
    USING (senior_id IN (SELECT public.visible_senior_ids()));

CREATE POLICY alerts_select ON alerts
    FOR SELECT TO authenticated
    USING (senior_id IN (SELECT public.visible_senior_ids()));

-- link_invitations and device_pairing_codes get NO policy. Both hold codes that
-- grant access; they are only ever read server-side, so the browser must never
-- see one -- not even its own.


-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- postgres_changes applies the policies above, so a subscriber receives changes
-- only for seniors they may see. Only the tables a dashboard reacts to.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE measurements;
        ALTER PUBLICATION supabase_realtime ADD TABLE alerts;
        ALTER PUBLICATION supabase_realtime ADD TABLE blood_pressure_readings;
        RAISE NOTICE 'Added measurements, alerts and blood_pressure_readings to supabase_realtime.';
    ELSE
        RAISE NOTICE 'No supabase_realtime publication here; skipping (fine on plain Postgres).';
    END IF;
END $$;

COMMIT;
