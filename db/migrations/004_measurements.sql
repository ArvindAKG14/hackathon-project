-- 004: The main time-series table

BEGIN;

-- One row per scalar reading. Covers heart rate, SpO2, temperature, steps,
-- distance, calories, weight, glucose -- anything expressible as one number
-- plus a unit. Sleep and blood pressure are structurally different and get
-- their own tables in 005.
--
-- POINT vs INTERVAL metrics:
--   A heart rate sample is an instant      -> recorded_at set, period_* NULL
--   A step count covers a span of time     -> period_start/period_end set,
--                                             recorded_at = period_end
-- Both HealthKit (HKQuantityTypeIdentifierStepCount) and Health Connect
-- (StepsRecord) return interval samples with their own start/end times, so
-- these columns map straight onto the source payloads. Summing interval
-- samples over a window is correct; the cumulative daily total is a derived
-- aggregate, not something we store.
--
-- recorded_at vs ingested_at: a phone offline for six hours will dump six
-- hours of backdated readings at once, out of order. recorded_at is when the
-- body did the thing; ingested_at is when we heard about it. Charts use the
-- former, sync diagnostics the latter.
CREATE TABLE measurements (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    senior_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data_source_id uuid REFERENCES data_sources(id) ON DELETE SET NULL,
    metric_type    metric_type NOT NULL,
    value          numeric(12,3) NOT NULL,
    unit           text NOT NULL,
    recorded_at    timestamptz NOT NULL,
    period_start   timestamptz,
    period_end     timestamptz,
    -- The source's own stable record id: HKSample.uuid, or Health Connect's
    -- Metadata.id. Present for device data, absent for manual entry.
    external_id    text,
    ingested_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT measurements_period_both_or_neither
        CHECK ((period_start IS NULL) = (period_end IS NULL)),
    CONSTRAINT measurements_period_ordered
        CHECK (period_end IS NULL OR period_end >= period_start),
    CONSTRAINT measurements_unit_not_blank
        CHECK (length(btrim(unit)) > 0)
);

-- Idempotent ingest, part 1: when the source gave us a record id, that id is
-- the identity of the reading. The mobile app can re-send an overlapping
-- window and ON CONFLICT DO NOTHING makes it a no-op -- no retry bookkeeping
-- in the API, no duplicate rows after a flaky upload.
CREATE UNIQUE INDEX uq_measurements_external
    ON measurements (senior_id, metric_type, external_id)
    WHERE external_id IS NOT NULL;

-- Idempotent ingest, part 2: without a source id, one reading per metric per
-- instant is the best natural key available.
CREATE UNIQUE INDEX uq_measurements_natural
    ON measurements (senior_id, metric_type, recorded_at)
    WHERE external_id IS NULL;

-- The workhorse. Serves both "latest value for this metric" and "this metric
-- over the last 24 hours" -- the only two shapes the dashboard asks for.
CREATE INDEX idx_measurements_senior_metric_time
    ON measurements (senior_id, metric_type, recorded_at DESC);

-- "Everything for Mom today", across metrics.
CREATE INDEX idx_measurements_senior_time
    ON measurements (senior_id, recorded_at DESC);

COMMIT;
