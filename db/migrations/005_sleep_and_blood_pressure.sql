-- 005: The two metrics that do not fit "one number plus a unit"

BEGIN;

-- A night's sleep is a span with a breakdown, not a reading.
-- Stage minutes are stored as reported; they are allowed to sum to LESS than
-- total_minutes because some sources report unclassified time.
CREATE TABLE sleep_sessions (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    senior_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data_source_id uuid REFERENCES data_sources(id) ON DELETE SET NULL,
    started_at     timestamptz NOT NULL,
    ended_at       timestamptz NOT NULL,
    total_minutes  integer NOT NULL,
    deep_minutes   integer NOT NULL DEFAULT 0,
    light_minutes  integer NOT NULL DEFAULT 0,
    rem_minutes    integer NOT NULL DEFAULT 0,
    awake_minutes  integer NOT NULL DEFAULT 0,
    external_id    text,
    ingested_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT sleep_sessions_ordered CHECK (ended_at > started_at),
    CONSTRAINT sleep_sessions_total_positive CHECK (total_minutes > 0),
    CONSTRAINT sleep_sessions_stages_nonneg
        CHECK (deep_minutes >= 0 AND light_minutes >= 0
               AND rem_minutes >= 0 AND awake_minutes >= 0),
    CONSTRAINT sleep_sessions_stages_fit
        CHECK (deep_minutes + light_minutes + rem_minutes + awake_minutes <= total_minutes)
);

CREATE UNIQUE INDEX uq_sleep_sessions_external
    ON sleep_sessions (senior_id, external_id)
    WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX uq_sleep_sessions_natural
    ON sleep_sessions (senior_id, started_at)
    WHERE external_id IS NULL;

CREATE INDEX idx_sleep_sessions_senior_time
    ON sleep_sessions (senior_id, started_at DESC);


-- Blood pressure is inherently two numbers taken together. Splitting it into
-- two measurements rows would let them drift apart; keeping them in one row
-- makes "140/90" atomic and lets the systolic > diastolic check exist at all.
CREATE TABLE blood_pressure_readings (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    senior_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data_source_id uuid REFERENCES data_sources(id) ON DELETE SET NULL,
    systolic       integer NOT NULL,
    diastolic      integer NOT NULL,
    pulse          integer,
    recorded_at    timestamptz NOT NULL,
    external_id    text,
    ingested_at    timestamptz NOT NULL DEFAULT now(),

    -- Ranges are deliberately wide: they reject transcription errors and
    -- unit mix-ups, not unusual-but-real clinical values.
    CONSTRAINT bp_systolic_range CHECK (systolic BETWEEN 40 AND 300),
    CONSTRAINT bp_diastolic_range CHECK (diastolic BETWEEN 20 AND 200),
    CONSTRAINT bp_systolic_above_diastolic CHECK (systolic > diastolic),
    CONSTRAINT bp_pulse_range CHECK (pulse IS NULL OR pulse BETWEEN 20 AND 250)
);

CREATE UNIQUE INDEX uq_blood_pressure_external
    ON blood_pressure_readings (senior_id, external_id)
    WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX uq_blood_pressure_natural
    ON blood_pressure_readings (senior_id, recorded_at)
    WHERE external_id IS NULL;

CREATE INDEX idx_blood_pressure_senior_time
    ON blood_pressure_readings (senior_id, recorded_at DESC);

COMMIT;
