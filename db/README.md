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
           "004_measurements","005_sleep_and_blood_pressure","006_alerts","007_views")
foreach ($f in $files) {
  docker exec my-postgres psql -U postgres -d health_monitor -v ON_ERROR_STOP=1 -q -f "/tmp/db/migrations/$f.sql"
}

# Mock data + verification
docker exec my-postgres psql -U postgres -d health_monitor -f /tmp/db/seed.sql
docker exec my-postgres psql -U postgres -d health_monitor -f /tmp/db/verify.sql
```

Re-copying after editing a file needs the old copy removed first, or `docker cp`
nests it at `/tmp/db/db`:

```powershell
docker exec my-postgres rm -rf /tmp/db; docker cp .\db my-postgres:/tmp/db
```

Connection string for local work: `postgresql://postgres@localhost:5432/health_monitor`

### Supabase

Project `ofuiulitkslywrxcbrmv` is **already provisioned** — all 8 migrations applied
and seeded against PostgreSQL 17.11. You only need this section to re-apply from
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
| `seed.sql` | 7 days of mock data. Idempotent — truncates first, safe to re-run |
| `verify.sql` | 12 checks: dashboard queries, idempotency, index usage, constraints |

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
  phone  ──POST /api/devices/sync──>  backend/ (Express :4000)
                                          │
                                          ├── writes ──> Postgres
                                          │
                                          └── SSE event ──┐
                                                          ↓
  browser <──server-rendered HTML──  web/ (Next.js :3000) ──reads──> Postgres
```

The database is the single source of truth, and **both services read their
identities from it**. `backend/src/data/seedFromDb.ts` loads seniors,
caregivers and links from `users` / `caregiver_links` at startup, so an
in-memory senior id *is* a `users.id` UUID.

That matters more than it sounds. Before it, Express served hardcoded seniors
(`s1` "Kamala Devi") while the web app served database rows (Margaret Chen) --
same product, different people, and device syncs landed under ids the dashboard
had never heard of. Now `/api/seniors`, the SSE stream, device pairing and the
web dashboard all name the same person.

With no `DATABASE_URL`, the backend falls back to the hardcoded demo seed, so it
still runs standalone.

**The vitals simulator is off when identities come from the database.** It
invents readings every two seconds; against real seniors those would exist in
the in-memory store but not in Postgres, so the live view and the stored history
would quietly disagree. `SIMULATOR=on` forces it back on.

### How data actually gets in

`backend/` implements the ingest path. A paired phone posts a batch to
`POST /api/devices/sync`; the adapters in `backend/src/integrations/` convert the
platform's native payload to canonical units, and `backend/src/db/persist.ts`
writes it in one transaction.

Set `DATABASE_URL` in `backend/.env` to turn persistence on — without it the
server runs in memory only, so nobody needs database access to work on the
dashboard. See `backend/.env.example`.

No phone? `npm run mock:push` generates native HealthKit or Health Connect
payloads and posts them through the real endpoints:

```bash
cd backend
npm run dev                                      # in one terminal
npm run mock:push                                # HealthKit, last 6 hours
npm run mock:push -- --platform health_connect --hours 24
```

`mock:push` asks the backend which caregiver and senior exist rather than
hardcoding ids, so it works against either the database-backed or the demo
seed. Override with `MOCK_USER_ID` / `MOCK_SENIOR_ID`.

A sync also pushes an SSE event, so an open dashboard updates within seconds.
The web app refreshes itself every 3 minutes regardless; set
`NEXT_PUBLIC_BACKEND_URL` in `web/.env.local` to get the faster path.

**Canonical units are set by the ingest path**, not by the source. Both
platforms' values are converted on arrival — HealthKit's 0–1 SpO2 fraction, its
`mmol<180.156>/L` glucose unit string, pounds, kilometres and Fahrenheit all
normalize to the units in the table below. Blood glucose is **mg/dL**; `seed.sql`
matches, so mock and real data share one scale.

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

`008_rls.sql` closes this. All 9 tables have RLS enabled with **no policies**, and the
`anon`/`authenticated` grants are revoked. Verified against the live project — `anon`
is denied on `measurements`, `users`, `alerts`, `sleep_sessions`,
`blood_pressure_readings`, and `latest_measurements`.

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

- **Per-user RLS policies** — the tables are deny-all (see Security above). Granular
  policies only become possible once Auth0 JWTs are wired into Supabase
- **Partitioning / retention** — unnecessary below millions of rows
- **OAuth token storage** — HealthKit and Health Connect are on-device; there are no
  server-side tokens to store
- **The companion mobile apps** — the ingest contract they must post to is documented
  at the top of `backend/src/integrations/healthkit.ts` and `healthConnect.ts`
