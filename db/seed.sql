-- seed.sql -- realistic mock data for development and demos
--
-- Scenario: Margaret Chen, 77, lives in New York. Her two adult children,
-- David and Priya, both monitor her. Seven days of readings at the same
-- ~3 minute cadence the real mobile app will push at, plus two deliberate
-- threshold breaches so the alerts panel has content on demo day.
--
-- Everything here is tagged provider='mock'. To clear fake data before
-- launch:
--     DELETE FROM measurements WHERE data_source_id IN
--         (SELECT id FROM data_sources WHERE provider = 'mock');
--
-- Idempotent: truncates the tables it owns, so it is safe to re-run.
-- Timestamps are relative to NOW(), so the data always looks current.

BEGIN;

-- Reproducible pseudo-randomness: the same seed gives every teammate the
-- same curves, so "the heart rate chart looks wrong" is a comparable claim.
SELECT setseed(0.42);

TRUNCATE alerts, alert_thresholds, blood_pressure_readings, sleep_sessions,
         measurements, data_sources, link_invitations, caregiver_links, users
    RESTART IDENTITY CASCADE;


-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
-- Fixed UUIDs so the frontend can hardcode them during development.
--   Margaret (senior)  11111111-...
--   David (son)        22222222-...
--   Priya (daughter)   33333333-...
--
-- Margaret has no auth0_sub: David created her profile and she never logs in.
-- This is the common case and the schema is built for it.

INSERT INTO users (id, auth0_sub, email, full_name, role, date_of_birth, phone, timezone) VALUES
    ('11111111-1111-1111-1111-111111111111', NULL,
     NULL, 'Margaret Chen', 'senior', DATE '1948-03-12', '+1-212-555-0147', 'America/New_York'),
    ('22222222-2222-2222-2222-222222222222', 'auth0|mock-david-chen',
     'david.chen@example.com', 'David Chen', 'caregiver', DATE '1979-08-04', '+1-415-555-0162', 'America/Los_Angeles'),
    ('33333333-3333-3333-3333-333333333333', 'google-oauth2|mock-priya-chen',
     'priya.chen@example.com', 'Priya Chen', 'caregiver', DATE '1983-01-27', '+1-617-555-0198', 'America/New_York');

-- Both children watch Margaret. David set her up; Priya joined via a code.
INSERT INTO caregiver_links (caregiver_id, senior_id, relationship, status) VALUES
    ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'son', 'accepted'),
    ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'daughter', 'accepted');

-- One redeemed invitation (how Priya got access) and one still outstanding
-- (for a third sibling), so the invitation UI has both states to render.
INSERT INTO link_invitations (code, senior_id, created_by, status, expires_at, accepted_at, accepted_by) VALUES
    ('K7M2-9QX4', '11111111-1111-1111-1111-111111111111',
     '22222222-2222-2222-2222-222222222222', 'accepted',
     now() - interval '20 days', now() - interval '27 days',
     '33333333-3333-3333-3333-333333333333'),
    ('T4RB-8WN6', '11111111-1111-1111-1111-111111111111',
     '22222222-2222-2222-2222-222222222222', 'pending',
     now() + interval '5 days', NULL, NULL);


-- ---------------------------------------------------------------------------
-- Data source
-- ---------------------------------------------------------------------------
INSERT INTO data_sources (id, senior_id, provider, source_app, device_model, last_sync_at, last_sync_status) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
     'mock', 'seed.sql', 'Apple Watch Series 9', now() - interval '2 minutes', 'ok');


-- ---------------------------------------------------------------------------
-- Heart rate -- every 3 minutes for 7 days, on a diurnal curve
-- ---------------------------------------------------------------------------
-- Dips to the mid 50s overnight, climbs through the morning, peaks during
-- afternoon activity. This is the chart the dashboard leads with.
INSERT INTO measurements
    (senior_id, data_source_id, metric_type, value, unit, recorded_at, external_id)
SELECT
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'heart_rate',
    round((base + (random() * 8 - 4))::numeric, 3),
    'bpm',
    t,
    'mock-hr-' || extract(epoch FROM t)::bigint
