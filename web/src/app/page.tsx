import Link from "next/link";
import { DayChart } from "@/components/day-chart";
import { Logo } from "@/components/logo";

const container = "mx-auto w-full max-w-6xl px-4 sm:px-8";

function VitalsVisual() {
  // A week of systolic readings against the person's agreed range
  const points = [126, 131, 124, 152, 133, 127, 128];
  const y = (v: number) => 70 - ((v - 110) / 50) * 60;
  return (
    <svg viewBox="0 0 240 80" className="h-20 w-full" aria-hidden>
      <rect x="0" y={y(140)} width="240" height={y(110) - y(140)} className="fill-mist" />
      <polyline
        points={points.map((v, i) => `${20 + i * 33},${y(v)}`).join(" ")}
        className="fill-none stroke-care"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {points.map((v, i) => (
        <circle
          key={i}
          cx={20 + i * 33}
          cy={y(v)}
          r={v > 140 ? 6 : 4}
          className={v > 140 ? "fill-rose" : "fill-care"}
        />
      ))}
    </svg>
  );
}

function MedsVisual() {
  const doses = ["t", "t", "t", "m", "t", "t", "d"];
  return (
    <div className="flex h-20 items-center gap-2" aria-hidden>
      {doses.map((d, i) => (
        <span
          key={i}
          className={`flex h-9 flex-1 items-center justify-center rounded-md border-2 ${
            d === "m"
              ? "border-marigold bg-marigold-tint"
              : d === "d"
                ? "border-dashed border-ink-soft/60"
                : "border-line bg-mist"
          }`}
        >
          {d === "t" && <span className="h-3.5 w-3.5 rounded-full bg-care" />}
        </span>
      ))}
    </div>
  );
}

function SleepVisual() {
  const hours = [6.5, 7.2, 5.1, 7.8, 6.9, 7.4, 7.2];
  return (
    <div className="flex h-20 items-end gap-2" aria-hidden>
      {hours.map((h, i) => (
        <span
          key={i}
          className={`flex-1 rounded-t-md ${h < 6 ? "bg-marigold" : "bg-care/70"}`}
          style={{ height: `${(h / 9) * 100}%` }}
        />
      ))}
    </div>
  );
}

function AlertsVisual() {
  return (
    <div className="flex h-20 flex-col justify-center gap-2 text-sm" aria-hidden>
      <span className="self-start rounded-full bg-rose-tint px-3 py-1 font-bold text-rose">
        Blood pressure 152/94, Wed 8:10 am
      </span>
      <span className="self-start rounded-full bg-mist px-3 py-1 text-ink-soft">
        Seen by David, Wed 8:24 am
      </span>
    </div>
  );
}

const tracked = [
  {
    title: "Vitals",
    body: "Blood pressure, heart rate, oxygen, temperature and weight, shown against the range you agreed with their doctor.",
    visual: <VitalsVisual />,
  },
  {
    title: "Medications",
    body: "Each dose on the schedule, marked taken, missed or still due, so nobody has to ask whether the evening tablets went down.",
    visual: <MedsVisual />,
  },
  {
    title: "Activity and sleep",
    body: "Steps, active minutes and how long they slept, taken from their watch. Slow changes over weeks are easier to spot on a chart than in a phone call.",
    visual: <SleepVisual />,
  },
  {
    title: "Alerts",
    body: "Readings outside the safe range are flagged straight away. Whoever sees one first marks it as seen, so the rest of the family knows it's handled.",
    visual: <AlertsVisual />,
  },
];

const audiences = [
  {
    title: "The one who sets it up",
    body: "Create a profile for Mum or Dad, connect their watch, and agree a safe range for each reading. Check how they slept from the other side of the country.",
  },
  {
    title: "Brothers and sisters",
    body: "Join with a short share code like K7M2-9QX4, easy to read out over the phone. Everyone sees the same readings and the same alerts.",
  },
  {
    title: "Mum or Dad",
    body: "They don't need an account or a password. They wear their watch as usual, and their family can see they're doing well without calling every day.",
  },
];

const steps = [
  {
    title: "Their watch records readings",
    body: "Apple Health or Health Connect on their phone sends new readings every few minutes, and catches up after time offline.",
  },
  {
    title: "They're stored securely",
    body: "Only family members who've been given a share code can see a parent's readings.",
  },
  {
    title: "KinCare charts and flags them",
    body: "The day's readings appear on the chart, and anything outside the safe range is flagged for the whole family.",
  },
];

