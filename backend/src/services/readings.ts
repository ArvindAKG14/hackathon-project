import { randomUUID } from "node:crypto";
import * as store from "../data/store.js";
import { bus } from "../events.js";
import type { Alert, Reading, Status, VitalType } from "../types.js";
import { evaluate, statusRank, VITALS } from "./thresholds.js";

interface NewReading {
  seniorId: string;
  type: VitalType;
  value: number;
  source: Reading["source"];
}

const lastStatus = new Map<string, Status>(); // `${seniorId}:${type}`

/** Stores a reading, publishes it, and raises an alert if the vital got worse. */
export function recordReading(input: NewReading): Reading {
  const spec = VITALS[input.type];
  const value = Number(input.value.toFixed(spec.decimals));
  const reading: Reading = {
    id: randomUUID(),
    seniorId: input.seniorId,
    type: input.type,
    value,
    unit: spec.unit,
    status: evaluate(input.type, value),
    source: input.source,
    recordedAt: new Date().toISOString(),
  };

  store.addReading(reading);
  bus.emit("reading", reading);

  const key = `${reading.seniorId}:${reading.type}`;
  const previous = lastStatus.get(key) ?? "normal";
  lastStatus.set(key, reading.status);

  // Only alert on escalation, so a vital that stays high doesn't alert on every reading.
  if (reading.status !== "normal" && statusRank(reading.status) > statusRank(previous)) {
    const alert: Alert = {
      id: randomUUID(),
      seniorId: reading.seniorId,
      type: reading.type,
      value,
      status: reading.status,
      message: `${spec.label} ${value} ${spec.unit} is ${reading.status}`,
      createdAt: reading.recordedAt,
      acknowledgedAt: null,
      acknowledgedBy: null,
    };
    store.addAlert(alert);
    bus.emit("alert", alert);
  }

  return reading;
}