FROM (
    SELECT t,
           CASE
               WHEN h <  6 THEN 56    -- asleep
               WHEN h <  9 THEN 70    -- waking, breakfast
               WHEN h < 12 THEN 77    -- morning errands
               WHEN h < 14 THEN 73    -- lunch, rest
               WHEN h < 18 THEN 80    -- afternoon walk
               WHEN h < 22 THEN 71    -- evening wind-down
               ELSE 61                -- settling to sleep
           END AS base
    FROM (
        SELECT t, EXTRACT(hour FROM t AT TIME ZONE 'America/New_York') AS h
        FROM generate_series(date_trunc('minute', now()) - interval '7 days',
                             date_trunc('minute', now()),
                             interval '3 minutes') AS t
    ) AS hours
) AS curve;


-- ---------------------------------------------------------------------------
-- SpO2 -- every 15 minutes, healthy 95-99%
-- ---------------------------------------------------------------------------
INSERT INTO measurements
    (senior_id, data_source_id, metric_type, value, unit, recorded_at, external_id)
SELECT
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'spo2',
    round((95 + random() * 4)::numeric, 3),
    '%',
    t,
    'mock-spo2-' || extract(epoch FROM t)::bigint
FROM generate_series(date_trunc('minute', now()) - interval '7 days',
                     date_trunc('minute', now()),
                     interval '15 minutes') AS t;


-- ---------------------------------------------------------------------------
-- Respiratory rate -- every 30 minutes
-- ---------------------------------------------------------------------------
INSERT INTO measurements
    (senior_id, data_source_id, metric_type, value, unit, recorded_at, external_id)
SELECT
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'respiratory_rate',
    round((14 + random() * 4)::numeric, 3),
    'breaths/min',
    t,
    'mock-rr-' || extract(epoch FROM t)::bigint
FROM generate_series(date_trunc('minute', now()) - interval '7 days',
                     date_trunc('minute', now()),
                     interval '30 minutes') AS t;


-- ---------------------------------------------------------------------------
-- Body temperature -- hourly
-- ---------------------------------------------------------------------------
INSERT INTO measurements
    (senior_id, data_source_id, metric_type, value, unit, recorded_at, external_id)
SELECT
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'body_temperature',
    round((36.4 + random() * 0.6)::numeric, 3),
    'degC',
    t,
    'mock-temp-' || extract(epoch FROM t)::bigint
FROM generate_series(date_trunc('hour', now()) - interval '7 days',
                     date_trunc('hour', now()),
                     interval '1 hour') AS t;


-- ---------------------------------------------------------------------------
-- Activity -- 15 minute INTERVAL samples, waking hours only
-- ---------------------------------------------------------------------------
-- Note period_start/period_end: these are spans, not instants, exactly as
-- HealthKit and Health Connect deliver them. Summing them over a day gives
-- the daily total; there is no stored cumulative counter to double-count.
INSERT INTO measurements
    (senior_id, data_source_id, metric_type, value, unit,
     recorded_at, period_start, period_end, external_id)
SELECT
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001',
    m.metric_type,
    m.value,
    m.unit,
    s.t + interval '15 minutes',
    s.t,
    s.t + interval '15 minutes',
    m.prefix || extract(epoch FROM s.t)::bigint
FROM (
    SELECT t, round((steps_raw)::numeric, 0) AS steps
    FROM (
        SELECT t,
               CASE
                   WHEN h BETWEEN  9 AND 11 THEN random() * 420   -- morning errands
                   WHEN h BETWEEN 16 AND 18 THEN random() * 460   -- afternoon walk
                   ELSE random() * 150                            -- pottering about
               END AS steps_raw
        FROM (
            SELECT t, EXTRACT(hour FROM t AT TIME ZONE 'America/New_York') AS h
            FROM generate_series(date_trunc('hour', now()) - interval '7 days',
                                 date_trunc('hour', now()),
                                 interval '15 minutes') AS t
        ) AS hours
        WHERE h BETWEEN 7 AND 20
    ) AS raw
) AS s
CROSS JOIN LATERAL (
    VALUES
        ('steps'::metric_type,           s.steps,                           'count', 'mock-steps-'),
        ('distance'::metric_type,        round(s.steps * 0.72, 3),          'm',     'mock-dist-'),
        ('calories_burned'::metric_type, round(s.steps * 0.042, 3),         'kcal',  'mock-cal-')
) AS m(metric_type, value, unit, prefix);


