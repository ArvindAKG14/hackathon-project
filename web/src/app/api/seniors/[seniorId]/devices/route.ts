import { NextResponse } from "next/server";
import { listDevices } from "@/lib/devices";
import { getLinkedSenior } from "@/lib/data";
import { getCurrentCaregiver } from "@/lib/session";

// Paired phones for a senior. No UI consumes this yet; it is kept because the
// Express backend exposed it and removing the capability during a port would
// be a silent regression.


export async function GET(_request: Request, { params }: { params: Promise<{ seniorId: string }> }) {
  const [{ seniorId }, caregiver] = await Promise.all([params, getCurrentCaregiver()]);

  const senior = await getLinkedSenior(caregiver.id, seniorId);
  if (!senior) return NextResponse.json({ error: "Senior not found" }, { status: 404 });

  return NextResponse.json(await listDevices(seniorId));
}
