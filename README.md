# KinCare

**A daily health chart for the people you look after.**

KinCare lets adult children keep an eye on an older parent's health without
calling every day. The parent wears their watch as usual; their phone sends the
readings to KinCare, and the whole family sees them on one calm page, with an
alert when something needs a closer look.

Live site:[ https://hackathon-project-six-murex.vercel.app](https://www.kin-care.health/)

## What it does

- **Today it tracks** heart rate, blood oxygen, blood pressure, temperature,
  blood glucose, weight, steps and last night's sleep, each marked against the
  parent's own safe range.
- **Trends** Heart rate over the last 24 hours, steps, sleep and blood
  pressure over the last week.
- **Alerts** A reading above the safe range is flagged straight away, and so
  is a reading under. if the data stops coming, KinCare says so instead of assuming
  all is well. Whoever sees an alert first marks it as seen, so the rest of
  the family knows it's handled.
- **A weekly summary in plain words**, such as "she slept less than usual and
  her oxygen dipped twice on Tuesday", for anyone who'd rather not read a chart.
- **Live updates** The page refreshes by itself as new readings arrive.
- **Built for the family.** One person sets up the parent's profile, then
  shares a short code like `XXXX-XXXX` that brothers and sisters can read out
  over the phone. The parent never needs an account or a password.

## How it works

1. **The parent's phone collects readings** from Android Health Connect
   (including Samsung Health) and sends them to KinCare. The server also
   accepts Apple Health data, ready for an iPhone app.
2. **The readings are stored** in a Supabase (Postgres) database. Only family
   members who've been given a share code can see a parent's data.
3. **The website charts them** and raises alerts. This lets the children follow
   their loved one's health from anywhere in the world. Because nothing is more important than family

## What's in this repo

| Folder | What it is |
|---|---|
| [`web/`](web/) | The website: landing page, sign-in and the family dashboard (Next.js) |
| [`android/`](android/) | KinCare Sync, the Android app that sends Health Connect data |
| [`db/`](db/) | Database schema, migrations and demo data |

To run the website locally, see [`web/README.md`](web/README.md).

> KinCare is not a medical device and doesn't replace advice from a doctor.
> In an emergency, call your local emergency number.
