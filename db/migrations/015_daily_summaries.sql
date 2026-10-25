-- 015: a plain-language summary of each senior's week
--
-- The dashboard shows a caregiver numbers. Most of them are not clinicians,
-- and a seven-day heart-rate chart does not answer the question they actually
-- have, which is "is Mum alright this week". This caches one short written
-- summary per senior per local day, generated from data the dashboard already
-- holds.
--
-- Cached rather than generated per page load for three reasons: the same day
-- is viewed many times, generation takes a second or two, and a sibling
-- opening the page should read the same words as you.
--
-- Keyed on the senior's LOCAL date, not UTC. "Today" for a senior in New York
-- is a different window than for their child in San Francisco, and the
-- summary belongs to the senior's day.

BEGIN;

CREATE TABLE senior_summaries (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    senior_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    local_date   date NOT NULL,
    summary      text NOT NULL,
    -- Which model wrote it, so output can be compared after a model change.
    model        text NOT NULL,
    generated_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (senior_id, local_date),
    CONSTRAINT senior_summaries_not_blank CHECK (length(btrim(summary)) > 0),
    -- A summary is a paragraph. A much longer one means the prompt or the
    -- model misbehaved, and the database should not store the result.
    CONSTRAINT senior_summaries_reasonable_length CHECK (length(summary) <= 2000)
);

CREATE INDEX idx_senior_summaries_lookup ON senior_summaries (senior_id, local_date DESC);

-- Same posture as every other table: deny by default, then a read policy
-- scoped to the caregivers actually linked to that senior.
ALTER TABLE senior_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY senior_summaries_select ON senior_summaries
    FOR SELECT TO authenticated
    USING (senior_id IN (SELECT public.visible_senior_ids()));

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT SELECT ON senior_summaries TO authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON senior_summaries FROM anon;
    END IF;
END $$;

COMMENT ON TABLE senior_summaries IS
    'One cached plain-language summary per senior per local day. Written by the model named in `model`; describes patterns only, never diagnoses.';

COMMIT;