-- ---------------------------------------------------------------------------
-- Daily rollup metrics
-- ---------------------------------------------------------------------------
-- Recorded at 23:00 local each night: resting HR, active minutes, floors.
INSERT INTO measurements
    (senior_id, data_source_id, metric_type, value, unit, recorded_at, external_id)
SELECT
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001',
    m.metric_type,
    m.value,
    m.unit,
    d.ts,
    m.prefix || extract(epoch FROM d.ts)::bigint
FROM (
    SELECT (day::date + time '23:00') AT TIME ZONE 'America/New_York' AS ts
    FROM generate_series((CURRENT_DATE - 7)::timestamp,
                         (CURRENT_DATE - 1)::timestamp,
                         interval '1 day') AS day
) AS d
CROSS JOIN LATERAL (
    VALUES
        ('resting_heart_rate'::metric_type, round((56 + random() * 6)::numeric, 3),  'bpm',   'mock-rhr-'),
        ('active_minutes'::metric_type,     round((22 + random() * 38)::numeric, 0), 'min',   'mock-am-'),
        ('floors_climbed'::metric_type,     round((2 + random() * 7)::numeric, 0),   'count', 'mock-floors-')
) AS m(metric_type, value, unit, prefix);

-- Morning weight, 08:00 local, drifting slowly as real weight does.
INSERT INTO measurements
    (senior_id, data_source_id, metric_type, value, unit, recorded_at, external_id)
SELECT
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'weight',
    round((61.8 + random() * 0.8)::numeric, 3),
    'kg',
    ts,
    'mock-weight-' || extract(epoch FROM ts)::bigint
FROM (
    SELECT (day::date + time '08:00') AT TIME ZONE 'America/New_York' AS ts
    FROM generate_series((CURRENT_DATE - 7)::timestamp,
                         (CURRENT_DATE - 1)::timestamp,
                         interval '1 day') AS day
) AS d;

-- Blood glucose, before breakfast and after dinner.
INSERT INTO measurements
    (senior_id, data_source_id, metric_type, value, unit, recorded_at, external_id)
SELECT
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'blood_glucose',
    round((CASE WHEN slot = time '07:30' THEN 5.1 ELSE 6.4 END + random() * 1.2)::numeric, 3),
    'mmol/L',
    (day::date + slot) AT TIME ZONE 'America/New_York',
    'mock-glucose-' || extract(epoch FROM (day::date + slot) AT TIME ZONE 'America/New_York')::bigint
FROM generate_series((CURRENT_DATE - 7)::timestamp,
                     (CURRENT_DATE - 1)::timestamp,
                     interval '1 day') AS day
CROSS JOIN (VALUES (time '07:30'), (time '20:00')) AS slots(slot);


-- ---------------------------------------------------------------------------
-- Sleep -- one session per night
-- ---------------------------------------------------------------------------
INSERT INTO sleep_sessions
    (senior_id, data_source_id, started_at, ended_at, total_minutes,
     deep_minutes, light_minutes, rem_minutes, awake_minutes, external_id)
SELECT
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001',
    started_at,
    started_at + (total || ' minutes')::interval,
    total,
    deep,
    total - deep - rem - awake,   -- light absorbs the remainder
    rem,
    awake,
    'mock-sleep-' || extract(epoch FROM started_at)::bigint
FROM (
    SELECT started_at,
           total,
           round(total * 0.18)::int AS deep,
           round(total * 0.21)::int AS rem,
           round(total * 0.07)::int AS awake
    FROM (
        SELECT started_at,
               (400 + round(random() * 95))::int AS total
        FROM (
            SELECT (day::date + time '22:30') AT TIME ZONE 'America/New_York' AS started_at
            FROM generate_series((CURRENT_DATE - 7)::timestamp,
                                 (CURRENT_DATE - 1)::timestamp,
                                 interval '1 day') AS day
        ) AS nights
    ) AS durations
) AS stages;


