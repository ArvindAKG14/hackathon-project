"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// The page is server-rendered, so it shows whatever was true at load time.
// These two mechanisms keep it current:
//
//   Polling    always on. Re-renders every 3 minutes, matching how often the
//              companion app pushes. Works with no backend running.
//   SSE        when NEXT_PUBLIC_BACKEND_URL is set. The Express backend emits
//              an event the moment a device sync lands, so the dashboard
//              updates in seconds instead of waiting for the next poll.
//
// Both call router.refresh(), which re-runs the server component and streams
// fresh HTML in without losing scroll position or client state.
const POLL_MS = 180_000;
/** A sync can carry hundreds of readings; without this each one would refresh. */
const MIN_GAP_MS = 10_000;

export function LiveUpdates({ caregiverId, seniorId }: { caregiverId: string; seniorId: string }) {
  const router = useRouter();

  useEffect(() => {
    let lastRefresh = 0;
    let pending: ReturnType<typeof setTimeout> | undefined;

    const refresh = () => {
      lastRefresh = Date.now();
      router.refresh();
    };

    const refreshThrottled = () => {
      const elapsed = Date.now() - lastRefresh;
      if (elapsed >= MIN_GAP_MS) {
        refresh();
      } else if (!pending) {
        pending = setTimeout(() => {
          pending = undefined;
          refresh();
        }, MIN_GAP_MS - elapsed);
      }
    };

    const poll = setInterval(refresh, POLL_MS);

    const base = process.env.NEXT_PUBLIC_BACKEND_URL;
    let stream: EventSource | undefined;
    if (base) {
      // EventSource cannot set headers, hence userId in the query string --
      // see the note on requireUser in backend/src/middleware/auth.ts.
      const url = `${base}/api/stream?userId=${encodeURIComponent(caregiverId)}&seniorId=${encodeURIComponent(seniorId)}`;
      stream = new EventSource(url);
      stream.addEventListener("reading", refreshThrottled);
      stream.addEventListener("alert", refresh);
      // A dropped connection is not worth surfacing: polling still covers us,
      // and EventSource reconnects on its own.
      stream.onerror = () => {};
    }

    return () => {
      clearInterval(poll);
      if (pending) clearTimeout(pending);
      stream?.close();
    };
  }, [router, caregiverId, seniorId]);

  return null;
}
