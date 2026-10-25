import "server-only";
import { createClient } from "@supabase/supabase-js";
import { ConfigError } from "./config-error";

// Server-only client using the secret key, which bypasses RLS. Policies exist
// (db/migrations/010) and apply to browser requests, but not to this client --
// so the caregiver_links check in data.ts is still what stands between a
// caregiver and someone else's senior on the server side.
export function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    const missing = [!url ? "SUPABASE_URL" : null, !key ? "SUPABASE_SECRET_KEY" : null].filter(
      (v) => v !== null,
    );
    throw new ConfigError(
      missing,
      "Set it in web/.env.local locally, or in the Vercel project's environment variables.",
    );
  }

  return createClient(url, key, { auth: { persistSession: false } });
}
