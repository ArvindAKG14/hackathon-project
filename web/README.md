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

Open http://localhost:3000 and sign in with Auth0.

In `.env.local`:

- `SUPABASE_URL` is the Project URL, e.g. `https://abcd.supabase.co`, **without** `/rest/v1/` on the end
- `SUPABASE_SECRET_KEY` is the secret key (`sb_secret_…`) from Project Settings > API Keys
- `APP_BASE_URL`, `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` and
  `AUTH0_SECRET` come from the Auth0 application. Ask a teammate for the file
  privately; the client secret is also in the Auth0 dashboard.

All of them are only read on the server. Never commit `.env.local`.

### Linking your Auth0 login to the seed data

Sign-in finds your caregiver row by `users.auth0_sub`. The seed rows have
placeholder values, so the first time you sign in, `/login` shows your real
Auth0 id (e.g. `auth0|6720…`). Put it on a seed caregiver in the Supabase SQL
editor:

```sql
UPDATE users SET auth0_sub = 'auth0|your-id' WHERE email = 'david.chen@example.com';
```

## Pages

| Route | What it shows |
|---|---|
| `/` | Landing page |
| `/login` | Sign in or sign up with Auth0; explains how to link an account that has no `users` row yet |
| `/auth/*` | Auth0 login, logout and callback routes, served by `src/proxy.ts` |
| `/dashboard` | The seniors this caregiver is linked to through `caregiver_links` |
| `/dashboard/[seniorId]` | Open alerts (with "Mark as seen"), latest readings, heart rate over 24 hours, steps, sleep and blood pressure over 7 days, and earlier alerts |

## How data access works

The schema has no row-level security, so the browser never talks to Supabase.
Every query runs on the server with the secret key, in `src/lib/data.ts`, and
each one that returns a senior's data first checks for an accepted row in
`caregiver_links`, as `db/README.md` requires.

## Not done yet

- **Account creation.** A new Auth0 sign-up has no `users` row, so it has to be
  linked by hand (see above). Next: create the caregiver row on first sign-in.
- **Medications.** The landing page mentions them, but the schema has no
  medications table yet.
- **Row-level security** on the Supabase tables, so the public anon key can't
  read health data.
