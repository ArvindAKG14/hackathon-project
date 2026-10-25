import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";

// Hands the signed-in user their own Auth0 ID token, so the browser can
// authenticate to Supabase Realtime.
//
// Supabase's own example reads the token client-side via the SPA SDK. Here the
// session lives in an httpOnly cookie, which the browser deliberately cannot
// read, so it has to come back through an endpoint.
//
// The token is scoped to the caller and carries no more authority than the
// cookie already does -- and thanks to migration 010 that authority is read
// access to their own linked seniors, nothing else. Returned with
// `expiresAt` so the client can re-fetch rather than let a socket die
// holding an expired token.

export async function GET() {
  const session = await auth0.getSession();
  if (!session?.tokenSet?.idToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  return NextResponse.json(
    {
      token: session.tokenSet.idToken,
      expiresAt: session.tokenSet.expiresAt ?? null,
    },
    // Never let a proxy or the browser cache somebody's token.
    { headers: { "Cache-Control": "no-store, private" } },
  );
}
