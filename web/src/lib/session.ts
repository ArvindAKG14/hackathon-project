import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCaregiver } from "./data";

// Demo sign-in: the cookie holds a caregiver's user id. This stands in for
// Auth0 until it's wired up, and is not secure on its own: anyone can set
// the cookie. Swap getCurrentCaregiver() for an Auth0 session lookup on
// users.auth0_sub and nothing else needs to change.
const COOKIE_NAME = "kincare_demo_user";

export async function setDemoUser(userId: string) {
  (await cookies()).set(COOKIE_NAME, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearDemoUser() {
  (await cookies()).delete(COOKIE_NAME);
}

export async function getCurrentCaregiver() {
  const userId = (await cookies()).get(COOKIE_NAME)?.value;
  if (!userId) redirect("/login");
  const user = await getCaregiver(userId);
  if (!user) redirect("/login");
  return user;
}
