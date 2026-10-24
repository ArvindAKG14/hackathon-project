import { NextResponse, type NextRequest } from "next/server";
import { redeemPairingCode } from "@/lib/devices";
import { isPlatform } from "@/lib/ingest";

// A phone exchanges a pairing code for its long-lived device token.
//
// No Auth0 session here: the person holding the code is the proof. The token
// is returned exactly once and must be stored in the Keychain / Keystore.


export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { code, platform, name } = (body ?? {}) as Record<string, unknown>;
  if (typeof code !== "string" || !isPlatform(platform)) {
    return NextResponse.json(
      { error: "Body must be { code, platform: 'healthkit' | 'health_connect', name? }" },
      { status: 400 },
    );
  }

  const fallbackName = platform === "healthkit" ? "iPhone" : "Android phone";
  const deviceName = typeof name === "string" && name.trim() ? name.trim().slice(0, 100) : fallbackName;

  const paired = await redeemPairingCode(code, platform, deviceName);
  if (!paired) {
    // Same response for unknown, expired and already-used, so codes cannot be probed.
    return NextResponse.json({ error: "Invalid or expired pairing code" }, { status: 400 });
  }

  return NextResponse.json(paired, { status: 201 });
}
