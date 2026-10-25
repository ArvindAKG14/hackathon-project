import "server-only";
import { redirect } from "next/navigation";
import { ensureCaregiver } from "./accounts";
import { auth0 } from "./auth0";

// Auth0 says who is signed in; users.auth0_sub says which caregiver that is.
//
// A signed-in account with no users row is provisioned on the spot rather than
// bounced, so nobody has to touch the database to onboard. That grants no
// access by itself: every read in data.ts checks caregiver_links first, so a
// new caregiver sees nothing until they redeem a share code.
//
// Provisioning here rather than in an Auth0 callback hook keeps it idempotent
// and self-healing -- it re-creates the row if one is ever deleted, and a
// failure cannot break the login flow itself.
export async function getCurrentCaregiver() {
  const session = await auth0.getSession();
  if (!session) redirect("/login");

  return ensureCaregiver(
    session.user.sub,
    session.user.email ?? null,
    session.user.name ?? session.user.nickname ?? null,
  );
}
