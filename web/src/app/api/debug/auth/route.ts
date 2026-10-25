import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";

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

export async function GET() {
  const session = await auth0.getSession();
  if (!session) {
    return NextResponse.json({ ok: false, problem: "Not signed in. Visit /auth/login first." }, { status: 401 });
  }

  const idToken = session.tokenSet?.idToken;
  if (!idToken) {
    return NextResponse.json({
      ok: false,
      problem: "No ID token in the session. Sign out and back in.",
    });
  }

  const claims = decodePayload(idToken);
  const role = claims?.role;
  const roleOk = role === "authenticated";

  return NextResponse.json({
    ok: roleOk,
    checks: {
      signedIn: true,
      hasIdToken: true,
      roleClaim: role ?? null,
      roleClaimCorrect: roleOk,
    },
    // What the RLS policies in migration 010 match on.
    sub: claims?.sub ?? null,
    issuer: claims?.iss ?? null,
    expiresAt: claims?.exp ? new Date(Number(claims.exp) * 1000).toISOString() : null,
    claimNames: claims ? Object.keys(claims).sort() : [],
    next: roleOk
      ? "Token looks right. Supabase will treat this user as `authenticated`."
      : "Missing `role: authenticated`. Check the Auth0 post-login Action is deployed AND added to the trigger flow, then sign out and back in -- the current token predates it.",
  });
}
