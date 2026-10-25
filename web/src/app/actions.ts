"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { createCareRecipient, createLinkInvitation, redeemLinkInvitation } from "@/lib/accounts";
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

export type AddRecipientState = { status: "idle" | "error"; message: string };

const LB_TO_KG = 0.45359237;
const IN_TO_CM = 2.54;
/** The six metrics the form offers safe ranges for. */
const THRESHOLD_METRICS = [
  "heart_rate",
  "spo2",
  "body_temperature",
  "blood_pressure_systolic",
  "blood_pressure_diastolic",
  "blood_glucose",
];

function optionalNumber(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function optionalText(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

/** Adds a senior and links the signed-in caregiver to them as their first contact. */
export async function addCareRecipient(
  _prev: AddRecipientState,
  formData: FormData,
): Promise<AddRecipientState> {
  const fullName = optionalText(formData.get("full_name"));
  const timezone = optionalText(formData.get("timezone"));
  const relationship = optionalText(formData.get("relationship"));
  if (!fullName || !timezone || !relationship) {
    return { status: "error", message: "Name, time zone and your relationship are all needed." };
  }

  // The form shows one unit picker per measurement; normalise here so the
  // database only ever holds the canonical unit.
  const weight = optionalNumber(formData.get("weight"));
  const weightKg =
    weight === null ? null : formData.get("weight_unit") === "lb" ? weight * LB_TO_KG : weight;

  let heightCm: number | null = null;
  if (formData.get("height_unit") === "ft_in") {
    const feet = optionalNumber(formData.get("height_ft"));
    const inches = optionalNumber(formData.get("height_in"));
    if (feet !== null || inches !== null) {
      heightCm = ((feet ?? 0) * 12 + (inches ?? 0)) * IN_TO_CM;
    }
  } else {
    heightCm = optionalNumber(formData.get("height_cm"));
  }

  const round = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

  const caregiver = await getCurrentCaregiver();
  const result = await createCareRecipient(caregiver.id, {
    fullName,
    dateOfBirth: optionalText(formData.get("date_of_birth")),
    phone: optionalText(formData.get("phone")),
    email: optionalText(formData.get("email")),
    timezone,
    relationship,
    weightKg: round(weightKg),
    heightCm: round(heightCm),
    thresholds: THRESHOLD_METRICS.map((metric) => ({
      metric,
      min: optionalNumber(formData.get(`${metric}_min`)),
      max: optionalNumber(formData.get(`${metric}_max`)),
    })),
  });

  if (!result.ok) return { status: "error", message: result.reason };

  // Straight to their dashboard: the point of adding them is to watch them.
  redirect(`/dashboard/${result.seniorId}`);
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
