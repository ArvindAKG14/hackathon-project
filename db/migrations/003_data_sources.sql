-- 003: Data sources -- one row per connection feeding a senior's readings

BEGIN;

-- HealthKit and Health Connect are on-device APIs; the server cannot poll
-- them. The mobile app reads locally and POSTs batches here. This table
-- tracks each such connection and when it last delivered.
--
-- last_sync_at is what powers the "last updated 4 minutes ago" / "data is
-- stale" badge on the caregiver dashboard. With a ~3 minute push cycle,
-- silence is otherwise indistinguishable from a healthy, resting senior.
CREATE TABLE data_sources (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    senior_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider         health_provider NOT NULL,
    -- HealthKit HKSource.bundleIdentifier, or Health Connect's
    -- Metadata.dataOrigin package name. Empty string when not applicable,
    -- so the uniqueness constraint below actually bites (NULLs would not).
    source_app       text NOT NULL DEFAULT '',
    device_model     text,
    last_sync_at     timestamptz,
    last_sync_status text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),

    UNIQUE (senior_id, provider, source_app)
);

CREATE INDEX idx_data_sources_senior ON data_sources (senior_id);

CREATE TRIGGER data_sources_set_updated_at
    BEFORE UPDATE ON data_sources
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
