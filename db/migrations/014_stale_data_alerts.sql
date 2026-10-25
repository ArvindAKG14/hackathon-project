-- 014: notice when the data stops
--
-- Every alert so far is raised by a reading that arrived. Nothing watches for
-- readings that never come, which inverts the most dangerous failure in elder
-- care: a dead phone, an uninstalled app or a watch left in a drawer looks
-- exactly like a healthy, resting senior. The dashboard has a staleness badge,
-- but only someone already looking will see it -- and the whole premise is
-- that nobody is looking at 3am.
--
-- data_sources.last_sync_at already records when each paired phone last
-- delivered. This turns that into an alert.

BEGIN;

-- ---------------------------------------------------------------------------
-- An alert that is not about a reading
-- ---------------------------------------------------------------------------
CREATE TYPE alert_kind AS ENUM ('threshold', 'no_data');

ALTER TABLE alerts
    ADD COLUMN alert_kind alert_kind NOT NULL DEFAULT 'threshold';

-- A silence alert has no metric: it is about the absence of all of them.
ALTER TABLE alerts ALTER COLUMN metric_type DROP NOT NULL;

-- ...but a threshold alert still must say which metric breached, or the
-- dashboard cannot explain itself.
ALTER TABLE alerts ADD CONSTRAINT alerts_threshold_has_metric
    CHECK (alert_kind <> 'threshold' OR metric_type IS NOT NULL);

-- triggered_value stays NOT NULL: for a silence alert it carries the hours of
-- silence, with threshold_max holding the limit that was crossed. So
-- "7.9 exceeded 6" reads correctly for both kinds.

COMMENT ON COLUMN alerts.alert_kind IS
    'threshold = a reading outside its safe range. no_data = nothing arrived for too long.';

-- Makes the once-per-episode check below an index lookup.
CREATE INDEX idx_alerts_no_data
    ON alerts (senior_id, triggered_at DESC)
    WHERE alert_kind = 'no_data';


-- ---------------------------------------------------------------------------
-- The check
-- ---------------------------------------------------------------------------
-- Returns how many alerts it raised, so a scheduled run is observable.
--
-- SECURITY DEFINER because it runs from pg_cron with no JWT, and every table
-- it touches is behind RLS.
CREATE OR REPLACE FUNCTION public.detect_stale_data(p_hours integer DEFAULT 6)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    raised integer;
BEGIN
    WITH per_senior AS (
        -- A senior is silent only when *every* paired phone is silent, so
        -- take the most recent sync across all of them. Revoked devices and
        -- the 'manual'/'mock' sources are excluded: they were never going to
        -- send anything on a schedule.
        SELECT d.senior_id, max(d.last_sync_at) AS last_sync
        FROM data_sources d
        WHERE d.token_hash IS NOT NULL
          AND d.revoked_at IS NULL
          AND d.last_sync_at IS NOT NULL
        GROUP BY d.senior_id
    ),
    silent AS (
        SELECT p.senior_id,
               p.last_sync,
               round((extract(epoch FROM now() - p.last_sync) / 3600)::numeric, 1) AS hours
        FROM per_senior p
        WHERE p.last_sync < now() - make_interval(hours => p_hours)
          -- Once per silence episode, not once per run. An alert raised after
          -- the last sync already covers this stretch of quiet; when data
          -- resumes, last_sync moves forward and the next silence qualifies
          -- again. Deliberately not keyed on acknowledgement -- an unread
          -- alert would otherwise suppress every future one.
          AND NOT EXISTS (
              SELECT 1 FROM alerts a
              WHERE a.senior_id = p.senior_id
                AND a.alert_kind = 'no_data'
                AND a.triggered_at > p.last_sync
          )
    )
    INSERT INTO alerts
        (senior_id, alert_kind, metric_type, severity, triggered_value, threshold_max, message, triggered_at)
    SELECT s.senior_id,
           'no_data',
           NULL,
           'warning',
           s.hours,
           p_hours,
           format(
               'No readings for %s hours. Quiet data is not the same as good news -- check the phone is on, charged and online.',
               s.hours
           ),
           now()
    FROM silent s;

    GET DIAGNOSTICS raised = ROW_COUNT;
    RETURN raised;
END;
$$;

COMMENT ON FUNCTION public.detect_stale_data(integer) IS
    'Raises a no_data alert per senior whose paired phones have all been silent longer than p_hours. At most one per silence episode. Returns the number raised.';

REVOKE EXECUTE ON FUNCTION public.detect_stale_data(integer) FROM public;

COMMIT;


-- ---------------------------------------------------------------------------
-- Schedule it
-- ---------------------------------------------------------------------------
-- Hourly. The check is cheap and silence is only interesting at hour
-- granularity; running it more often would just find the same quiet.
--
-- Guarded, so this migration still applies on a plain Postgres or a Supabase
-- project where pg_cron has not been enabled yet. Enable it under
-- Database > Extensions and re-run this block to start the schedule.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule('detect-stale-data')
        WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'detect-stale-data');

        PERFORM cron.schedule('detect-stale-data', '7 * * * *', 'SELECT public.detect_stale_data(6)');
        RAISE NOTICE 'Scheduled detect-stale-data hourly at :07.';
    ELSE
        RAISE NOTICE 'pg_cron not installed; detect_stale_data() exists but nothing calls it yet.';
    END IF;
END $$;
