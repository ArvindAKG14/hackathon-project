import "server-only";
import { redirect } from "next/navigation";
import { auth0 } from "./auth0";
import { getCaregiverByAuth0Sub } from "./data";

// Auth0 says who is signed in; users.auth0_sub says which caregiver that is.
// An Auth0 account with no matching row is sent back to /login, which explains
// how to link it.
export async function getCurrentCaregiver() {
  const session = await auth0.getSession();
  if (!session) redirect("/login");
  const user = await getCaregiverByAuth0Sub(session.user.sub);
  if (!user) redirect("/login");
  return user;
}
