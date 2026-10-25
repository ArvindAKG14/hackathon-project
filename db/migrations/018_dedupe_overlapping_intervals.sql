-- 018: drop rollup records that double-count interval metrics
--
-- Health Connect's readRecords returns records from EVERY app that writes a
-- given type. On a Samsung phone the handset sensor writes granular step
-- intervals while Samsung Health writes a daily rollup covering the same
-- walking. Both are valid StepsRecords, both arrive, and summing them doubles
-- the day:
--
--   granular records   470
--   daily rollup       470
--   shown on screen    940
--
-- Google's aggregation APIs de-duplicate across origins, which is exactly why
-- they exist; raw readRecords leaves it to the caller. We read raw records on
-- purpose -- aggregates cannot be summed safely and freeze at their first
-- value under ON CONFLICT DO NOTHING -- so the de-duplication has to happen
-- here.
--
-- The rule: a record that STRICTLY contains another record of the same metric
-- is a rollup of it, and is dropped. Strict matters. Two records covering
-- exactly the same span do not contain one another, so neither is dropped --
-- otherwise an identical pair would eliminate itself and lose the reading
-- entirely. It also means nothing is dropped when there is nothing finer to
-- fall back on: a lone daily rollup survives and is still counted.
--
-- This is the interim fix. The complete one is to carry Health Connect's
-- metadata.dataOrigin through from the app and sum within an origin, taking
-- the max across origins -- the same rule already applied across devices,
-- one level finer. That needs an Android change; this does not.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_measurements_interval_span
    ON measurements (senior_id, metric_type, period_start, period_end)
    WHERE period_start IS NOT NULL;

CREATE VIEW measurements_deduplicated
WITH (security_invoker = on) AS
SELECT m.*
FROM measurements m
WHERE
    -- Point metrics have no span and cannot contain anything.
    m.period_start IS NULL
    OR NOT EXISTS (
        SELECT 1
        FROM measurements finer
        WHERE finer.senior_id   = m.senior_id
          AND finer.metric_type = m.metric_type
          AND finer.period_start IS NOT NULL
          AND finer.id <> m.id
          -- m covers all of finer...
          AND m.period_start <= finer.period_start
          AND m.period_end   >= finer.period_end
          -- ...and is strictly wider, so equal spans keep each other.
          AND (m.period_start < finer.period_start OR m.period_end > finer.period_end)
    );

COMMENT ON VIEW measurements_deduplicated IS
    'measurements with rollup rows removed: any interval record that strictly contains a finer record of the same metric. Use this for summing interval metrics; use measurements directly for ingest and for latest-value lookups.';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT SELECT ON measurements_deduplicated TO authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON measurements_deduplicated FROM anon;
    END IF;
END $$;

COMMIT;
