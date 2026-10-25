import { NextResponse, type NextRequest } from "next/server";
import { auth0 } from "./lib/auth0";

// Mounts Auth0's /auth/login, /auth/logout, /auth/callback and /auth/profile
// routes, and keeps the session cookie fresh on the routes that read it. It
// does not block pages: each one checks the session via getCurrentCaregiver().

/**
 * Sends every authenticated route to the one host in APP_BASE_URL.
 *
 * Auth0's login flow writes a short-lived state cookie on the origin that
 * started it, then verifies it at the callback. The callback host is fixed by
 * APP_BASE_URL, so beginning on any other host guarantees failure: the cookie
 * belongs to the origin you left, the browser does not send it to the one you
 * arrive at, and the SDK reports "The state parameter is invalid".
 *
 * That is precisely what happened when the app moved to kin-care.health while
 * the old vercel.app URL stayed reachable. Redirecting before the cookie is
 * written makes the mismatch impossible rather than something to remember.
 *
 * Only the matched routes below, so device ingest is untouched -- a 308 on
 * POST /api/devices/sync would break any client that doesn't re-send the body.
 */
function canonicalHostRedirect(request: NextRequest): NextResponse | undefined {
  const base = process.env.APP_BASE_URL;
  if (!base) return undefined;

  let canonical: URL;
  try {
    canonical = new URL(base);
  } catch {
    return undefined; // a malformed APP_BASE_URL shouldn't take down every page
  }

  // The host the browser actually used. nextUrl.host is normalised by the
  // dev server and so can disagree with the Host header, which is what
  // decides where a cookie lands. Behind Vercel's proxy the original host
  // arrives in x-forwarded-host.
  const actual = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!actual || actual === canonical.host) return undefined;

  // Built against the canonical base rather than by mutating nextUrl.
  // NextURL overrides the host setter, so assigning to it leaves the origin
  // unchanged and produces a redirect to the same URL -- an instant loop.
  const target = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, canonical);
  return NextResponse.redirect(target, 308);
}

export async function proxy(request: NextRequest) {
  return canonicalHostRedirect(request) ?? auth0.middleware(request);
}

// Only the routes that use the Auth0 session. The landing page stays out so a
// missing or broken Auth0 config can't take down the public site, and
// /api/devices/* authenticates with device tokens, not Auth0.
// Add a route here if it starts calling auth0.getSession().
export const config = {
  matcher: ["/auth/:path*", "/login", "/dashboard/:path*", "/api/seniors/:path*", "/api/debug/:path*", "/api/realtime-token"],
};
