// Mirrors the database into the in-memory store at startup.
//
// Without this the two halves of the system disagree about who exists: the
// Express API served hardcoded seniors (s1 "Kamala Devi") while the web app
// served Supabase rows (Margaret Chen). Same product, different people, and
// device syncs landed under ids the dashboard had never heard of.
//
// Loading identities from the database makes the in-memory senior ids BE the
// users.id UUIDs, so the SSE stream, the device pairing flow and the web app
// all refer to the same person.
import { pool } from "../db/pool.js";
import type { Senior, User } from "../types.js";
import * as store from "./store.js";

interface SeniorRow {
  id: string;
  full_name: string;
  date_of_birth: string | null;
  phone: string | null;
}

function ageFrom(dateOfBirth: string | null): number {
  if (!dateOfBirth) return 0;
  const born = new Date(dateOfBirth);
  const diff = Date.now() - born.getTime();
  return Math.max(0, Math.floor(diff / (365.2425 * 24 * 3_600_000)));
}

/**
 * Returns false when no database is configured, so the caller can fall back to
 * the hardcoded demo seed.
 */
export async function seedFromDatabase(): Promise<boolean> {
  if (!pool) return false;

  const [seniors, caregivers, links] = await Promise.all([
    pool.query<SeniorRow>(
      `SELECT id, full_name, date_of_birth, phone FROM users WHERE role = 'senior' ORDER BY full_name`,
    ),
    pool.query<{ id: string; full_name: string }>(
      `SELECT id, full_name FROM users WHERE role = 'caregiver' ORDER BY full_name`,
    ),
    pool.query<{ caregiver_id: string; senior_id: string }>(
      `SELECT caregiver_id, senior_id FROM caregiver_links WHERE status = 'accepted'`,
    ),
  ]);

  for (const row of caregivers.rows) {
    const user: User = { id: row.id, name: row.full_name };
    store.users.set(user.id, user);
  }

  for (const row of seniors.rows) {
    const senior: Senior = {
      id: row.id,
      name: row.full_name,
      age: ageFrom(row.date_of_birth),
      // The schema has no conditions column; this stays empty until one exists.
      conditions: [],
      emergencyContact: row.phone ?? "",
    };
    store.seniors.set(senior.id, senior);
  }

  for (const row of links.rows) {
    store.grantAccess(row.caregiver_id, row.senior_id);
  }

  console.log(
    `Loaded ${seniors.rowCount} senior(s), ${caregivers.rowCount} caregiver(s) and ${links.rowCount} link(s) from the database`,
  );
  return true;
}
