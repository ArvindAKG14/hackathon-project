import "server-only";
import { randomInt } from "node:crypto";
import { pg } from "./pg";

// Account provisioning and caregiver <-> senior linking.
//
// Uses pg rather than supabase-js because both operations need guarantees
// PostgREST cannot express: an upsert that must not clobber an existing name,
// and an atomic claim of a single-use code.

/** No 0/O or 1/I -- share codes get read aloud over the phone. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const INVITE_TTL_DAYS = 7;

export interface Caregiver {
  id: string;
  full_name: string;
  email: string | null;
}

function generateCode(): string {
  const chunk = () => Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  return `${chunk()}-${chunk()}`; // matches link_invitations_code_format
}

/**
 * Returns the caregiver row for an Auth0 account, creating it on first sign-in.
 *
 * Provisioning is not authorization: a caregiver with no caregiver_links rows
 * can see nothing at all, because every read in data.ts checks the link first.
 * So auto-creating a row for anyone who authenticates grants no access -- it
 * only saves them from a dead end before they redeem a share code.
 */
export async function ensureCaregiver(
  sub: string,
  email: string | null,
  name: string | null,
): Promise<Caregiver> {
  const fullName = name?.trim() || email?.split("@")[0] || "Caregiver";

  const upsert = async (withEmail: string | null) =>
    pg().query<Caregiver>(
      `INSERT INTO users (auth0_sub, email, full_name, role)
       VALUES ($1, $2, $3, 'caregiver')
       ON CONFLICT (auth0_sub)
         DO UPDATE SET email = COALESCE(EXCLUDED.email, users.email)
       RETURNING id, full_name, email`,
      [sub, withEmail, fullName],
    );

  try {
    const { rows } = await upsert(email);
    return rows[0]!;
  } catch (error) {
    // users.email is UNIQUE, and one person can hold several Auth0 identities
    // for the same address (Google today, username/password tomorrow). The
    // second one must still get an account, just without claiming the email.
    if ((error as { code?: string }).code === "23505") {
      const { rows } = await upsert(null);
      return rows[0]!;
    }
    throw error;
  }
}

/**
 * Mints a share code for a senior. The caller must already be linked to them --
 * checked here rather than trusted from the route.
 */
export async function createLinkInvitation(
  caregiverId: string,
  seniorId: string,
): Promise<{ code: string; expiresAt: string } | undefined> {
  const allowed = await pg().query(
    `SELECT 1 FROM caregiver_links
     WHERE caregiver_id = $1 AND senior_id = $2 AND status = 'accepted'`,
    [caregiverId, seniorId],
  );
  if (allowed.rowCount === 0) return undefined;

  const { rows } = await pg().query<{ code: string; expires_at: string }>(
    `INSERT INTO link_invitations (code, senior_id, created_by, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)
     RETURNING code, expires_at`,
    [generateCode(), seniorId, caregiverId, INVITE_TTL_DAYS],
  );

  return { code: rows[0]!.code, expiresAt: rows[0]!.expires_at };
}

export type RedeemResult =
  | { ok: true; seniorId: string; seniorName: string }
  | { ok: false; reason: "invalid" | "self" | "already-linked" };

/**
 * Redeems a share code, creating the caregiver_links row.
 *
 * The UPDATE ... RETURNING claims the code atomically, so two people racing on
 * the same code cannot both consume it. Everything runs in one transaction: if
 * the link cannot be created the code stays unused rather than being burned.
 */
export async function redeemLinkInvitation(caregiverId: string, rawCode: string): Promise<RedeemResult> {
  const code = rawCode.trim().toUpperCase();
  const client = await pg().connect();

  try {
    await client.query("BEGIN");

    const claimed = await client.query<{ senior_id: string }>(
      `UPDATE link_invitations
       SET status = 'accepted', accepted_at = now(), accepted_by = $2
       WHERE code = $1 AND status = 'pending' AND expires_at > now()
       RETURNING senior_id`,
      [code, caregiverId],
    );
    if (claimed.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "invalid" };
    }

    const seniorId = claimed.rows[0]!.senior_id;
    // caregiver_links has a CHECK (caregiver_id <> senior_id).
    if (seniorId === caregiverId) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "self" };
    }

    const linked = await client.query<{ already: boolean }>(
      `INSERT INTO caregiver_links (caregiver_id, senior_id, status)
       VALUES ($1, $2, 'accepted')
       ON CONFLICT (caregiver_id, senior_id)
         DO UPDATE SET status = 'accepted'
       RETURNING (xmax <> 0) AS already`,
      [caregiverId, seniorId],
    );

    const senior = await client.query<{ full_name: string }>(
      `SELECT full_name FROM users WHERE id = $1`,
      [seniorId],
    );

    await client.query("COMMIT");

    if (linked.rows[0]?.already) return { ok: false, reason: "already-linked" };
    return { ok: true, seniorId, seniorName: senior.rows[0]?.full_name ?? "your family member" };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
