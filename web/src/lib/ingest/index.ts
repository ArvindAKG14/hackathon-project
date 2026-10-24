import { healthConnectAdapter } from "./healthConnect";
import { healthKitAdapter } from "./healthkit";
import type { Adapter, Platform } from "./types";

export const ADAPTERS: Record<Platform, Adapter> = {
  healthkit: healthKitAdapter,
  health_connect: healthConnectAdapter,
};

export function isPlatform(value: unknown): value is Platform {
  return value === "healthkit" || value === "health_connect";
}

export type { Platform } from "./types";
