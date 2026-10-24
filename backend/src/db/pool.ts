// Postgres connection. Optional: with no DATABASE_URL the server runs exactly as
// it did before, writing to the in-memory store only.
import { Pool } from "pg";
import { config } from "../config.js";

function sslOption(): false | { rejectUnauthorized: boolean } {
  if (config.databaseSsl === "off") return false;
  if (config.databaseSsl === "verify") return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

/** undefined when no DATABASE_URL is configured. Callers must handle that. */
export const pool = config.databaseUrl
  ? new Pool({
      connectionString: config.databaseUrl,
      // The Supabase session pooler counts every client against the project's
      // connection limit, and this process is one of several services.
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: sslOption(),
    })
  : undefined;

export const databaseEnabled = pool !== undefined;

/** Verifies the connection at startup so misconfiguration fails loudly, not silently. */
export async function checkConnection(): Promise<string | undefined> {
  if (!pool) return undefined;
  const { rows } = await pool.query<{ version: string }>("SELECT version()");
  return rows[0]?.version;
}

export async function closePool(): Promise<void> {
  await pool?.end();
}
