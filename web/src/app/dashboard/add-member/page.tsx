import type { Metadata } from "next";
import Link from "next/link";
import { BackButton } from "@/components/back-button";

export const metadata: Metadata = { title: "Add a member: KinCare" };

const choice =
  "flex aspect-square w-full max-w-64 items-center justify-center rounded-3xl border-2 border-line bg-surface p-6 text-center text-2xl font-bold hover:border-care hover:bg-mist";

// First step of the add-member survey. The two paths are genuinely different:
// a care recipient is a profile you create, while a caretaker creates their
// own account by signing in and is connected with a share code.
export default function AddMemberPage() {
  return (
    <>
      <BackButton />
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-10">
        <h1 className="text-center text-4xl font-bold">Who would you like to add?</h1>
        <div className="grid w-full max-w-xl grid-cols-1 justify-items-center gap-6 min-[480px]:grid-cols-2">
          <Link href="/dashboard/add-member/caretaker" className={choice}>
            Add Caretaker
          </Link>
          <Link href="/dashboard/add-member/care-recipient" className={choice}>
            Add Care Recipient
          </Link>
        </div>
      </div>
    </>
  );
}