export default function Home() {
  return (
    <>
      <header className={`${container} flex items-center justify-between py-5`}>
        <Logo />
        <nav aria-label="Main" className="flex items-center gap-6">
          <a href="#tracks" className="hidden text-ink-soft hover:text-ink sm:inline">
            What it tracks
          </a>
          <a href="#for" className="hidden text-ink-soft hover:text-ink sm:inline">
            Who it&apos;s for
          </a>
          <Link
            href="/login"
            className="rounded-full border-2 border-care px-4 py-1.5 font-bold text-care-strong hover:bg-mist"
          >
            Sign in
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        <section className={`${container} grid items-center gap-12 pb-20 pt-8 lg:pt-16 xl:grid-cols-[1fr_minmax(0,30rem)]`}>
          <div className="max-w-2xl">
            <h1 className="text-[2.6rem] font-bold leading-[1.08] tracking-[-0.02em] sm:text-[3.4rem]">
              A daily health chart for the people you look after.
            </h1>
            <p className="mt-6 text-xl leading-relaxed text-ink-soft">
              KinCare gathers your parent&apos;s vitals, medication, sleep and
              activity into one calm page, and tells the whole family when
              something needs a closer look.
            </p>
            <div className="mt-9 flex flex-wrap gap-4">
              <Link
                href="/dashboard"
                className="rounded-full bg-care px-7 py-3.5 text-lg font-bold text-on-care hover:bg-care-strong"
              >
                Open the dashboard
              </Link>
              <a
                href="#tracks"
                className="rounded-full px-5 py-3.5 text-lg font-bold text-care-strong underline decoration-2 underline-offset-4 hover:bg-mist"
              >
                See what it tracks
              </a>
            </div>
          </div>
          <div className="w-full max-w-xl">
            <DayChart />
          </div>
        </section>

        <section id="tracks" className="border-y border-line bg-surface py-20">
          <div className={container}>
            <h2 className="max-w-2xl text-3xl font-bold leading-tight sm:text-4xl">
              Four things that matter most, on one page
            </h2>
            <div className="mt-12 grid gap-x-14 gap-y-14 md:grid-cols-2">
              {tracked.map((t) => (
                <article key={t.title} className="max-w-lg">
                  <div className="rounded-xl bg-paper px-5 py-4">{t.visual}</div>
                  <h3 className="mt-5 text-2xl font-bold">{t.title}</h3>
                  <p className="mt-2 text-lg leading-relaxed text-ink-soft">{t.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="for" className={`${container} py-20`}>
          <h2 className="max-w-2xl text-3xl font-bold leading-tight sm:text-4xl">
            Made for the whole family
          </h2>
          <div className="mt-12 grid gap-10 lg:grid-cols-3">
            {audiences.map((a) => (
              <div key={a.title} className="border-l-4 border-care pl-5">
                <h3 className="text-2xl font-bold">{a.title}</h3>
                <p className="mt-3 text-lg leading-relaxed text-ink-soft">{a.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-mist py-20">
          <div className={container}>
            <h2 className="max-w-2xl text-3xl font-bold leading-tight sm:text-4xl">
              How a reading reaches the chart
            </h2>
            <ol className="mt-12 grid gap-10 md:grid-cols-3">
              {steps.map((s, i) => (
                <li key={s.title} className="flex gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-care text-lg font-bold text-on-care">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-xl font-bold">{s.title}</h3>
                    <p className="mt-2 text-lg leading-relaxed text-ink-soft">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={`${container} py-20`}>
          <div className="flex flex-col items-start gap-6 rounded-2xl bg-care px-6 py-12 text-on-care sm:px-12 md:flex-row md:items-center md:justify-between">
            <div className="max-w-xl">
              <h2 className="text-3xl font-bold leading-tight">Start with one parent</h2>
              <p className="mt-3 text-lg leading-relaxed opacity-90">
                Set up their profile, connect their watch, and share a code with
                your brothers and sisters. Their first readings will appear on
                today&apos;s chart.
              </p>
            </div>
            <Link
              href="/dashboard"
              className="shrink-0 rounded-full bg-on-care px-7 py-3.5 text-lg font-bold text-care-strong"
            >
              Open the dashboard
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className={`${container} flex flex-col gap-3 py-8 text-ink-soft sm:flex-row sm:justify-between`}>
          <p className="font-bold text-ink">KinCare</p>
          <p className="max-w-xl text-base leading-relaxed">
            KinCare isn&apos;t a medical device and doesn&apos;t replace advice
            from a doctor. In an emergency, call your local emergency number.
          </p>
        </div>
      </footer>
    </>
  );
}
