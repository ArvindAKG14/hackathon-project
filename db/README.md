# Database

PostgreSQL schema for the elder-care monitoring app: seniors wear a device, their
adult children watch the data on a web dashboard.

Built and verified against **PostgreSQL 18.6**. Requires PG 13+ (`gen_random_uuid()`).

## Setup

### Local (Docker)

A container named `my-postgres` is already running on this machine with port 5432
published. `psql` is **not** on the Windows PATH, so commands go through `docker exec`.

```powershell
# One-time
docker exec my-postgres psql -U postgres -c "CREATE DATABASE health_monitor;"
docker cp .\db my-postgres:/tmp/db

# Migrations, in order
$files = @("001_extensions_and_enums","002_users_and_links","003_data_sources",
           "004_measurements","005_sleep_and_blood_pressure","006_alerts","007_views",
           "008_rls","009_device_pairing","010_rls_policies","011_care_team_views",
           "012_eastern_time","013_height_metric","014_stale_data_alerts")
foreach ($f in $files) {
  docker exec my-postgres psql -U postgres -d health_monitor -v ON_ERROR_STOP=1 -q -f "/tmp/db/migrations/$f.sql"
}

# Mock data + verification
docker exec my-postgres psql -U postgres -d health_monitor -f /tmp/db/seed.sql
docker exec my-postgres psql -U postgres -d health_monitor -f /tmp/db/seed_more.sql
docker exec my-postgres psql -U postgres -d health_monitor -f /tmp/db/verify.sql
```

Re-copying after editing a file needs the old copy removed first, or `docker cp`
nests it at `/tmp/db/db`:

```powershell
docker exec my-postgres rm -rf /tmp/db; docker cp .\db my-postgres:/tmp/db
```

Connection string for local work: `postgresql://postgres@localhost:5432/health_monitor`

### Supabase

Project `ofuiulitkslywrxcbrmv` is **already provisioned** — all 14 migrations applied
and seeded (`seed.sql` and `seed_more.sql`) against PostgreSQL 17.11. You only need this section to re-apply from
scratch.

Use the **Session pooler** connection string (Dashboard → Connect → Session pooler):

```
postgresql://postgres.ofuiulitkslywrxcbrmv:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres
```

Two gotchas, both confirmed the hard way:

- **Not the Direct connection.** `db.<ref>.supabase.co` is IPv6-only and will not
  resolve from a Docker container or most home ISPs.
- **Session pooler (5432), not Transaction pooler (6543).** Migrations wrap multiple
  statements per transaction and `seed.sql` calls `setseed()`; transaction mode can't
  carry session state.

```bash
for f in db/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
psql "$DATABASE_URL" -f db/seed.sql
psql "$DATABASE_URL" -f db/seed_more.sql
psql "$DATABASE_URL" -f db/verify.sql
```

The schema is plain SQL with no vendor-specific syntax, so it also runs unmodified on
Neon, Railway, or any PostgreSQL 15+.

> `public.test` (empty, created by someone on the team) is unrelated to this schema and
> is left untouched by the migrations and the seed.

## Files

| File | Contents |
|---|---|
| `migrations/001_extensions_and_enums.sql` | `citext`, all enum types, `set_updated_at()` trigger function |
| `migrations/002_users_and_links.sql` | `users`, `caregiver_links`, `link_invitations` |
| `migrations/003_data_sources.sql` | `data_sources` |
| `migrations/004_measurements.sql` | `measurements` + its four indexes |
| `migrations/005_sleep_and_blood_pressure.sql` | `sleep_sessions`, `blood_pressure_readings` |
| `migrations/006_alerts.sql` | `alert_thresholds`, `alerts` |
| `migrations/007_views.sql` | `latest_measurements` view |
| `migrations/008_rls.sql` | Row-level security — **required before exposing over HTTP** |
| `migrations/009_device_pairing.sql` | Device tokens and pairing codes |
| `migrations/010_rls_policies.sql` | Per-user RLS policies + Realtime publication |
| `migrations/011_care_team_views.sql` | `senior_caregivers` and `caregiver_seniors` views: who looks after whom |
| `migrations/012_eastern_time.sql` | Database shows times in Eastern Time (EDT/EST) instead of UTC; stored instants unchanged |
| `migrations/013_height_metric.sql` | `height` added to the `metric_type` enum |
| `migrations/014_stale_data_alerts.sql` | no_data alerts + hourly pg_cron check |
| `seed.sql` | 7 days of mock data. Idempotent — truncates first, safe to re-run |
| `seed_more.sql` | A second senior and more share codes. Truncates nothing, so safe on a live database |
| `verify.sql` | 12 checks: dashboard queries, idempotency, index usage, constraints |
| `verify_rls.sql` | Proves one family cannot see another's data |
| `verify_stale.sql` | Proves silence is alerted once per episode |

