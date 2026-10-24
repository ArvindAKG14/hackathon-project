// In-memory storage. Everything resets when the server restarts; a database replaces this later.
import type { Alert, Reading, Senior, User, VitalType } from "../types.js";

const MAX_READINGS_PER_SENIOR = 2000;

export const users = new Map<string, User>();
export const seniors = new Map<string, Senior>();

const access = new Map<string, Set<string>>(); // userId -> seniorIds
const readings = new Map<string, Reading[]>(); // seniorId -> oldest first
const latest = new Map<string, Partial<Record<VitalType, Reading>>>();
const alerts: Alert[] = []; // newest first

export function grantAccess(userId: string, seniorId: string): void {
  const set = access.get(userId) ?? new Set<string>();
  set.add(seniorId);
  access.set(userId, set);
}

export function canAccess(userId: string, seniorId: string): boolean {
  return access.get(userId)?.has(seniorId) ?? false;
}

export function seniorsFor(userId: string): Senior[] {
  return [...(access.get(userId) ?? [])].flatMap((id) => seniors.get(id) ?? []);
}

export function addReading(reading: Reading): void {
  const list = readings.get(reading.seniorId) ?? [];
  list.push(reading);
  if (list.length > MAX_READINGS_PER_SENIOR) list.splice(0, list.length - MAX_READINGS_PER_SENIOR);
  readings.set(reading.seniorId, list);
  latest.set(reading.seniorId, { ...latest.get(reading.seniorId), [reading.type]: reading });
}

/** The most recent `limit` readings, oldest first (chart-friendly). */
export function getReadings(seniorId: string, type: VitalType | undefined, limit: number): Reading[] {
  const list = readings.get(seniorId) ?? [];
  const filtered = type ? list.filter((r) => r.type === type) : list;
  return filtered.slice(-limit);
}

export function latestVitals(seniorId: string): Partial<Record<VitalType, Reading>> {
  return latest.get(seniorId) ?? {};
}

export function addAlert(alert: Alert): void {
  alerts.unshift(alert);
}

export function getAlerts(seniorIds: string[], limit: number): Alert[] {
  const wanted = new Set(seniorIds);
  return alerts.filter((a) => wanted.has(a.seniorId)).slice(0, limit);
}

export function findAlert(id: string): Alert | undefined {
  return alerts.find((a) => a.id === id);
}
