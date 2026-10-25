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

export interface NewCareRecipient {
  fullName: string;
  dateOfBirth: string | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  relationship: string;
  /** Already converted to canonical units by the caller. */
  weightKg: number | null;
  heightCm: number | null;
  thresholds: { metric: string; min: number | null; max: number | null }[];
}

export type CreateRecipientResult =
  | { ok: true; seniorId: string }
  | { ok: false; reason: string };

/**
 * Creates a senior, links the caregiver to them, records any starting
 * measurements, and sets their safe ranges -- all in one transaction, so a
 * failure half way cannot leave a senior nobody is linked to.
 *
 * The senior gets no auth0_sub. That is the normal case: the person being
 * monitored usually never signs in, and migration 002 made the column
 * nullable precisely for this.
 */
export async function createCareRecipient(
  caregiverId: string,
  input: NewCareRecipient,
): Promise<CreateRecipientResult> {
  const client = await pg().connect();

  try {
    await client.query("BEGIN");

    let seniorId: string;
    try {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO users (full_name, role, date_of_birth, phone, email, timezone)
         VALUES ($1, 'senior', $2, $3, $4, $5)
         RETURNING id`,
        [input.fullName, input.dateOfBirth, input.phone, input.email, input.timezone],
      );
      seniorId = rows[0]!.id;
    } catch (error) {
      // users.email is UNIQUE and citext, so a repeat address collides even
      // with different capitalisation. Worth naming, since the caregiver can fix it.
      if ((error as { code?: string }).code === "23505") {
        await client.query("ROLLBACK");
        return { ok: false, reason: "Someone with that email address is already on KinCare." };
      }
      throw error;
    }

    await client.query(
      `INSERT INTO caregiver_links (caregiver_id, senior_id, relationship, status)
       VALUES ($1, $2, $3, 'accepted')`,
      [caregiverId, seniorId, input.relationship],
    );

    // Weight and height are readings, not profile fields, so they need a
    // source. 'manual' is what the health_provider enum has for typed-in data.
    const starting = [
      input.weightKg !== null ? { metric: "weight", value: input.weightKg, unit: "kg" } : null,
      input.heightCm !== null ? { metric: "height", value: input.heightCm, unit: "cm" } : null,
    ].filter((m) => m !== null);

    if (starting.length > 0) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO data_sources (senior_id, provider, source_app, device_model)
         VALUES ($1, 'manual', 'dashboard', 'Entered by a caregiver')
         RETURNING id`,
        [seniorId],
      );
      const dataSourceId = rows[0]!.id;

      await client.query(
        `INSERT INTO measurements (senior_id, data_source_id, metric_type, value, unit, recorded_at)
         SELECT $1, $2, m.metric_type::metric_type, m.value, m.unit, now()
         FROM unnest($3::text[], $4::numeric[], $5::text[]) AS m(metric_type, value, unit)`,
        [
          seniorId,
          dataSourceId,
          starting.map((m) => m.metric),
          starting.map((m) => m.value),
          starting.map((m) => m.unit),
        ],
      );
    }

    // A row with neither bound would violate alert_thresholds_bound_present,
    // so "no limit either side" means no threshold at all.
    const bounded = input.thresholds.filter((t) => t.min !== null || t.max !== null);
    const inverted = bounded.find((t) => t.min !== null && t.max !== null && t.min >= t.max);
    if (inverted) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        reason: `The safe range for ${inverted.metric.replace(/_/g, " ")} has its lowest value above its highest.`,
      };
    }

    if (bounded.length > 0) {
      await client.query(
        `INSERT INTO alert_thresholds (senior_id, metric_type, min_value, max_value)
         SELECT $1, t.metric_type::metric_type, t.min_value, t.max_value
         FROM unnest($2::text[], $3::numeric[], $4::numeric[]) AS t(metric_type, min_value, max_value)`,
        [
          seniorId,
          bounded.map((t) => t.metric),
          bounded.map((t) => t.min),
          bounded.map((t) => t.max),
        ],
      );
    }

    await client.query("COMMIT");
    return { ok: true, seniorId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
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
