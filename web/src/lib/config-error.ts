/**
 * A missing or malformed environment variable, as opposed to a runtime
 * failure like a dropped connection.
 *
 * The distinction earns its keep in production. The error boundary hides real
 * messages there -- rightly, since they can carry query fragments or row data
 * -- but that also turns "SUPABASE_SECRET_KEY was never set on Vercel" into
 * "the health database didn't respond", which sends you hunting a network
 * problem that does not exist.
 *
 * The name of an absent variable is not a secret, so these messages are shown
 * in production. Values never are.
 */
export class ConfigError extends Error {
  readonly missing: string[];

  constructor(missing: string[], hint: string) {
    super(`Missing configuration: ${missing.join(", ")}. ${hint}`);
    this.name = "ConfigError";
    this.missing = missing;
  }
}

/** Structured-clone-safe check: `instanceof` does not survive the RSC boundary. */
export function isConfigError(error: unknown): boolean {
  return (
    error instanceof ConfigError ||
    (typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof (error as Error).message === "string" &&
      (error as Error).message.startsWith("Missing configuration:"))
  );
}
