import "server-only";
import { createClient } from "@supabase/supabase-js";

// Server-only client using the secret key. RLS is enabled on every table with
// no policies (db/migrations/008), so the anon key reads nothing at all; this
// key bypasses RLS. That makes the authorization check in data.ts the only
// thing standing between a caregiver and someone else's senior.
export function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