## Schema

```
users ──┬── caregiver_links ──┐
        ├── link_invitations ─┘
        ├── data_sources ──┐
        ├── alert_thresholds
        └── alerts            │
                              │
     measurements ────────────┤
     sleep_sessions ──────────┤
     blood_pressure_readings ─┘
```

### Authentication

Auth is delegated to **Auth0**. `users.auth0_sub` holds the `sub` claim from the ID
token (`auth0|abc123`, `google-oauth2|...`). There is no password column.

`auth0_sub` is **nullable** on purpose: a caregiver usually creates their parent's
profile before that parent has an Auth0 account, and often the parent never gets one.
Such a senior is a full row with real readings who simply cannot log in.

`email` is denormalized from the ID token for display and search. It is not the
authentication key.

### Linking seniors to caregivers

`caregiver_links` records an established relationship; `link_invitations` is the
consent step that creates one. A link is never created silently.

1. Whoever owns the senior profile generates an invitation → a code like `K7M2-9QX4`
   (format enforced by a CHECK constraint; short enough to read over the phone).
2. Another family member redeems the code.
3. The API writes a `caregiver_links` row with `status='accepted'` and marks the
   invitation accepted.

This handles the realistic case — one child sets Mom up, then shares access with a
sibling — without anyone sharing credentials.

> `senior_id` pointing at a user whose `role` is `'senior'` is enforced in the API,
> not by a constraint. A Postgres FK can't reference a literal role value without a
> composite key that complicates every other join.

### Ingest: push, not pull

**HealthKit and Health Connect are on-device APIs. The server cannot poll them.**
There is no Apple or Google endpoint to pull from. The mobile app reads locally and
POSTs batches to the REST API. "Updates every 3 minutes" means *the phone pushes every
~3 minutes, and the web dashboard polls our own API*.

Two consequences the schema is built around:

**Readings arrive late and out of order.** A phone offline for six hours dumps six
hours of backdated readings at once. `recorded_at` is when the body did the thing;
`ingested_at` is when we heard about it. Charts use the former, sync diagnostics the
latter.

**Uploads get retried.** Ingest must be idempotent, and it is — at the database level,
not in application code:

```sql
INSERT INTO measurements (senior_id, data_source_id, metric_type, value, unit,
                          recorded_at, period_start, period_end, external_id)
VALUES (...)
ON CONFLICT DO NOTHING;
```

