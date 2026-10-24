import type { NextRequest } from "next/server";
import { auth0 } from "./lib/auth0";

// Mounts Auth0's /auth/login, /auth/logout, /auth/callback and /auth/profile
// routes, and keeps the session cookie fresh on every other request. It does
// not block pages: each page checks the session itself via getCurrentCaregiver().
export async function proxy(request: NextRequest) {
  return auth0.middleware(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
