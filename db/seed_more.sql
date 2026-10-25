-- seed_more.sql -- a second mock senior and more share codes, on top of seed.sql
--
-- Scenario: Walter Chen, 80, Margaret's husband. David looks after both of
-- his parents; Priya has been sent a code for her father but hasn't used it
-- yet. That gives the care team views (migration 011) something to show in
-- both directions: one caregiver with two seniors, one senior with two
-- caregivers.
--
-- Unlike seed.sql this truncates nothing, so it is safe on a database real
-- people have already signed in to: every insert skips rows that exist.
-- Run it after seed.sql:
--     psql "$DATABASE_URL" -f db/seed_more.sql

BEGIN;

-- Fixed UUID, continuing seed.sql's pattern:
--   Walter (senior)  44444444-...
INSERT INTO users (id, auth0_sub, email, full_name, role, date_of_birth, phone, timezone) VALUES
    ('44444444-4444-4444-4444-444444444444', NULL,
     NULL, 'Walter Chen', 'senior', DATE '1945-11-02', '+1-212-555-0183', 'America/New_York')
ON CONFLICT (id) DO NOTHING;

-- David set his father up, as he did his mother.
INSERT INTO caregiver_links (caregiver_id, senior_id, relationship, status) VALUES
    ('22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444', 'son', 'accepted')
ON CONFLICT (caregiver_id, senior_id) DO NOTHING;

-- One code in every state the invitation UI has to handle:
--   pending  -- Walter's, waiting for Priya; and a second one for Margaret
--   expired  -- sent and never used
--   revoked  -- withdrawn before it was used
-- seed.sql already has one accepted and one pending code for Margaret.
INSERT INTO link_invitations (code, senior_id, created_by, status, expires_at) VALUES
    ('H3PW-6KD9', '44444444-4444-4444-4444-444444444444',
     '22222222-2222-2222-2222-222222222222', 'pending', now() + interval '7 days'),
    ('W2XG-5NB8', '11111111-1111-1111-1111-111111111111',
     '33333333-3333-3333-3333-333333333333', 'pending', now() + interval '6 days'),
    ('R5ZN-4FT2', '11111111-1111-1111-1111-111111111111',
     '33333333-3333-3333-3333-333333333333', 'expired', now() - interval '3 days'),
    ('C9LD-7HQ3', '44444444-4444-4444-4444-444444444444',
     '22222222-2222-2222-2222-222222222222', 'revoked', now() + interval '2 days')
ON CONFLICT (code) DO NOTHING;

COMMIT;
