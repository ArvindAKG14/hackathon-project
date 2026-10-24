-- 001: Extensions, enum types, and shared helpers
--
-- Run order matters. Every later migration depends on the types defined here.

BEGIN;

-- Case-insensitive email comparison. gen_random_uuid() is built into PG 13+,
-- so pgcrypto is deliberately not required.
CREATE EXTENSION IF NOT EXISTS citext;

-- Who a user is to the system. A person is one or the other, never both:
-- a caregiver monitoring their parent is a 'caregiver', the parent is a 'senior'.
CREATE TYPE user_role AS ENUM ('senior', 'caregiver');

-- State of an established caregiver -> senior monitoring relationship.
CREATE TYPE link_status AS ENUM ('pending', 'accepted', 'revoked');

-- State of a share code before it becomes a link.
CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'expired', 'revoked');

-- Where a reading came from.
--   apple_health    - iOS HealthKit, pushed by the mobile app
--   health_connect  - Android Health Connect, pushed by the mobile app
--   manual          - typed in by a user
--   mock            - generated seed data; safe to bulk-delete before launch
CREATE TYPE health_provider AS ENUM ('apple_health', 'health_connect', 'manual', 'mock');

CREATE TYPE alert_severity AS ENUM ('info', 'warning', 'critical');

-- Every scalar metric the system understands.
-- blood_pressure_systolic/diastolic appear here so that thresholds and alerts
-- have one uniform mechanism, even though the readings themselves live in
-- their own two-column table.
CREATE TYPE metric_type AS ENUM (
    'heart_rate',
    'resting_heart_rate',
    'spo2',
    'body_temperature',
    'respiratory_rate',
    'steps',
    'distance',
    'calories_burned',
    'active_minutes',
    'floors_climbed',
    'weight',
    'blood_glucose',
    'blood_pressure_systolic',
    'blood_pressure_diastolic'
);

-- Keeps updated_at honest without the API having to remember.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

COMMIT;
