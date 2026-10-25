-- 016: readable alert text
--
-- Generated alerts read like this:
--
--   "Spo2 is 87 %, outside the safe range"
--
-- against hand-written seed messages like:
--
--   "Blood oxygen fell to 88%, below the safe minimum of 92%."
--
-- initcap() on an enum name produces "Spo2" and "Blood Pressure Systolic",
-- the unit gets a stray space before "%", and "outside the safe range" does
-- not say which way. A caregiver reading an alert at 3am should not have to
-- work out whether the number was too high or too low.
--
-- These are helpers rather than a rewritten message, so the ingest path and
-- anything added later word alerts the same way.

BEGIN;

-- What a person calls the metric, not what the column calls it.
CREATE OR REPLACE FUNCTION public.metric_label(m metric_type)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE m
        WHEN 'heart_rate'               THEN 'Heart rate'
        WHEN 'resting_heart_rate'       THEN 'Resting heart rate'
        WHEN 'spo2'                     THEN 'Blood oxygen'
        WHEN 'body_temperature'         THEN 'Temperature'
        WHEN 'respiratory_rate'         THEN 'Breathing rate'
        WHEN 'steps'                    THEN 'Steps'
        WHEN 'distance'                 THEN 'Distance walked'
        WHEN 'calories_burned'          THEN 'Calories burned'
        WHEN 'active_minutes'           THEN 'Active minutes'
        WHEN 'floors_climbed'           THEN 'Floors climbed'
        WHEN 'weight'                   THEN 'Weight'
        WHEN 'height'                   THEN 'Height'
        WHEN 'blood_glucose'            THEN 'Blood glucose'
        WHEN 'blood_pressure_systolic'  THEN 'Blood pressure (upper number)'
        WHEN 'blood_pressure_diastolic' THEN 'Blood pressure (lower number)'
    END
$$;

-- "87%" not "87.000 %"; "145 bpm" not "145.000 bpm".
CREATE OR REPLACE FUNCTION public.format_reading(value numeric, unit text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN unit = '%' THEN trim_scale(value)::text || '%'
        ELSE trim_scale(value)::text || ' ' || unit
    END
$$;

/**
 * The sentence a caregiver reads. Says which direction the reading went,
 * because "outside the safe range" leaves them to work it out.
 */
CREATE OR REPLACE FUNCTION public.threshold_alert_message(
    p_metric metric_type,
    p_value  numeric,
    p_unit   text,
    p_min    numeric,
    p_max    numeric
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_max IS NOT NULL AND p_value > p_max THEN
            format('%s reached %s, above the safe maximum of %s.',
                   public.metric_label(p_metric),
                   public.format_reading(p_value, p_unit),
                   public.format_reading(p_max, p_unit))
        WHEN p_min IS NOT NULL AND p_value < p_min THEN
            format('%s fell to %s, below the safe minimum of %s.',
                   public.metric_label(p_metric),
                   public.format_reading(p_value, p_unit),
                   public.format_reading(p_min, p_unit))
        ELSE
            format('%s is %s, outside the safe range.',
                   public.metric_label(p_metric),
                   public.format_reading(p_value, p_unit))
    END
$$;

COMMENT ON FUNCTION public.threshold_alert_message(metric_type, numeric, text, numeric, numeric) IS
    'The wording a caregiver sees for a threshold breach. Deliberately a fixed template, not generated text: an alert must be instant, identical every time, and cannot fail when an API does.';

COMMIT;
