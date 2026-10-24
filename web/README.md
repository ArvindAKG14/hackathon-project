# KinCare web

The caregiver website: a landing page, plus a dashboard where adult children see
their parent's readings from the Supabase database in `../db`.

Built with Next.js 16 (App Router), Tailwind CSS 4 and `@supabase/supabase-js`.

## Setup

Needs Node.js 20 or later and a Supabase project with `db/migrations` and
`db/seed.sql` loaded.

```bash
cd web
npm install
cp .env.example .env.local   # then fill in the two values
npm run dev
```

Open http://localhost:3000. Sign in as David or Priya Chen from the seed data.

In `.env.local`:

- `SUPABASE_URL` is the Project URL, e.g. `https://abcd.supabase.co`, **without** `/rest/v1/` on the end
- `SUPABASE_SECRET_KEY` is the secret key (`sb_secret_…`) from Project Settings > API Keys

Both are only read on the server. Never commit `.env.local`.

## Pages

| Route | What it shows |
|---|---|
| `/` | Landing page |
| `/login` | Demo sign-in: pick a caregiver from `users` |
| `/dashboard` | The seniors this caregiver is linked to through `caregiver_links` |
| `/dashboard/[seniorId]` | Open alerts (with "Mark as seen"), latest readings, heart rate over 24 hours, steps, sleep and blood pressure over 7 days, and earlier alerts |

## How data access works

The schema has no row-level security, so the browser never talks to Supabase.
Every query runs on the server with the secret key, in `src/lib/data.ts`, and
each one that returns a senior's data first checks for an accepted row in
`caregiver_links`, as `db/README.md` requires.

## Not done yet

- **Real sign-in.** `/login` is a demo: it stores the chosen user's id in a
  cookie, so anyone can impersonate anyone. Replace `getCurrentCaregiver()` in
  `src/lib/session.ts` with an Auth0 session lookup on `users.auth0_sub`.
- **Medications.** The landing page mentions them, but the schema has no
  medications table yet.
- **Row-level security** on the Supabase tables, so the public anon key can't
  read health data.
