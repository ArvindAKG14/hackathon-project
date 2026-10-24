import { NextResponse } from "next/server";
import { createPairingCode } from "@/lib/devices";
import { getLinkedSenior } from "@/lib/data";
import { getCurrentCaregiver } from "@/lib/session";

// A signed-in caregiver generates a code to set up a phone for their senior.
// Auth0 session required, plus the caregiver_links check -- a caregiver may
// only pair devices for seniors they actually look after.


export async function POST(_request: Request, { params }: { params: Promise<{ seniorId: string }> }) {
  const [{ seniorId }, caregiver] = await Promise.all([params, getCurrentCaregiver()]);

  const senior = await getLinkedSenior(caregiver.id, seniorId);
  if (!senior) {
    // Same response for "does not exist" and "no access", so ids cannot be probed.
    return NextResponse.json({ error: "Senior not found" }, { status: 404 });
  }

  const code = await createPairingCode(seniorId, caregiver.id);
  return NextResponse.json(code, { status: 201 });
}
