-- 002: Users, caregiver links, and the invitation flow that creates them

BEGIN;

-- Authentication is delegated to Auth0. We store the `sub` claim from the ID
-- token, never a password.
--
-- auth0_sub is NULLABLE on purpose: a caregiver typically creates their
-- parent's profile before that parent has (or ever gets) an Auth0 account.
-- Such a senior is a real row with real readings but cannot log in.
--
-- email is denormalized from the ID token for display and search. It is NOT
-- the authentication key -- auth0_sub is.
CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auth0_sub     text UNIQUE,
    email         citext UNIQUE,
    full_name     text NOT NULL,
    role          user_role NOT NULL,
    date_of_birth date,
    phone         text,
    -- IANA zone. Needed because "today's step count" for a senior in Mumbai
    -- is a different window than for their child in New York.
    timezone      text NOT NULL DEFAULT 'UTC',
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT users_full_name_not_blank CHECK (length(btrim(full_name)) > 0),
    CONSTRAINT users_dob_plausible CHECK (date_of_birth IS NULL OR date_of_birth > DATE '1900-01-01')
);

CREATE INDEX idx_users_role ON users (role);

CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- An established monitoring relationship. One caregiver can watch several
-- seniors, and one senior can be watched by several children.
--
-- NOTE: that senior_id refers to a user with role='senior' is enforced in the
-- API, not by a constraint -- Postgres foreign keys cannot reference a literal
-- role value without a composite key that complicates every other join.
CREATE TABLE caregiver_links (
    caregiver_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    senior_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    relationship text,
    status       link_status NOT NULL DEFAULT 'pending',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (caregiver_id, senior_id),
    CONSTRAINT caregiver_links_not_self CHECK (caregiver_id <> senior_id)
);

-- "Who is allowed to see this senior's data" -- the authorization check on
-- every dashboard request.
CREATE INDEX idx_caregiver_links_senior_active
    ON caregiver_links (senior_id)
    WHERE status = 'accepted';

CREATE INDEX idx_caregiver_links_caregiver_active
    ON caregiver_links (caregiver_id)
    WHERE status = 'accepted';

CREATE TRIGGER caregiver_links_set_updated_at
    BEFORE UPDATE ON caregiver_links
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- A short, human-typeable share code. This is the consent step: a link is
-- never created silently, someone has to redeem a code.
--
-- Flow: the owner of a senior profile generates a code -> another family
-- member enters it -> the API writes a caregiver_links row with
-- status='accepted' and marks the invitation accepted.
CREATE TABLE link_invitations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text NOT NULL UNIQUE,
    senior_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_by  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      invitation_status NOT NULL DEFAULT 'pending',
    expires_at  timestamptz NOT NULL,
    accepted_at timestamptz,
    accepted_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),

    -- Readable over the phone to an 80-year-old: 'K7M2-9QX4'
    CONSTRAINT link_invitations_code_format CHECK (code ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}$'),
    -- An accepted invitation must record both who and when; an unaccepted one neither.
    CONSTRAINT link_invitations_accept_consistent
        CHECK ((status = 'accepted') = (accepted_at IS NOT NULL AND accepted_by IS NOT NULL))
);

CREATE INDEX idx_link_invitations_redeemable
    ON link_invitations (code)
    WHERE status = 'pending';

CREATE INDEX idx_link_invitations_senior ON link_invitations (senior_id);

COMMIT;
