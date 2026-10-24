-- 007: Read helpers for the dashboard

BEGIN;

-- The most recent value of every metric, per senior.
--
-- This is the query behind the dashboard's tile row. Without it the API makes
-- one round trip per metric; with it, a single indexed scan fills the whole
-- screen. DISTINCT ON walks idx_measurements_senior_metric_time in order and
-- stops at the first row of each (senior, metric) group.
CREATE VIEW latest_measurements AS
SELECT DISTINCT ON (senior_id, metric_type)
       senior_id,
       metric_type,
       value,
       unit,
       recorded_at,
       ingested_at,
       data_source_id
FROM measurements
ORDER BY senior_id, metric_type, recorded_at DESC;

COMMENT ON VIEW latest_measurements IS
    'Most recent reading per (senior, metric). Backs the dashboard tile row.';

COMMIT;
