// Helpers for reading untrusted sample fields and converting units.
import type { NormalizedSleepSession } from "./types.js";

export const MMOL_TO_MG_DL = 18.016; // blood glucose

export const LB_TO_KG = 0.45359237;
export const MI_TO_M = 1609.344;
export const FT_TO_M = 0.3048;

export const fahrenheitToCelsius = (f: number) => ((f - 32) * 5) / 9;

export function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** Parses any date string the phone sends and returns it as UTC ISO, so times sort correctly. */
export function isoTime(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** The four stage buckets we store. Both platforms report more; the rest are ignored. */
export type SleepBucket = "deep" | "light" | "rem" | "awake" | "ignore";

export interface StageSpan {
  bucket: SleepBucket;
  start: string;
  end: string;
}

const minutesBetween = (start: string, end: string) =>
  (new Date(end).getTime() - new Date(start).getTime()) / 60_000;

/**
 * Turns a session's stage spans into the row shape sleep_sessions expects.
 *
 * total_minutes is the greater of the wall-clock span and the summed stages:
 * the table's CHECK requires the stages to fit inside the total, and sources
 * do sometimes report overlapping spans that would otherwise break it.
 *
 * Returns undefined for a zero-length or inverted session, which the table
 * rejects anyway (ended_at > started_at, total_minutes > 0).
 */
export function summarizeSleep(
  externalId: string,
  startedAt: string,
  endedAt: string,
  spans: StageSpan[],
): NormalizedSleepSession | undefined {
  const span = minutesBetween(startedAt, endedAt);
  if (!Number.isFinite(span) || span <= 0) return undefined;

  const totals = { deep: 0, light: 0, rem: 0, awake: 0 };
  for (const { bucket, start, end } of spans) {
    if (bucket === "ignore") continue;
    const minutes = minutesBetween(start, end);
    if (Number.isFinite(minutes) && minutes > 0) totals[bucket] += minutes;
  }

  const deepMinutes = Math.round(totals.deep);
  const lightMinutes = Math.round(totals.light);
  const remMinutes = Math.round(totals.rem);
  const awakeMinutes = Math.round(totals.awake);
  const staged = deepMinutes + lightMinutes + remMinutes + awakeMinutes;

  return {
    externalId,
    startedAt,
    endedAt,
    totalMinutes: Math.max(Math.round(span), staged),
    deepMinutes,
    lightMinutes,
    remMinutes,
    awakeMinutes,
  };
}
