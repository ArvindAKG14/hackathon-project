-- 009: Persist device pairing, so ingest can run serverless
--
-- Pairing codes and device tokens used to live in a Map inside the Express
-- process. That already meant every paired phone was forgotten on restart;
-- once ingest moves into Next.js route handlers it breaks outright, because
-- each request may be a different instance with no shared memory.

BEGIN;

-- A phone authenticates with a bearer token it received when pairing. Only the
-- SHA-256 hash is stored, so a database leak does not hand out working tokens.
ALTER TABLE data_sources
    ADD COLUMN token_hash text UNIQUE,
    ADD COLUMN device_name text,
    ADD COLUMN revoked_at timestamptz;

-- Lookup path for every sync request.
CREATE INDEX idx_data_sources_active_token
    ON data_sources (token_hash)
    WHERE token_hash IS NOT NULL AND revoked_at IS NULL;


-- A short code a caregiver reads out to set a phone up. Single use, short TTL.
CREATE TABLE device_pairing_codes (
    code       text PRIMARY KEY,
    senior_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),

    -- Alphabet excludes 0/O and 1/I: these get read aloud over the phone.
    CONSTRAINT device_pairing_codes_format CHECK (code ~ '^[A-HJ-NP-Z2-9]{8}$')
);

CREATE INDEX idx_device_pairing_codes_senior ON device_pairing_codes (senior_id);

-- Same deny-all posture as every other table (see 008).
ALTER TABLE device_pairing_codes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON device_pairing_codes FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON device_pairing_codes FROM authenticated;
    END IF;
END $$;

COMMIT;
