"use client";

import { useRouter } from "next/navigation";

// Returns to whichever page the user came from. Opened directly (a pasted
// link, a fresh tab), there is no previous page, so it falls back to the
// dashboard instead of doing nothing.
export function BackButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.back() : router.push("/dashboard"))}
      className="text-ink-soft underline underline-offset-4 hover:text-ink"
    >
      ← Back
    </button>
  );
}
