import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { auth0 } from "@/lib/auth0";
import { getCaregiverByAuth0Sub } from "@/lib/data";

export const metadata: Metadata = { title: "Sign in: KinCare" };

// Links to /auth/* are plain <a>s, not <Link>: they must be full page loads.
async function SignInOptions() {
  const session = await auth0.getSession();

  if (!session) {
    return (
      <div className="mt-8 flex flex-col gap-3">
        <a
          href="/auth/login?returnTo=/dashboard"
          className="rounded-full bg-care px-7 py-3.5 text-center text-lg font-bold text-on-care hover:bg-care-strong"
        >
          Sign in
        </a>
        <a
          href="/auth/login?screen_hint=signup&returnTo=/dashboard"
          className="rounded-full border-2 border-care px-7 py-3 text-center text-lg font-bold text-care-strong hover:bg-mist"
        >
          Create an account
        </a>
      </div>
    );
  }

  if (await getCaregiverByAuth0Sub(session.user.sub)) redirect("/dashboard");

  // Signed in to Auth0, but no users row has this auth0_sub yet.
  return (
    <div className="mt-8 rounded-xl bg-marigold-tint px-5 py-4 text-lg">
      <p>
        You&apos;re signed in as <strong>{session.user.email ?? session.user.name}</strong>, but
        this account isn&apos;t linked to a KinCare family profile yet.
      </p>
      <p className="mt-3">
        To link it, set <code>auth0_sub</code> on your caregiver row in the <code>users</code> table to:
      </p>
      <code className="mt-2 block break-all rounded-lg bg-surface px-3 py-2">{session.user.sub}</code>
      <a href="/auth/logout" className="mt-4 inline-block font-bold text-care-strong underline">
        Sign out
      </a>
    </div>
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
          Sign in to see the parents you look after.
        </p>
        <Suspense fallback={<p className="mt-8 text-lg text-ink-soft">Checking your sign-in…</p>}>
          <SignInOptions />
        </Suspense>
      </main>
    </>
  );
}
