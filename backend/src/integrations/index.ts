import { healthConnectAdapter } from "./healthConnect.js";
import { healthKitAdapter } from "./healthkit.js";
import type { Adapter, Platform } from "./types.js";

export const ADAPTERS: Record<Platform, Adapter> = {
  healthkit: healthKitAdapter,
  health_connect: healthConnectAdapter,
};

export function isPlatform(value: unknown): value is Platform {
  return value === "healthkit" || value === "health_connect";
}

export type { Platform } from "./types.js";
