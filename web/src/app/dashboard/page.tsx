import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { RedeemShareCode } from "@/components/share-code";
import { listLinkedSeniors } from "@/lib/data";
import { ageFrom } from "@/lib/format";
import { getCurrentCaregiver } from "@/lib/session";

export const metadata: Metadata = { title: "Dashboard: KinCare" };

async function SeniorList() {
  const caregiver = await getCurrentCaregiver();
  const seniors = await listLinkedSeniors(caregiver.id);

  return (
    <>
      <h1 className="text-4xl font-bold">Hello, {caregiver.full_name.split(" ")[0]}</h1>
      {seniors.length === 0 ? (
        <>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-soft">
            You&apos;re not connected to anyone yet. A family member who already uses
            KinCare can give you a share code.
          </p>
          <div className="mt-8 max-w-xl">
            <RedeemShareCode />
          </div>
        </>
      ) : (
        <>
          <p className="mt-3 text-lg text-ink-soft">The people you look after</p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {seniors.map((s) => {
              const age = ageFrom(s.date_of_birth);
              return (
                <li key={s.id}>
                  <Link
                    href={`/dashboard/${s.id}`}
                    className="block rounded-2xl border-2 border-line bg-surface px-6 py-5 hover:border-care"
                  >
                    <span className="block text-2xl font-bold">{s.full_name}</span>
                    <span className="text-ink-soft">
                      {[age && `${age} years old`, s.relationship && `you're linked as ${s.relationship}`]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-10 max-w-xl">
            <RedeemShareCode />
          </div>
        </>
      )}
    </>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<p className="text-lg text-ink-soft">Loading…</p>}>
      <SeniorList />
    </Suspense>
  );
}
