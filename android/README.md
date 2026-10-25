# KinCare Sync (Android)

The companion app for the senior's phone. Health Connect has no cloud API, so
this app reads it on the phone and posts the data to the backend's
`/api/devices/sync`, in the shape `backend/src/integrations/healthConnect.ts`
expects. Samsung Health data reaches it by way of Health Connect.

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

## Pairing

The backend must be reachable from the phone (a tunnel to port 4000, or a
deployed URL). Create a code for a senior, then type the backend address and
the code into the app. With a database, the backend's ids are the `users.id`
UUIDs, so as Priya Chen, for Margaret Chen (from `db/seed.sql`):

```bash
curl -X POST -H "x-user-id: 33333333-3333-3333-3333-333333333333" \
  https://<backend>/api/seniors/11111111-1111-1111-1111-111111111111/devices/pairing-code
```

Codes expire after 10 minutes. Device tokens live in the backend's memory, so
after a backend restart the app says it's no longer paired; pair again.

## Files

| File | What it does |
|---|---|
| `HealthReader.kt` | Reads each record type the user allowed and serializes it for the backend |
| `BackendClient.kt` | `pair` and `sync` calls; syncs in batches of 500 |
| `MainActivity.kt` | The screen |
| `PermissionsRationaleActivity.kt` | The privacy explanation Health Connect requires before it will show its permission dialog |
