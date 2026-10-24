// In-memory storage for paired phones. Resets on restart, like store.ts.
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import type { Platform } from "../integrations/index.js";

export interface Device {
  id: string;
  seniorId: string;
  platform: Platform;
  name: string;
  createdBy: string;
  createdAt: string;
  lastSyncAt: string | null;
  revokedAt: string | null;
}

export interface StoredDevice extends Device {
  tokenHash: string;
  seenSampleIds: Set<string>;
}

interface PairingCode {
  seniorId: string;
  createdBy: string;
  expiresAt: number;
}

const PAIRING_CODE_TTL_MS = 10 * 60_000;
const PAIRING_CODE_LENGTH = 8;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I, easy to type

const devices = new Map<string, StoredDevice>();
const devicesByTokenHash = new Map<string, StoredDevice>();
const pairingCodes = new Map<string, PairingCode>();

// Only hashes are stored, so a leaked store doesn't leak working device tokens.
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function toPublic(device: StoredDevice): Device {
  const { tokenHash: _tokenHash, seenSampleIds: _seen, ...rest } = device;
  return rest;
}

export function createPairingCode(seniorId: string, createdBy: string): { code: string; expiresAt: string } {
  const code = Array.from({ length: PAIRING_CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  const expiresAt = Date.now() + PAIRING_CODE_TTL_MS;
  pairingCodes.set(code, { seniorId, createdBy, expiresAt });
  return { code, expiresAt: new Date(expiresAt).toISOString() };
}

/** Single-use: exchanges a valid code for a new device and its secret token. */
export function redeemPairingCode(
  rawCode: string,
  platform: Platform,
  name: string,
): { device: Device; token: string } | undefined {
  const code = rawCode.trim().toUpperCase();
  const pairing = pairingCodes.get(code);
  pairingCodes.delete(code);
  if (!pairing || pairing.expiresAt < Date.now()) return undefined;

  const token = randomBytes(32).toString("base64url");
  const device: StoredDevice = {
    id: randomUUID(),
    seniorId: pairing.seniorId,
    platform,
    name,
    createdBy: pairing.createdBy,
    createdAt: new Date().toISOString(),
    lastSyncAt: null,
    revokedAt: null,
    tokenHash: hashToken(token),
    seenSampleIds: new Set(),
  };
  devices.set(device.id, device);
  devicesByTokenHash.set(device.tokenHash, device);
  return { device: toPublic(device), token };
}

export function findDeviceByToken(token: string): StoredDevice | undefined {
  const device = devicesByTokenHash.get(hashToken(token));
  return device && !device.revokedAt ? device : undefined;
}

export function listDevices(seniorId: string): Device[] {
  return [...devices.values()].filter((d) => d.seniorId === seniorId).map(toPublic);
}

export function revokeDevice(seniorId: string, deviceId: string): Device | undefined {
  const device = devices.get(deviceId);
  if (!device || device.seniorId !== seniorId) return undefined;
  device.revokedAt ??= new Date().toISOString();
  return toPublic(device);
}

/** Returns false if this device already sent the sample (phones re-send on retries). */
export function markSeen(device: StoredDevice, externalId: string): boolean {
  if (device.seenSampleIds.has(externalId)) return false;
  device.seenSampleIds.add(externalId);
  return true;
}

export function touchSync(device: StoredDevice): void {
  device.lastSyncAt = new Date().toISOString();
}
