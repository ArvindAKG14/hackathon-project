import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { db } from "@/lib/supabase";
import { pg } from "@/lib/pg";

// Diagnostic for the Supabase Third-Party Auth wiring.
//
// Supabase trusts the Auth0 ID token, but only honours it as a logged-in user
// if the token carries `role: "authenticated"` -- which an Auth0 post-login
// Action has to add. When that claim is missing, Supabase silently treats the
// request as `anon`, and migration 008 revoked anon, so every query returns
// zero rows instead of an error. That failure is invisible from the client,
// which is exactly why this endpoint exists.
//
// Shows only the signed-in user's own claims. Safe to keep; safe to delete
// once Realtime is working.

/** Reads a JWT payload without verifying it -- Supabase does the verifying. */
function decodePayload(jwt: string): Record<string, unknown> | null {
  const segment = jwt.split(".")[1];
  if (!segment) return null;
  try {
    const json = Buffer.from(segment.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Which env vars exist. Presence only -- never a value. */
function configPresence() {
  const names = [
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "DATABASE_URL",
    "APP_BASE_URL",
    "AUTH0_DOMAIN",
    "AUTH0_CLIENT_ID",
    "AUTH0_CLIENT_SECRET",
    "AUTH0_SECRET",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ];
  return Object.fromEntries(names.map((n) => [n, Boolean(process.env[n])]));
}

/** Actually exercises each path, since a present variable can still be wrong. */
async function connectivity() {
  const result: Record<string, string> = {};

  try {
    const { error } = await db().from("users").select("id").limit(1);
    result.supabaseRest = error ? `FAILED: ${error.message}` : "ok";
  } catch (e) {
    result.supabaseRest = `FAILED: ${e instanceof Error ? e.message : String(e)}`;
  }

  try {
    await pg().query("SELECT 1");
    result.postgres = "ok";
  } catch (e) {
    result.postgres = `FAILED: ${e instanceof Error ? e.message : String(e)}`;
  }

  return result;
}

export async function GET() {
  const config = configPresence();
  const reachable = await connectivity();
  const session = await auth0.getSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, problem: "Not signed in. Visit /auth/login first.", config, reachable },
      { status: 401 },
    );
  }

  const idToken = session.tokenSet?.idToken;
  if (!idToken) {
    return NextResponse.json({
      ok: false,
      problem: "No ID token in the session. Sign out and back in.",
      config,
      reachable,
    });
  }

  const claims = decodePayload(idToken);
  const roleOk = claims?.role === "authenticated";

  // A namespaced claim means the Action ran but used a namespace. Supabase
  // wants the bare `role`, which Auth0 does permit on ID tokens.
  const namespacedRole = claims
    ? Object.entries(claims).find(([k]) => k !== "role" && k.endsWith("/role"))
    : undefined;

  const issuedAt = claims?.iat ? new Date(Number(claims.iat) * 1000) : null;
  const tokenAgeMinutes = issuedAt ? Math.round((Date.now() - issuedAt.getTime()) / 60_000) : null;

  let next: string;
  if (roleOk) {
    next = "Token looks right. Supabase will treat this user as `authenticated`.";
  } else if (namespacedRole) {
    next = `The Action ran but set "${namespacedRole[0]}". Supabase needs the bare claim: api.idToken.setCustomClaim('role', 'authenticated').`;
  } else if (tokenAgeMinutes !== null && tokenAgeMinutes > 5) {
    next = `No role claim, and this token is ${tokenAgeMinutes} minutes old -- it may simply predate the Action. Sign out, sign back in, and re-check before changing anything in Auth0.`;
  } else {
    next =
      "No role claim on a freshly issued token, so the Action is not running. In Auth0: Actions > Triggers > post-login -- the Action must appear IN the flow diagram and you must press Apply. Deploying it from the Library alone does nothing.";
  }

  return NextResponse.json({
    ok: roleOk && reachable.supabaseRest === "ok" && reachable.postgres === "ok",
    config,
    reachable,
    checks: {
      signedIn: true,
      hasIdToken: true,
      roleClaim: claims?.role ?? null,
      roleClaimCorrect: roleOk,
      namespacedRoleFound: namespacedRole ? namespacedRole[0] : null,
    },
    token: {
      // Decides whether a missing claim means "Action broken" or "token too old".
      issuedAt: issuedAt?.toISOString() ?? null,
      ageMinutes: tokenAgeMinutes,
      expiresAt: claims?.exp ? new Date(Number(claims.exp) * 1000).toISOString() : null,
    },
    // What the RLS policies in migration 010 match on.
    sub: claims?.sub ?? null,
    issuer: claims?.iss ?? null,
    claimNames: claims ? Object.keys(claims).sort() : [],
    next,
  });
}
