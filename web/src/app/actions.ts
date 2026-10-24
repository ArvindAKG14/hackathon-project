"use server";

import { refresh } from "next/cache";
import { acknowledgeAlert } from "@/lib/data";
import { getCurrentCaregiver } from "@/lib/session";

export async function markAlertSeen(formData: FormData) {
  const caregiver = await getCurrentCaregiver();
  await acknowledgeAlert(caregiver.id, Number(formData.get("alertId")));
  refresh();
}
