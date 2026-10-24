try {
  process.loadEnvFile();
} catch {
  // .env is optional; defaults below apply.
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
  simulatorIntervalMs: Number(process.env.SIMULATOR_INTERVAL_MS ?? 2000),

  /**
   * Postgres connection string. When unset the server still runs -- device syncs
   * land in the in-memory store only -- so nobody needs a database to work on
   * the dashboard. See backend/.env.example.
   */
  databaseUrl: process.env.DATABASE_URL,

  /**
   * Supabase's pooler terminates TLS with a certificate Node's bundled CA store
   * does not chain to, so verification is off by default for it. Set
   * DATABASE_SSL=verify once you ship a CA bundle, or DATABASE_SSL=off for a
   * plain local Postgres.
   */
  databaseSsl: process.env.DATABASE_SSL ?? "relaxed",

  /**
   * Maps an in-memory senior id to an existing users.id in the database, as
   * JSON: {"s1":"1111...-1111"}. Seniors with no entry get a UUID derived from
   * their id and a users row created on first sync, so this is only needed to
   * point a demo at seeded history.
   */
  seniorUuids: parseIdMap(process.env.SENIOR_UUIDS),
};

function parseIdMap(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    console.warn("[config] SENIOR_UUIDS is not valid JSON; ignoring it");
    return {};
  }
}
