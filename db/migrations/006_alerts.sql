-- 006: Safe ranges and the alerts they produce

BEGIN;

-- Per-senior safe range for one metric. A NULL bound means unbounded on that
-- side: SpO2 only has a floor, body temperature has both.
--
-- Blood pressure thresholds work through the blood_pressure_systolic and
-- blood_pressure_diastolic enum values even though those readings live in
-- their own table. One threshold mechanism instead of two.
CREATE TABLE alert_thresholds (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    senior_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    metric_type metric_type NOT NULL,
    min_value   numeric(12,3),
    max_value   numeric(12,3),
    severity    alert_severity NOT NULL DEFAULT 'warning',
    enabled     boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),

    UNIQUE (senior_id, metric_type),
    CONSTRAINT alert_thresholds_bound_present
        CHECK (min_value IS NOT NULL OR max_value IS NOT NULL),
    CONSTRAINT alert_thresholds_bounds_ordered
        CHECK (min_value IS NULL OR max_value IS NULL OR min_value < max_value)
);

CREATE INDEX idx_alert_thresholds_senior_enabled
    ON alert_thresholds (senior_id)
    WHERE enabled;

CREATE TRIGGER alert_thresholds_set_updated_at
    BEFORE UPDATE ON alert_thresholds
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- A threshold breach that happened.
--
-- threshold_min/max are SNAPSHOTS of the bounds at trigger time, not foreign
-- keys to alert_thresholds. A caregiver who later widens the safe range must
-- not silently rewrite the history of why an alert fired.
CREATE TABLE alerts (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    senior_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    metric_type     metric_type NOT NULL,
    severity        alert_severity NOT NULL,
    triggered_value numeric(12,3) NOT NULL,
    threshold_min   numeric(12,3),
    threshold_max   numeric(12,3),
    message         text NOT NULL,
    -- Nullable: blood pressure alerts have no measurements row to point at,
    -- and we keep the alert even if the reading is later purged.
    measurement_id  bigint REFERENCES measurements(id) ON DELETE SET NULL,
    triggered_at    timestamptz NOT NULL DEFAULT now(),
    acknowledged_at timestamptz,
    acknowledged_by uuid REFERENCES users(id) ON DELETE SET NULL,

    CONSTRAINT alerts_ack_consistent
        CHECK ((acknowledged_at IS NULL) = (acknowledged_by IS NULL))
);

-- The query the caregiver dashboard polls: open alerts, newest first.
CREATE INDEX idx_alerts_open
    ON alerts (senior_id, triggered_at DESC)
    WHERE acknowledged_at IS NULL;

-- Full history, for the alert log screen.
CREATE INDEX idx_alerts_senior_time
    ON alerts (senior_id, triggered_at DESC);

COMMIT;
