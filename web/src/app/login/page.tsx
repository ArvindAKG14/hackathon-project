import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { signInAs } from "@/app/actions";
import { Logo } from "@/components/logo";
import { listCaregivers } from "@/lib/data";

export const metadata: Metadata = { title: "Sign in: KinCare" };

async function CaregiverList() {
  await connection(); // Read the family list at request time, never at build time
  const caregivers = await listCaregivers();
  if (caregivers.length === 0) {
    return (
      <p className="mt-8 rounded-xl bg-marigold-tint px-5 py-4 text-lg">
        There are no family accounts in the database yet. Load{" "}
        <code>db/seed.sql</code> into Supabase to add the demo family.
      </p>
    );
  }
  return (
    <ul className="mt-8 flex flex-col gap-3">
      {caregivers.map((c) => (
        <li key={c.id}>
          <form action={signInAs}>
            <input type="hidden" name="userId" value={c.id} />
            <button
              type="submit"
              className="w-full rounded-2xl border-2 border-line bg-surface px-6 py-4 text-left hover:border-care"
            >
              <span className="block text-xl font-bold">Continue as {c.full_name}</span>
              {c.email && <span className="text-ink-soft">{c.email}</span>}
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}

export default function LoginPage() {
  return (
    <>
      <header className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-8">
        <Logo />
      </header>
      <main className="mx-auto w-full max-w-lg flex-1 px-4 pb-20 pt-10">
        <h1 className="text-4xl font-bold">Sign in</h1>
        <p className="mt-4 text-lg leading-relaxed text-ink-soft">
          This is the demo, so there&apos;s no password. Choose a family member
          to see the parents they look after.
        </p>
        <Suspense fallback={<p className="mt-8 text-lg text-ink-soft">Loading family members…</p>}>
          <CaregiverList />
        </Suspense>
      </main>
    </>
  );
}
