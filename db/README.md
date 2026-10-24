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

### Hosted (Supabase / Neon / Railway)

Plain SQL with no vendor-specific syntax — paste each migration into the SQL editor
in filename order, or:

```bash
for f in db/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
psql "$DATABASE_URL" -f db/seed.sql
```

Connection string for local work: `postgresql://postgres@localhost:5432/health_monitor`

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

- **Row-level security** — `auth0_sub` is the natural RLS key when you want it
- **Partitioning / retention** — unnecessary below millions of rows
- **OAuth token storage** — HealthKit and Health Connect are on-device; there are no
  server-side tokens to store
- **The REST API itself**
