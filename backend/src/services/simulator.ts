// Generates realistic-looking vitals so the dashboard has live data without real devices.
import * as store from "../data/store.js";
import type { VitalType } from "../types.js";
import { recordReading } from "./readings.js";
import { VITAL_TYPES, VITALS } from "./thresholds.js";

const SPIKE_CHANCE = 0.005; // per vital, per tick
const SPIKE_DIRECTION: Record<VitalType, "up" | "down"> = {
  heart_rate: "up",
  bp_systolic: "up",
  bp_diastolic: "up",
  spo2: "down",
  temperature: "up",
  glucose: "up",
};

type VitalState = Record<VitalType, number>;
const state = new Map<string, VitalState>();

function midpoint(type: VitalType): number {
  const [lo, hi] = VITALS[type].normal;
  return (lo + hi) / 2;
}

function span(type: VitalType): number {
  const [lo, hi] = VITALS[type].normal;
  return hi - lo;
}

function initialState(): VitalState {
  // Each senior gets a slightly different baseline.
  return Object.fromEntries(
    VITAL_TYPES.map((t) => [t, midpoint(t) + (Math.random() - 0.5) * span(t) * 0.4]),
  ) as VitalState;
}

/** A value in the warning band, or occasionally past it into critical. */
function spike(type: VitalType): number {
  const { normal, warning } = VITALS[type];
  const critical = Math.random() < 0.4;
  if (SPIKE_DIRECTION[type] === "up") {
    return critical ? warning[1] + span(type) * 0.2 : (normal[1] + warning[1]) / 2;
  }
  return critical ? warning[0] - span(type) * 0.2 : (normal[0] + warning[0]) / 2;
}

function step(type: VitalType, value: number): number {
  if (Math.random() < SPIKE_CHANCE) return spike(type);
  // Drift back toward normal with some noise, so spikes recover over a few ticks.
  const next = value + (midpoint(type) - value) * 0.15 + (Math.random() - 0.5) * span(type) * 0.1;
  return type === "spo2" ? Math.min(next, 100) : next;
}

function tick(): void {
  for (const senior of store.seniors.values()) {
    const current = state.get(senior.id) ?? initialState();
    for (const type of VITAL_TYPES) {
      current[type] = step(type, current[type]);
      recordReading({ seniorId: senior.id, type, value: current[type], source: "simulator" });
    }
    state.set(senior.id, current);
  }
}

export function startSimulator(intervalMs: number): NodeJS.Timeout {
  tick();
  return setInterval(tick, intervalMs);
}