Two partial unique indexes make that work. When the source gave us a record id
(`HKSample.uuid`, Health Connect's `Metadata.id`), it goes in `external_id` and
`(senior_id, metric_type, external_id)` is the identity. Without one, the natural key
`(senior_id, metric_type, recorded_at)` applies. Re-send an overlapping window as often
as you like; `verify.sql` check 10 proves it inserts zero rows.

### Point vs interval metrics

A heart rate sample is an instant: `recorded_at` set, `period_start`/`period_end` NULL.
A step count covers a span: both period columns set, `recorded_at = period_end`. A CHECK
constraint enforces both-or-neither.

Both platforms return **interval samples** with their own start/end times
(`HKQuantityTypeIdentifierStepCount`, Health Connect's `StepsRecord`), so these columns
map straight onto the source payloads. Summing interval samples over a window gives the
daily total — there is no stored cumulative counter to accidentally double-count.

### How the pieces fit together

```
  phone ──POST /api/devices/sync──> web/ (Next.js) ──writes──> Postgres
                                        │                          ↑
  browser <──server-rendered HTML───────┘ ───────reads─────────────┘
```

One service. There used to be a separate Express backend, but it served
hardcoded seniors while the web app served database rows, so the two halves of
the product described different people. The ingest path moved into Next.js
route handlers and the Express app was deleted.

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/seniors/:id/devices/pairing-code` | Auth0 session + `caregiver_links` | caregiver mints a code |
| `POST /api/devices/pair` | the code itself | phone exchanges it for a bearer token |
| `POST /api/devices/sync` | device bearer token | phone uploads readings |
| `GET /api/seniors/:id/devices` | Auth0 session | list paired phones |
| `DELETE /api/seniors/:id/devices/:deviceId` | Auth0 session | revoke one |

Phones authenticate with a device token, not Auth0 — they are devices, not
people. Only the SHA-256 hash is stored (`data_sources.token_hash`), so a
database leak does not hand out working tokens. Pairing codes and tokens live
in `device_pairing_codes` and `data_sources` rather than in memory, because a
route handler has no memory between requests.

**Reads use supabase-js; the ingest path uses `pg` directly.** Not an
oversight: device sync depends on `ON CONFLICT DO NOTHING` against the partial
unique indexes in migrations 004 and 005, and PostgREST's `on_conflict`
parameter only takes a column list — it cannot express those indexes' `WHERE`
predicate, so inference fails. Hence `DATABASE_URL` alongside `SUPABASE_URL`.

**Freshness is polling, every 3 minutes** (`web/src/components/live-updates.tsx`),
plus an immediate refresh when a backgrounded tab becomes visible.

Supabase Realtime is the intended replacement and the database side is ready —
`010_rls_policies.sql` adds the per-user policies `postgres_changes` honours, and
puts `measurements`, `alerts` and `blood_pressure_readings` in the
`supabase_realtime` publication. Two pieces of configuration remain before the
browser can subscribe: registering Auth0 as a Third-Party Auth provider in the
Supabase dashboard, and an Auth0 API so the SDK can mint an audience-scoped access
token. Until then, polling.

### How data actually gets in

`web/src/app/api/devices/sync` is the ingest endpoint. The adapters in
`web/src/lib/ingest/` convert each platform's native payload to canonical
units, and `web/src/lib/ingest/persist.ts` writes it in one transaction.

Set `DATABASE_URL` in `web/.env.local` — see `web/.env.example`.

No phone? `npm run mock:push` generates native HealthKit or Health Connect
payloads and posts them through the real endpoints:

```bash
cd web
npm run dev                                      # in one terminal
npm run mock:push                                # HealthKit, last 6 hours
npm run mock:push -- --platform health_connect --hours 24
```

It mints its pairing code straight in the database, since a CLI script has no
Auth0 session; everything after that is real HTTP. Re-running stores almost
nothing — external ids derive from snapped timestamps, so only the few samples
at the leading edge of the window are new.

**Canonical units are set by the ingest path**, not by the source. HealthKit's
0–1 SpO2 fraction, its `mmol<180.156>/L` glucose unit string, pounds,
kilometres and Fahrenheit all normalize on arrival. Blood glucose is **mg/dL**;
`seed.sql` matches, so mock and real data share one scale.

### Metrics

`measurements` holds every metric expressible as one number plus a unit. The
`metric_type` enum:

| | |
|---|---|
| Vitals | `heart_rate`, `resting_heart_rate`, `spo2`, `body_temperature`, `respiratory_rate` |
| Activity | `steps`, `distance`, `calories_burned`, `active_minutes`, `floors_climbed` |
| Periodic | `weight`, `blood_glucose` |
| Thresholds only | `blood_pressure_systolic`, `blood_pressure_diastolic` |

Two metrics don't fit that shape and get their own tables. `sleep_sessions` is a span
with a stage breakdown. `blood_pressure_readings` is inherently two numbers taken
together — splitting them into two rows would let them drift apart and would make the
`systolic > diastolic` check impossible.

Blood pressure *thresholds* still work through the enum, so there's one alerting
mechanism rather than two.

### Alerts

`alert_thresholds` holds a per-senior safe range per metric. A NULL bound is unbounded
on that side — SpO2 has only a floor, temperature has both.

`alerts.threshold_min`/`threshold_max` are **snapshots** of the bounds at trigger time,
not foreign keys. A caregiver who later widens the safe range must not silently rewrite
the history of why an alert fired.

### Security: read this before writing any API code

Supabase publishes every table in `public` through PostgREST. **The `anon` key is a
public, client-side credential** — it ships inside the web app's JavaScript bundle.
Without row-level security, anyone who opens devtools can read every senior's health
data from `/rest/v1/measurements`.

`008_rls.sql` closes this: RLS on every table, no policies, `anon`/`authenticated`
grants revoked. `010_rls_policies.sql` then adds real per-user policies now that
Supabase can verify an Auth0 token.

A caregiver sees exactly the seniors in their `caregiver_links`, enforced by the
database rather than by the application remembering to check. **`SELECT` only** —
`authenticated` has no `INSERT`/`UPDATE`/`DELETE` anywhere, so a stolen browser token
cannot alter a row. `link_invitations` and `device_pairing_codes` have no policy at
all: they hold codes that grant access, so the browser never sees one.

Run `verify_rls.sql` to prove it. It builds a second, unrelated family and checks
neither can see the other:

```
David          -> sees Margaret, blind to family B, can't see their user row
Caregiver B    -> sees own senior, BLIND TO MARGARET, no alerts/sleep/BP leaked
Unlinked user  -> 0 rows everywhere, including through the view
No token       -> 0 rows
anon blocked, authenticated read-only, share codes hidden
```

It also sets `security_invoker = on` on `latest_measurements`. This is easy to miss: a
PostgreSQL view runs with its **owner's** permissions by default, so the view would
have handed out exactly the rows that RLS on `measurements` is there to protect.

**Therefore:**

- The REST API connects with the **`service_role`** key, which has `BYPASSRLS`.
- That key must **never** reach a browser — server-side environment variable only. If
  it leaks, rotate it in Dashboard → Settings → API.
- Authorization is the API's job, via the `caregiver_links` check below. The database
  denies everyone by default; your API is what decides who sees what.

Because auth is Auth0 rather than Supabase Auth, `auth.uid()` policies aren't
available. Deny-all plus a trusted server-side key is the correct shape here. If you
later want the browser to query Supabase directly, that means wiring Auth0 JWTs into
Supabase's custom-JWT setting and writing real policies — a deliberate project, not a
config toggle.

### Silence is a signal

Every other alert is raised by a reading that arrived. `detect_stale_data()`
watches for readings that never come, because in elder care the dangerous
failure is quiet: a dead phone, an uninstalled app or a watch in a drawer
looks exactly like a healthy, resting senior. The dashboard's staleness badge
only helps someone already looking, and the premise is that nobody is looking
at 3am.

`pg_cron` runs it hourly at :07. It lives in the database rather than a Vercel
cron on purpose — a check that can go quiet has the same flaw it exists to
catch.

A senior is silent only when **every** paired phone is, so it takes the most
recent sync across all of them. Revoked devices and the `manual`/`mock`
sources are excluded: they were never going to report on a schedule.

Alerts fire **once per silence episode**, not once per run. The rule is "is
there already an alert raised later than the last sync?" — when data resumes,
`last_sync_at` moves forward and the next silence qualifies again.
Deliberately not keyed on acknowledgement, or one unread alert would suppress
every future one.

`alerts.alert_kind` distinguishes these from threshold breaches, and
`metric_type` is nullable for them: the absence of readings isn't about one
metric. A CHECK still requires it for `threshold` alerts.

### Time zones

Every timestamp is `timestamptz`, stored in UTC. `users.timezone` holds an IANA zone
because "today's step count" for a senior in New York is a different window than for
their child in San Francisco. Compute daily boundaries with
`AT TIME ZONE users.timezone`, never with the server's clock.

## Dashboard queries

**Tile row — latest value of every metric, one indexed scan:**

```sql
SELECT metric_type, value, unit, recorded_at
FROM latest_measurements
WHERE senior_id = $1;
```

**Chart series — hourly aggregates over 24h:**

```sql
SELECT date_trunc('hour', recorded_at) AS hour,
       min(value), avg(value), max(value)
FROM measurements
WHERE senior_id = $1 AND metric_type = $2
  AND recorded_at > now() - interval '24 hours'
GROUP BY 1 ORDER BY 1;
```

**Authorization — run this before returning any senior's data:**

```sql
SELECT 1 FROM caregiver_links
WHERE caregiver_id = $1 AND senior_id = $2 AND status = 'accepted';
```

**Open alerts:**

```sql
SELECT * FROM alerts
WHERE senior_id = $1 AND acknowledged_at IS NULL
ORDER BY triggered_at DESC;
```

**Staleness badge:**

```sql
SELECT provider, last_sync_at, now() - last_sync_at AS age
FROM data_sources WHERE senior_id = $1;
```

## Mock data

`seed.sql` creates Margaret Chen (77, New York) and her two children, David and Priya,
who both monitor her. Fixed UUIDs so the frontend can hardcode them:

| | |
|---|---|
| `11111111-1111-1111-1111-111111111111` | Margaret Chen — senior, no `auth0_sub` |
| `22222222-2222-2222-2222-222222222222` | David Chen — son, `auth0\|mock-david-chen` |
| `33333333-3333-3333-3333-333333333333` | Priya Chen — daughter, `google-oauth2\|mock-priya-chen` |
| `44444444-4444-4444-4444-444444444444` | Walter Chen — senior (80, Margaret's husband), no `auth0_sub`. From `seed_more.sql` |

`seed_more.sql` links David to Walter, so one caregiver looks after two seniors, and
adds share codes in every state: pending (Walter's, for Priya; another for Margaret),
expired and revoked. Walter has no readings yet. See who looks after whom with:

```sql
SELECT senior_name, caregivers FROM senior_caregivers;  -- each senior's caregivers
SELECT caregiver_name, seniors FROM caregiver_seniors;  -- each caregiver's seniors
```

Seven days of readings ending at load time, at the same cadence the real app will push:
heart rate every 3 min on a diurnal curve (mid-50s asleep, ~80 during afternoon
activity), SpO2 and activity every 15 min, temperature hourly, nightly sleep sessions,
twice-daily blood pressure and glucose. About 5,700 measurement rows.

Two deliberate breaches so the alerts panel isn't empty during a demo:

- **138 bpm** two days ago — already acknowledged by David
- **88% SpO2** nine hours ago — still open

`SELECT setseed(0.42)` makes the curves identical for everyone, so "the chart looks
wrong" is a comparable claim between teammates.

Everything is tagged `provider='mock'`. To clear it before launch:

```sql
DELETE FROM measurements WHERE data_source_id IN
    (SELECT id FROM data_sources WHERE provider = 'mock');
```

## Deliberately not included

- **Write policies** — `authenticated` has `SELECT` only. Every mutation goes through
  a server action or the device ingest path, so there is nothing for a browser token
  to write
- **Partitioning / retention** — unnecessary below millions of rows
- **OAuth token storage** — HealthKit and Health Connect are on-device; there are no
  server-side tokens to store
- **The companion mobile apps** — the ingest contract they must post to is documented
  at the top of `web/src/lib/ingest/healthkit.ts` and `healthConnect.ts`
