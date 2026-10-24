// Helpers for reading untrusted sample fields and converting units.

export const MMOL_TO_MG_DL = 18.016; // blood glucose

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
