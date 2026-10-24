"use client";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-20">
      <h1 className="text-3xl font-bold">KinCare couldn&apos;t load this page</h1>
      <p className="mt-4 text-lg leading-relaxed text-ink-soft">
        {process.env.NODE_ENV === "development"
          ? error.message
          : "The health database didn't respond. Try again in a moment."}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-8 self-start rounded-full bg-care px-6 py-3 font-bold text-on-care hover:bg-care-strong"
      >
        Try again
      </button>
    </main>
  );
}
