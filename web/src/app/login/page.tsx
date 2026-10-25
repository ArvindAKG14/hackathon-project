import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { auth0 } from "@/lib/auth0";

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

  // An account is created on first sign-in, so there is nothing left to do
  // here: the dashboard asks for a share code if they aren't connected yet.
  redirect("/dashboard");
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
