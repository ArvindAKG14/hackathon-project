import type { NextRequest } from "next/server";
import { auth0 } from "./lib/auth0";

// Mounts Auth0's /auth/login, /auth/logout, /auth/callback and /auth/profile
// routes, and keeps the session cookie fresh on the routes that read it. It
// does not block pages: each one checks the session via getCurrentCaregiver().
export async function proxy(request: NextRequest) {
  return auth0.middleware(request);
}

// Only the routes that use the Auth0 session. The landing page stays out so a
// missing or broken Auth0 config can't take down the public site, and
// /api/devices/* authenticates with device tokens, not Auth0.
// Add a route here if it starts calling auth0.getSession().
export const config = {
  matcher: ["/auth/:path*", "/login", "/dashboard/:path*", "/api/seniors/:path*", "/api/debug/:path*", "/api/realtime-token"],
};
