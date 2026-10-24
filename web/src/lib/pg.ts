import "server-only";
import { Pool } from "pg";

// Direct Postgres access, used only by the ingest path.
//
// Reads go through supabase-js (PostgREST) in data.ts. Writes cannot: the
// device sync relies on ON CONFLICT DO NOTHING against the partial unique
// indexes in migrations 004 and 005, and PostgREST's on_conflict parameter
// only takes a column list -- it cannot express the WHERE predicate those
// indexes carry, so inference fails. Raw SQL it is.
//
// DATABASE_URL should be Supabase's TRANSACTION pooler (port 6543) in a
// serverless deployment, where every invocation may open its own connection.
// The session pooler (5432) is fine for a long-lived local dev server.

let pool: Pool | undefined;

export function pg(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL must be set in .env.local for device ingest");
  }

  pool = new Pool({
    connectionString,
    // Small on purpose: serverless instances multiply, and the pooler counts
    // every connection against the project limit.
    max: Number(process.env.DATABASE_POOL_MAX ?? 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // Supabase's pooler presents a cert Node's bundled CA store does not chain
    // to. Set DATABASE_SSL=verify once a CA bundle is shipped, off for local.
    ssl:
      process.env.DATABASE_SSL === "off"
        ? false
        : { rejectUnauthorized: process.env.DATABASE_SSL === "verify" },
  });

  return pool;
}
