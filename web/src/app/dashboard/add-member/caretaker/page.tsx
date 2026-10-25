import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BackButton } from "@/components/back-button";
import { CreateShareCode } from "@/components/share-code";
import { listLinkedSeniors } from "@/lib/data";
import { getCurrentCaregiver } from "@/lib/session";

export const metadata: Metadata = { title: "Add a caretaker: KinCare" };

// Adding a caretaker is really "give someone access to a person I look after",
// so it starts from the person, not from the new caretaker. They create their
// own account by signing in; the code is what connects the two.
async function ShareCodes() {
  const caregiver = await getCurrentCaregiver();
  const seniors = await listLinkedSeniors(caregiver.id);

  if (seniors.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-line bg-surface px-5 py-6">
        <p className="text-lg leading-relaxed">
          You aren&apos;t looking after anyone yet, so there&apos;s nobody to share. Add a care
          recipient first.
        </p>
        <Link
          href="/dashboard/add-member/care-recipient"
          className="mt-5 inline-block rounded-full bg-care px-7 py-3 text-lg font-bold text-on-care hover:bg-care-strong"
        >
          Add a care recipient
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-lg leading-relaxed text-ink-soft">
        Pick the person you want to share, and give the code to the family member or caregiver
        who should see their readings. They sign in to KinCare themselves and enter it on their
        dashboard — you don&apos;t need to set up an account for them.
      </p>
      {seniors.map((senior) => (
        <CreateShareCode key={senior.id} seniorId={senior.id} seniorName={senior.full_name} />
      ))}
    </div>
  );
}

export default function AddCaretakerPage() {
  return (
    <>
      <BackButton />
      <div className="mx-auto mt-6 flex w-full max-w-xl flex-col gap-8">
        <h1 className="text-4xl font-bold">Add a caretaker</h1>
        <Suspense fallback={<p className="text-lg text-ink-soft">Loading…</p>}>
          <ShareCodes />
        </Suspense>
      </div>
    </>
  );
}
