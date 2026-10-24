import type { Status, VitalType } from "../types.js";

interface VitalSpec {
  label: string;
  unit: string;
  decimals: number;
  normal: [number, number];
  /** Outer band around `normal`; anything outside it is critical. */
  warning: [number, number];
}

// Demo thresholds for a hackathon, not medical advice.
export const VITALS: Record<VitalType, VitalSpec> = {
  heart_rate: { label: "Heart rate", unit: "bpm", decimals: 0, normal: [60, 100], warning: [50, 120] },
  bp_systolic: { label: "Systolic BP", unit: "mmHg", decimals: 0, normal: [90, 129], warning: [80, 159] },
  bp_diastolic: { label: "Diastolic BP", unit: "mmHg", decimals: 0, normal: [60, 84], warning: [50, 99] },
  spo2: { label: "SpO2", unit: "%", decimals: 0, normal: [95, 100], warning: [90, 100] },
  temperature: { label: "Temperature", unit: "°C", decimals: 1, normal: [36.1, 37.5], warning: [35.5, 38.5] },
  glucose: { label: "Glucose", unit: "mg/dL", decimals: 0, normal: [70, 140], warning: [55, 200] },
};

export const VITAL_TYPES = Object.keys(VITALS) as VitalType[];

export function isVitalType(value: unknown): value is VitalType {
  return typeof value === "string" && value in VITALS;
}

const inRange = (value: number, [lo, hi]: [number, number]) => value >= lo && value <= hi;

export function evaluate(type: VitalType, value: number): Status {
  const spec = VITALS[type];
  if (inRange(value, spec.normal)) return "normal";
  if (inRange(value, spec.warning)) return "warning";
  return "critical";
}

const RANK: Record<Status, number> = { normal: 0, warning: 1, critical: 2 };

export function statusRank(status: Status): number {
  return RANK[status];
}

export function worst(statuses: Status[]): Status {
  return statuses.reduce<Status>((acc, s) => (RANK[s] > RANK[acc] ? s : acc), "normal");
}
