# KinCare Sync (Android)

The companion app for the senior's phone. Health Connect has no cloud API, so
this app reads it on the phone and posts the data to `/api/devices/sync`, in
the shape `web/src/lib/ingest/healthConnect.ts` expects. Samsung Health data
reaches it by way of Health Connect.

One screen, three steps: pair with a code, allow Health Connect access, sync
the last 24 hours or 7 days. Syncing is manual for now; background sync
(WorkManager plus the background-read permission) is the next step.

## Run it

1. Install Android Studio, then **File > Open** this `android/` folder and let
   Gradle sync (it downloads the Android SDK and dependencies the first time).
2. On the phone: Settings > About phone > Software information > tap
   **Build number** 7 times, then Developer options > **USB debugging** on.
3. Plug the phone in, accept the debugging prompt, pick it in the device menu
   and press **Run**.

Samsung Health only shares what you allow: Samsung Health > Settings >
Health Connect.

## Backend address

Use the deployed app:

```
https://www.kin-care.health
```

HTTPS and always reachable, so the phone needs no tunnel, no cleartext
exemption and no laptop running. Type it into the app's backend field.

Use this host, not the old `*.vercel.app` one. Auth0's callback is fixed to
this domain, so the other origin cannot complete a login.

To point at a local `npm run dev` instead, the phone still has to reach your
machine — a tunnel (`cloudflared tunnel --url http://localhost:3000`) or your
LAN IP, on **port 3000**. There is no separate backend process any more; the
device endpoints are Next.js route handlers inside `web/`.

## Pairing

Pair once. The token is stored in `data_sources.token_hash` in the database,
so it survives restarts and redeploys — you only pair again if the device is
revoked.

Codes are minted by a signed-in caregiver for a senior they're linked to:

```
POST /api/seniors/<seniorId>/devices/pairing-code
```

That route needs an **Auth0 session cookie**, so it can't be called with a
bare `curl`. Until the dashboard has a button for it, the practical options
are the browser devtools console while signed in:

```js
await fetch("/api/seniors/11111111-1111-1111-1111-111111111111/devices/pairing-code",
            { method: "POST" }).then(r => r.json())
```

or inserting one directly (Margaret Chen, created by David Chen, from
`db/seed.sql`):

```sql
INSERT INTO device_pairing_codes (code, senior_id, created_by, expires_at)
VALUES ('ABCD2345', '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222', now() + interval '10 minutes');
```

Codes are single use, expire after 10 minutes, and must match `[A-HJ-NP-Z2-9]{8}`
— no 0/O or 1/I, since they get read aloud.

## Files

| File | What it does |
|---|---|
| `HealthReader.kt` | Reads each record type the user allowed and serializes it for the backend |
| `BackendClient.kt` | `pair` and `sync` calls; syncs in batches of 500 |
| `MainActivity.kt` | The screen |
| `PermissionsRationaleActivity.kt` | The privacy explanation Health Connect requires before it will show its permission dialog |
