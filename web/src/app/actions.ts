"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { acknowledgeAlert, getCaregiver } from "@/lib/data";
import { clearDemoUser, getCurrentCaregiver, setDemoUser } from "@/lib/session";

export async function signInAs(formData: FormData) {
  const user = await getCaregiver(String(formData.get("userId")));
  if (!user) redirect("/login");
  await setDemoUser(user.id);
  redirect("/dashboard");
}

export async function signOut() {
  await clearDemoUser();
  redirect("/");
}

export async function markAlertSeen(formData: FormData) {
  const caregiver = await getCurrentCaregiver();
  await acknowledgeAlert(caregiver.id, Number(formData.get("alertId")));
  refresh();
}
