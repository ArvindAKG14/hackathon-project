-- 011: Who looks after whom, from both sides
--
-- caregiver_links already records every caregiver -> senior relationship, so
-- these are views over it rather than new tables: a second copy of the same
-- facts could drift out of step with the links that actually grant access.
--
--   senior_caregivers  one row per senior: the caregivers looking after them
--   caregiver_seniors  one row per caregiver: the seniors they look after
--
-- Only ACCEPTED links count; a pending or revoked link grants no access, so
-- it is not part of anyone's care team. People with no links still get a row
-- (count 0), so "who has nobody looking after them" is answerable at a glance.

BEGIN;

CREATE VIEW senior_caregivers AS
SELECT s.id                                                    AS senior_id,
       s.full_name                                             AS senior_name,
       count(c.id)                                             AS caregiver_count,
       coalesce(string_agg(
           c.full_name || coalesce(' (' || l.relationship || ')', ''),
           ', ' ORDER BY c.full_name), '')                     AS caregivers,
       coalesce(array_agg(c.id ORDER BY c.full_name)
                FILTER (WHERE c.id IS NOT NULL), '{}')         AS caregiver_ids
FROM users s
LEFT JOIN caregiver_links l ON l.senior_id = s.id AND l.status = 'accepted'
LEFT JOIN users c           ON c.id = l.caregiver_id
WHERE s.role = 'senior'
GROUP BY s.id, s.full_name;

COMMENT ON VIEW senior_caregivers IS
    'Each senior with the caregivers looking after them (accepted links only).';

CREATE VIEW caregiver_seniors AS
SELECT c.id                                                    AS caregiver_id,
       c.full_name                                             AS caregiver_name,
       count(s.id)                                             AS senior_count,
       coalesce(string_agg(
           s.full_name || coalesce(' (as ' || l.relationship || ')', ''),
           ', ' ORDER BY s.full_name), '')                     AS seniors,
       coalesce(array_agg(s.id ORDER BY s.full_name)
                FILTER (WHERE s.id IS NOT NULL), '{}')         AS senior_ids
FROM users c
LEFT JOIN caregiver_links l ON l.caregiver_id = c.id AND l.status = 'accepted'
LEFT JOIN users s           ON s.id = l.senior_id
WHERE c.role = 'caregiver'
GROUP BY c.id, c.full_name;

COMMENT ON VIEW caregiver_seniors IS
    'Each caregiver with the seniors they look after (accepted links only).';

-- Same posture as latest_measurements (008, 010): run with the caller's
-- permissions so RLS on users and caregiver_links still applies -- a caregiver
-- sees only their own care teams. Requires PG 15+.
ALTER VIEW senior_caregivers SET (security_invoker = on);
ALTER VIEW caregiver_seniors SET (security_invoker = on);

-- Supabase's default privileges grant new views to anon. Take that back, and
-- give authenticated read-only access as 010 does for everything else.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON senior_caregivers, caregiver_seniors FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON senior_caregivers, caregiver_seniors FROM authenticated;
        GRANT SELECT ON senior_caregivers, caregiver_seniors TO authenticated;
    END IF;
END $$;

COMMIT;
