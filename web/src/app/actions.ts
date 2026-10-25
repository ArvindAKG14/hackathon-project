"use server";

import { refresh } from "next/cache";
import { createLinkInvitation, redeemLinkInvitation } from "@/lib/accounts";
import { acknowledgeAlert } from "@/lib/data";
import { getCurrentCaregiver } from "@/lib/session";

export async function markAlertSeen(formData: FormData) {
  const caregiver = await getCurrentCaregiver();
  await acknowledgeAlert(caregiver.id, Number(formData.get("alertId")));
  refresh();
}

export type RedeemState = { status: "idle" | "ok" | "error"; message: string };

/** Redeems a share code so this caregiver can see someone else's senior. */
export async function redeemShareCode(_prev: RedeemState, formData: FormData): Promise<RedeemState> {
  const code = String(formData.get("code") ?? "");
  if (!/^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(code.trim())) {
    return { status: "error", message: "That doesn't look like a share code. They look like K7M2-9QX4." };
  }

  const caregiver = await getCurrentCaregiver();
  // Accept the code with or without its dash, since people retype these.
  const normalized = code.trim().toUpperCase().replace(/^(.{4})-?(.{4})$/, "$1-$2");
  const result = await redeemLinkInvitation(caregiver.id, normalized);

  if (result.ok) {
    refresh();
    return { status: "ok", message: `You can now see ${result.seniorName}.` };
  }

  const messages = {
    invalid: "That code isn't valid any more. Codes are single use and expire after 7 days.",
    self: "That code is for your own profile.",
    "already-linked": "You already have access to that person.",
  };
  return { status: "error", message: messages[result.reason] };
}

export type InviteState = { code: string | null; message: string };

/** Mints a share code for a senior this caregiver already looks after. */
export async function createShareCode(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const seniorId = String(formData.get("seniorId") ?? "");
  const caregiver = await getCurrentCaregiver();
  const invitation = await createLinkInvitation(caregiver.id, seniorId);

  if (!invitation) return { code: null, message: "You can't create a code for that person." };
  return { code: invitation.code, message: "Share this code. It works once, and expires in 7 days." };
}
