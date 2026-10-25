-- 017: spoken check-ins
--
-- Readings say what a body is doing, not how a person feels. A senior can
-- now tap a banner on their page and talk to a voice assistant about how
-- they are; when they finish, the conversation becomes a short note for the
-- family.
--
-- Only the note is stored, never the transcript. The senior is told up front
-- that a summary goes to their family; a verbatim record of everything they
-- said is more than they agreed to, and more than a caregiver needs.

BEGIN;

CREATE TABLE check_ins (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    senior_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The signed-in account the check-in ran on (a caregiver's phone or a
    -- shared tablet). The words are the senior's either way.
    started_by  uuid REFERENCES users(id) ON DELETE SET NULL,
    started_at  timestamptz NOT NULL,
    ended_at    timestamptz NOT NULL DEFAULT now(),
    -- How many times the senior spoke, so a one-line check-in reads as one.
    senior_turns integer NOT NULL,
    summary     text NOT NULL,
    -- Raised by a red-flag phrase or by the model. The alert itself is in
    -- `alerts`; this marks which notes to read first.
    needs_attention boolean NOT NULL DEFAULT false,
    -- Which model wrote the note, so output can be compared after a change.
    model       text NOT NULL,

    CONSTRAINT check_ins_ordered CHECK (ended_at >= started_at),
    CONSTRAINT check_ins_turns_positive CHECK (senior_turns > 0),
    CONSTRAINT check_ins_summary_not_blank CHECK (length(btrim(summary)) > 0),
    -- A note is a paragraph. Much longer means the model misbehaved.
    CONSTRAINT check_ins_summary_length CHECK (length(summary) <= 1500)
);

CREATE INDEX idx_check_ins_senior_time ON check_ins (senior_id, ended_at DESC);

-- Same posture as every other table: deny by default, then a read policy
-- scoped to the caregivers actually linked to that senior.
ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;

CREATE POLICY check_ins_select ON check_ins
    FOR SELECT TO authenticated
    USING (senior_id IN (SELECT public.visible_senior_ids()));

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT SELECT ON check_ins TO authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON check_ins FROM anon;
    END IF;
END $$;

COMMENT ON TABLE check_ins IS
    'One plain-language note per spoken check-in. The transcript is deliberately not stored.';

COMMIT;

-- An alert raised by something the senior said, not by a reading.
-- Outside the transaction above: a value added to an enum cannot be used in
-- the transaction that adds it, and keeping it separate makes re-running safe.
ALTER TYPE alert_kind ADD VALUE IF NOT EXISTS 'check_in';

COMMENT ON COLUMN alerts.alert_kind IS
    'threshold = a reading outside its safe range. no_data = nothing arrived for too long. check_in = something the senior said during a check-in.';
