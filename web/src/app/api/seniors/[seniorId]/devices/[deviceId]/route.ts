import { NextResponse } from "next/server";
import { revokeDevice } from "@/lib/devices";
import { getLinkedSenior } from "@/lib/data";
import { getCurrentCaregiver } from "@/lib/session";

// Revoking sets revoked_at, which makes the device's token stop resolving.
// The readings it already sent stay: they are real measurements, and
// data_sources rows are referenced by measurements.data_source_id.


export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ seniorId: string; deviceId: string }> },
) {
  const [{ seniorId, deviceId }, caregiver] = await Promise.all([params, getCurrentCaregiver()]);

  const senior = await getLinkedSenior(caregiver.id, seniorId);
  if (!senior) return NextResponse.json({ error: "Senior not found" }, { status: 404 });

  const revoked = await revokeDevice(seniorId, deviceId);
  if (!revoked) return NextResponse.json({ error: "Device not found" }, { status: 404 });

  return NextResponse.json({ id: deviceId, revoked: true });
}