-- ---------------------------------------------------------------------------
-- Blood pressure -- morning and evening, slightly elevated as is typical at 77
-- ---------------------------------------------------------------------------
INSERT INTO blood_pressure_readings
    (senior_id, data_source_id, systolic, diastolic, pulse, recorded_at, external_id)
SELECT
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001',
    (128 + round(random() * 14))::int,
    (76 + round(random() * 10))::int,
    (66 + round(random() * 12))::int,
    ts,
    'mock-bp-' || extract(epoch FROM ts)::bigint
FROM (
    SELECT (day::date + slot) AT TIME ZONE 'America/New_York' AS ts
    FROM generate_series((CURRENT_DATE - 7)::timestamp,
                         (CURRENT_DATE - 1)::timestamp,
                         interval '1 day') AS day
    CROSS JOIN (VALUES (time '08:15'), (time '20:30')) AS slots(slot)
) AS d;


-- ---------------------------------------------------------------------------
-- Safe ranges
-- ---------------------------------------------------------------------------
INSERT INTO alert_thresholds (senior_id, metric_type, min_value, max_value, severity) VALUES
    ('11111111-1111-1111-1111-111111111111', 'heart_rate',               50,   120,  'critical'),
    ('11111111-1111-1111-1111-111111111111', 'spo2',                     92,   NULL, 'critical'),
    ('11111111-1111-1111-1111-111111111111', 'body_temperature',         35.5, 38.0, 'warning'),
    ('11111111-1111-1111-1111-111111111111', 'respiratory_rate',         10,   24,   'warning'),
    ('11111111-1111-1111-1111-111111111111', 'blood_pressure_systolic',  NULL, 145,  'warning'),
    ('11111111-1111-1111-1111-111111111111', 'blood_pressure_diastolic', NULL, 95,   'warning'),
    ('11111111-1111-1111-1111-111111111111', 'blood_glucose',            3.9,  10.0, 'warning');


-- ---------------------------------------------------------------------------
-- Two deliberate breaches, so the alerts panel is not empty
-- ---------------------------------------------------------------------------
-- These sit one minute off the 3-minute grid so they are clearly visible as
-- distinct spikes on the chart rather than blending into a sample.

-- Tachycardia, two days ago, afternoon: 138 bpm against a 120 ceiling.
INSERT INTO measurements
    (senior_id, data_source_id, metric_type, value, unit, recorded_at, external_id)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
     'heart_rate', 138.000, 'bpm',
     date_trunc('minute', now()) - interval '2 days' + interval '1 minute',
     'mock-hr-spike-1');

-- SpO2 dip, nine hours ago: 88% against a 92% floor.
INSERT INTO measurements
    (senior_id, data_source_id, metric_type, value, unit, recorded_at, external_id)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
     'spo2', 88.000, '%',
     date_trunc('minute', now()) - interval '9 hours' + interval '1 minute',
     'mock-spo2-dip-1');

-- The resulting alerts. threshold_min/max are snapshotted from the ranges
-- above, matching what the ingest path will do in production.
-- The heart rate one is already acknowledged by David; the SpO2 one is open.
INSERT INTO alerts
    (senior_id, metric_type, severity, triggered_value, threshold_min, threshold_max,
     message, measurement_id, triggered_at, acknowledged_at, acknowledged_by)
SELECT
    m.senior_id, 'heart_rate', 'critical', m.value, 50, 120,
    'Heart rate reached 138 bpm, above the safe maximum of 120 bpm.',
    m.id, m.recorded_at,
    m.recorded_at + interval '14 minutes',
    '22222222-2222-2222-2222-222222222222'
FROM measurements m
WHERE m.external_id = 'mock-hr-spike-1';

INSERT INTO alerts
    (senior_id, metric_type, severity, triggered_value, threshold_min, threshold_max,
     message, measurement_id, triggered_at)
SELECT
    m.senior_id, 'spo2', 'critical', m.value, 92, NULL,
    'Blood oxygen fell to 88%, below the safe minimum of 92%.',
    m.id, m.recorded_at
FROM measurements m
WHERE m.external_id = 'mock-spo2-dip-1';

COMMIT;
