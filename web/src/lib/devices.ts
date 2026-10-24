import "server-only";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { pg } from "./pg";
import type { Platform } from "./ingest";

// Paired phones, stored in the database.
//
// These lived in a Map in the Express process. That already lost every paired
// device on restart; in route handlers it breaks outright, because each
// request may be served by a different instance with no shared memory.

const PAIRING_CODE_TTL_MINUTES = 10;
const PAIRING_CODE_LENGTH = 8;
/** No 0/O or 1/I: these get read aloud over the phone. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** health_provider in the database. The wire protocol uses different names. */
const PROVIDERS: Record<Platform, string> = {
  healthkit: "apple_health",
  health_connect: "health_connect",
};

// Only hashes are stored, so a database leak does not hand out working tokens.
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export interface PairedDevice {
  id: string;
  seniorId: string;
  provider: string;
  deviceName: string | null;
  lastSyncAt: string | null;
}

export async function createPairingCode(
  seniorId: string,
  createdBy: string,
): Promise<{ code: string; expiresAt: string }> {
  const code = Array.from(
    { length: PAIRING_CODE_LENGTH },
    () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
  ).join("");

  const { rows } = await pg().query<{ expires_at: string }>(
    `INSERT INTO device_pairing_codes (code, senior_id, created_by, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)
     RETURNING expires_at`,
    [code, seniorId, createdBy, PAIRING_CODE_TTL_MINUTES],
  );

  return { code, expiresAt: rows[0]!.expires_at };
}

/**
 * Single use: exchanges a valid code for a data_sources row and its token.
 * Returns undefined for an unknown, expired or already-used code.
 *
 * The UPDATE ... RETURNING claims the code atomically, so two phones racing on
 * the same code cannot both pair.
 */
export async function redeemPairingCode(
  rawCode: string,
  platform: Platform,
  deviceName: string,
): Promise<{ token: string; device: PairedDevice } | undefined> {
  const code = rawCode.trim().toUpperCase();
  const client = await pg().connect();

  try {
    await client.query("BEGIN");

    const claimed = await client.query<{ senior_id: string }>(
      `UPDATE device_pairing_codes SET used_at = now()
       WHERE code = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING senior_id`,
      [code],
    );
    if (claimed.rowCount === 0) {
      await client.query("ROLLBACK");
      return undefined;
    }

    const seniorId = claimed.rows[0]!.senior_id;
    const token = randomBytes(32).toString("base64url");

    // source_app holds the token hash prefix rather than a bundle id so that
    // two phones of the same platform for one senior stay distinct under
    // UNIQUE (senior_id, provider, source_app).
    const tokenHash = hashToken(token);
    const device = await client.query<{
      id: string;
      provider: string;
      device_name: string | null;
      last_sync_at: string | null;
    }>(
      `INSERT INTO data_sources
         (senior_id, provider, source_app, device_model, device_name, token_hash)
       VALUES ($1, $2::health_provider, $3, $4, $4, $5)
       RETURNING id, provider, device_name, last_sync_at`,
      [seniorId, PROVIDERS[platform], tokenHash.slice(0, 16), deviceName, tokenHash],
    );

    await client.query("COMMIT");

    const row = device.rows[0]!;
    return {
      token,
      device: {
        id: row.id,
        seniorId,
        provider: row.provider,
        deviceName: row.device_name,
        lastSyncAt: row.last_sync_at,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Resolves a bearer token to its device, or undefined if unknown or revoked. */
export async function findDeviceByToken(token: string): Promise<PairedDevice | undefined> {
  const { rows } = await pg().query<{
    id: string;
    senior_id: string;
    provider: string;
    device_name: string | null;
    last_sync_at: string | null;
  }>(
    `SELECT id, senior_id, provider, device_name, last_sync_at
     FROM data_sources
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(token)],
  );

  const row = rows[0];
  return row
    ? {
        id: row.id,
        seniorId: row.senior_id,
        provider: row.provider,
        deviceName: row.device_name,
        lastSyncAt: row.last_sync_at,
      }
    : undefined;
}

/** Which platform's payload this device sends. */
export function platformFor(provider: string): Platform {
  return provider === "apple_health" ? "healthkit" : "health_connect";
}

export async function listDevices(seniorId: string): Promise<PairedDevice[]> {
  const { rows } = await pg().query(
    `SELECT id, senior_id, provider, device_name, last_sync_at
     FROM data_sources
     WHERE senior_id = $1 AND token_hash IS NOT NULL AND revoked_at IS NULL
     ORDER BY created_at`,
    [seniorId],
  );
  return rows.map((r) => ({
    id: r.id,
    seniorId: r.senior_id,
    provider: r.provider,
    deviceName: r.device_name,
    lastSyncAt: r.last_sync_at,
  }));
}

export async function revokeDevice(seniorId: string, deviceId: string): Promise<boolean> {
  const { rowCount } = await pg().query(
    `UPDATE data_sources SET revoked_at = now()
     WHERE id = $1 AND senior_id = $2 AND revoked_at IS NULL`,
    [deviceId, seniorId],
  );
  return (rowCount ?? 0) > 0;
}
