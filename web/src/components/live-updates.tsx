"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

// Keeps a server-rendered dashboard current.
//
// Two mechanisms, deliberately overlapping:
//
//   Realtime  Supabase pushes `measurements` and `alerts` inserts the moment a
//             device sync writes them, so the page updates in seconds. The
//             subscription is authenticated with the caregiver's Auth0 token
//             and the RLS policies in migration 010 scope it to their own
//             seniors -- the filter below is a bandwidth optimisation, not the
//             security boundary.
//
//   Polling   Every 3 minutes regardless, plus whenever a backgrounded tab is
//             brought forward. This is the floor: it still works if the
//             websocket is blocked, the public env vars are missing, or the
//             socket dies quietly. Realtime makes the page fast; polling makes
//             it correct.
//
// Both call router.refresh(), which re-runs the server component and streams
// new HTML in without losing scroll position or client state.
const POLL_MS = 180_000;
/** One sync can insert hundreds of rows; coalesce them into one refresh. */
const MIN_GAP_MS = 5_000;

export function LiveUpdates({ seniorId }: { seniorId: string }) {
  const router = useRouter();

  useEffect(() => {
    let lastRefresh = 0;
    let pending: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const refresh = () => {
      if (cancelled) return;
      lastRefresh = Date.now();
      router.refresh();
    };

    const refreshCoalesced = () => {
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
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    const supabase = supabaseBrowser();
    if (!supabase) {
      console.info("[kincare] Realtime off: NEXT_PUBLIC_SUPABASE_* not set. Polling every 3 minutes.");
    }

    const channel = supabase
      ?.channel(`senior:${seniorId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "measurements", filter: `senior_id=eq.${seniorId}` },
        refreshCoalesced,
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "alerts", filter: `senior_id=eq.${seniorId}` },
        // An alert is the thing a caregiver is waiting for; never delay it.
        refresh,
      )
      // Without this, a failed socket is indistinguishable from a quiet one --
      // polling would keep the page correct and hide that Realtime is dead.
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          console.info("[kincare] Realtime connected. Updates will appear within seconds.");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          console.warn(`[kincare] Realtime ${status}; falling back to 3-minute polling.`, err ?? "");
        }
      });

    return () => {
      cancelled = true;
      clearInterval(poll);
      if (pending) clearTimeout(pending);
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) supabase?.removeChannel(channel);
    };
  }, [router, seniorId]);

  return null;
}
