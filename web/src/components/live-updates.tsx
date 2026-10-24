"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// The page is server-rendered, so it shows whatever was true at load time.
// This re-renders it on an interval, matching how often the companion app
// pushes readings.
//
// router.refresh() re-runs the server component and streams fresh HTML in
// without a full navigation, so scroll position and client state survive.
//
// Why polling and not a live push: ingest and this page are separate
// serverless invocations with no shared memory, so an in-process event bus
// cannot reach the browser. Supabase Realtime would work, but RLS is deny-all
// (migration 008) and the browser holds no key that can read anything. Push
// would mean wiring Auth0 JWTs into Supabase and writing real policies --
// worth doing eventually, overkill for a 3-minute refresh target.
const POLL_MS = 180_000;

export function LiveUpdates() {
  const router = useRouter();

  useEffect(() => {
    const poll = setInterval(() => router.refresh(), POLL_MS);
    // Catch up immediately when someone returns to the tab, rather than
    // showing stale numbers until the next interval.
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return null;
}
