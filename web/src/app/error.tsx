"use client";

import { isConfigError } from "@/lib/config-error";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  // A missing environment variable is not a transient fault, and telling the
  // operator "the database didn't respond" sends them hunting a network
  // problem that does not exist. Variable names are not secrets, so these
  // messages are safe to show in production. Values never appear in them.
  const misconfigured = isConfigError(error);
  const showMessage = misconfigured || process.env.NODE_ENV === "development";

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-20">
      <h1 className="text-3xl font-bold">
        {misconfigured ? "KinCare isn't configured correctly" : "KinCare couldn't load this page"}
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-ink-soft">
        {showMessage ? error.message : "The health database didn't respond. Try again in a moment."}
      </p>
      {misconfigured && (
        <p className="mt-3 text-ink-soft">
          This is a deployment setting, not a fault with the data. Retrying won&apos;t help until
          it&apos;s fixed.
        </p>
      )}
      {!misconfigured && (
        <button
          type="button"
          onClick={reset}
          className="mt-8 self-start rounded-full bg-care px-6 py-3 font-bold text-on-care hover:bg-care-strong"
        >
          Try again
        </button>
      )}
    </main>
  );
}
