"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Browser Supabase client, authenticated as the signed-in caregiver.
//
// The publishable key alone reads nothing: migration 008 revoked `anon`
// entirely. What grants access is the Auth0 ID token supplied by
// `accessToken` below -- Supabase validates it against the tenant's JWKS and,
// because the post-login Action sets `role: authenticated`, runs queries as
// that role. Migration 010's policies then scope every row to the seniors
// this caregiver is actually linked to.
//
// So the worst case for a leaked bundle is an attacker holding a key that
// returns 401 on every table.

let client: SupabaseClient | undefined;

/** Cached so a token fetch isn't made on every single request. */
let cached: { token: string; expiresAtMs: number } | undefined;

async function currentToken(): Promise<string | null> {
  // Refresh a minute early rather than risk a request with an expired token.
  if (cached && Date.now() < cached.expiresAtMs - 60_000) return cached.token;

  try {
    const res = await fetch("/api/realtime-token", { cache: "no-store" });
    if (!res.ok) {
      cached = undefined;
      return null;
    }
    const { token, expiresAt } = (await res.json()) as { token: string; expiresAt: number | null };
    cached = {
      token,
      // expiresAt is epoch seconds; fall back to a short window if absent.
      expiresAtMs: expiresAt ? expiresAt * 1000 : Date.now() + 5 * 60_000,
    };
    return token;
  } catch {
    cached = undefined;
    return null;
  }
}

/** undefined when the public env vars are missing, so callers can fall back. */
export function supabaseBrowser(): SupabaseClient | undefined {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return undefined;

  client = createClient(url, key, {
    accessToken: currentToken,
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 5 } },
  });

  return client;
}
