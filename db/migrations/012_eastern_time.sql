-- 012: Show times in Eastern Time, the team's base time zone
--
-- Every timestamp column is timestamptz, which stores an exact instant and
-- displays it in the session's TimeZone. Supabase defaults that to UTC, so a
-- user created at 3:11 a.m. in New York showed as 07:11 in the table editor.
-- This changes the database default to America/New_York: EDT (UTC-4) in
-- summer, EST (UTC-5) in winter, switching on its own.
--
-- Nothing stored changes -- only how it is shown -- so created_at, updated_at
-- and every reading stay correct. The columns stay timestamptz on purpose: a
-- plain timestamp in local time would be ambiguous for the hour that repeats
-- when clocks go back in November.
--
-- Applies to new connections. Pooled connections opened before this keep UTC
-- until the pooler recycles them. Apps never depend on it either way: the
-- database answers with an explicit offset ("...-04:00"), which parses to the
-- same instant as the UTC form.

BEGIN;

DO $$
BEGIN
    EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'America/New_York');
END $$;

COMMIT;
