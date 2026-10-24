import { NextResponse, type NextRequest } from "next/server";
import { findDeviceByToken, platformFor } from "@/lib/devices";
import { ADAPTERS } from "@/lib/ingest";
import { persistSync } from "@/lib/ingest/persist";

// The companion phone apps post batches here.
//
// HealthKit and Health Connect are on-device APIs -- no server can poll them,
// so this is a push endpoint. A phone offline for six hours will deliver six
// hours of backdated readings at once, out of order, and will re-send batches
// it is unsure about. Both are fine: persistSync is idempotent.
//
// Authentication is the bearer token issued at pairing, not Auth0. Phones are
// devices, not people.

const MAX_SAMPLES_PER_SYNC = 1000;


export async function POST(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const device = token ? await findDeviceByToken(token) : undefined;
  if (!device) {
    return NextResponse.json({ error: "Invalid or revoked device token" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const samples = (body as { samples?: unknown })?.samples;
  if (!Array.isArray(samples) || samples.length > MAX_SAMPLES_PER_SYNC) {
    return NextResponse.json(
      { error: `Body must be { samples: [...] } with at most ${MAX_SAMPLES_PER_SYNC} entries` },
      { status: 400 },
    );
  }

  const adapter = ADAPTERS[platformFor(device.provider)];
  const { samples: normalized, sleepSessions, skipped } = adapter(samples);

  try {
    const stored = await persistSync({
      seniorId: device.seniorId,
      dataSourceId: device.id,
      samples: normalized,
      sleepSessions,
    });
    return NextResponse.json({ accepted: normalized.length, skipped, stored });
  } catch (error) {
    console.error("[sync] database write failed:", error);
    // 503 tells the phone to retry rather than drop the batch.
    return NextResponse.json({ error: "Could not store readings; retry this batch" }, { status: 503 });
  }
}
