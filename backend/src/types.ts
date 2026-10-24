export type VitalType =
  | "heart_rate"
  | "bp_systolic"
  | "bp_diastolic"
  | "spo2"
  | "temperature"
  | "glucose";

export type Status = "normal" | "warning" | "critical";

/** Someone who logs in to monitor seniors (relative, caregiver). */
export interface User {
  id: string;
  name: string;
}

export interface Senior {
  id: string;
  name: string;
  age: number;
  conditions: string[];
  emergencyContact: string;
}

export interface Reading {
  id: string;
  seniorId: string;
  type: VitalType;
  value: number;
  unit: string;
  status: Status;
  source: "simulator" | "manual" | "healthkit" | "health_connect";
  recordedAt: string;
}

export interface Alert {
  id: string;
  seniorId: string;
  type: VitalType;
  value: number;
  status: Exclude<Status, "normal">;
  message: string;
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}
