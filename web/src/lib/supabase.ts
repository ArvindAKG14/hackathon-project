import "server-only";
import { createClient } from "@supabase/supabase-js";

// Server-only client using the secret key. The schema has no row-level
// security, so every query that returns a senior's data must go through
// the authorization check in data.ts first.
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
