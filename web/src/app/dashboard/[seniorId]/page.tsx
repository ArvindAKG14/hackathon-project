import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { markAlertSeen } from "@/app/actions";
import { BarChart, BloodPressureChart, HeartRateChart } from "@/components/charts";
import { LiveUpdates } from "@/components/live-updates";
import { getSeniorDashboard, localDate, type Alert, type MetricType, type SeniorDashboard, type Threshold } from "@/lib/data";
import { ageFrom, formatDayTime, formatTime, minutesToHours, timeAgo, unitLabel, weekday } from "@/lib/format";
import { getCurrentCaregiver } from "@/lib/session";

export const metadata: Metadata = { title: "Daily chart: KinCare" };

// A reading older than this means the phone has stopped sending, not that all is well
const STALE_AFTER_MINUTES = 15;

type Status = { tone: "ok" | "warning" | "critical"; text: string } | null;

function statusFor(value: number, t: Threshold | undefined): Status {
  if (!t) return null;
  const tone = t.severity === "critical" ? "critical" : "warning";
  if (t.max !== null && value > t.max) return { tone, text: `Above safe max of ${t.max}` };
  if (t.min !== null && value < t.min) return { tone, text: `Below safe min of ${t.min}` };
  return { tone: "ok", text: "In safe range" };
}

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  const styles = {
    ok: "text-care-strong",
    warning: "text-marigold",
    critical: "text-rose",
  }[status.tone];
  return (
    <p className={`mt-2 flex items-center gap-1.5 text-sm font-bold ${styles}`}>
      <span
        aria-hidden
        className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
          status.tone === "ok" ? "bg-mist" : status.tone === "warning" ? "bg-marigold-tint" : "bg-rose-tint"
        }`}
      >
        {status.tone === "ok" ? "✓" : "!"}
      </span>
      {status.text}
    </p>
  );
}

function Tile({
  label,
  value,
  unit,
  detail,
  status = null,
}: {
  label: string;
  value: string | null;
  unit?: string;
  detail?: string;
  status?: Status;
}) {
  const alarming = status && status.tone !== "ok";
  return (
    <div
      className={`rounded-2xl border-2 bg-surface px-5 py-4 ${
        alarming ? (status.tone === "critical" ? "border-rose" : "border-marigold") : "border-line"
      }`}
    >
      <p className="text-ink-soft">{label}</p>
      {value === null ? (
        <p className="mt-1 text-lg text-ink-soft">No readings yet</p>
      ) : (
        <>
          <p className="mt-1 text-3xl font-bold tabular-nums">
            {value}
            {unit && <span className="ml-1 text-lg font-normal text-ink-soft">{unit}</span>}
          </p>
          {detail && <p className="text-sm text-ink-soft">{detail}</p>}
          <StatusLine status={status} />
        </>
      )}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <h2 className="text-2xl font-bold">{title}</h2>
      {note && <p className="mt-1 text-ink-soft">{note}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function AlertRow({ alert, tz, open }: { alert: Alert; tz: string; open: boolean }) {
  const critical = alert.severity === "critical";
  return (
    <li
      className={`flex flex-col gap-3 rounded-xl px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${
        open ? (critical ? "bg-rose-tint" : "bg-marigold-tint") : "bg-paper"
      }`}
    >
      <div>
        <p className="font-bold">
          <span className={critical ? "text-rose" : "text-marigold"}>
            {critical ? "Urgent" : alert.severity === "warning" ? "Check soon" : "For information"}
          </span>
          <span className="font-normal text-ink-soft">, {formatDayTime(alert.triggered_at, tz)}</span>
        </p>
        <p className="mt-1 text-lg">{alert.message}</p>
        {!open && alert.acknowledged_at && (
          <p className="mt-1 text-sm text-ink-soft">
            Seen by {alert.acknowledged_by_name ?? "a family member"} at {formatDayTime(alert.acknowledged_at, tz)}
          </p>
        )}
      </div>
      {open && (
        <form action={markAlertSeen}>
          <input type="hidden" name="alertId" value={alert.id} />
          <button
            type="submit"
            className="rounded-full bg-care px-5 py-2.5 font-bold whitespace-nowrap text-on-care hover:bg-care-strong"
          >
            Mark as seen
          </button>
        </form>
      )}
    </li>
  );
}

function fmt(value: number, metric: MetricType) {
  const decimals = metric === "body_temperature" || metric === "weight" || metric === "blood_glucose" ? 1 : 0;
  return value.toFixed(decimals);
}

function Dashboard({ d }: { d: SeniorDashboard }) {
  const tz = d.senior.timezone;
  const now = d.now;
  const age = ageFrom(d.senior.date_of_birth, new Date(now));
  const firstName = d.senior.full_name.split(" ")[0];
  const stale =
    !d.lastSyncAt || now - new Date(d.lastSyncAt).getTime() > STALE_AFTER_MINUTES * 60_000;

  const metricTile = (metric: MetricType, label: string) => {
    const m = d.latest[metric];
    return (
      <Tile
        label={label}
        value={m ? fmt(m.value, metric) : null}
        unit={m ? unitLabel(m.unit) : undefined}
        detail={m ? timeAgo(m.recorded_at, now) : undefined}
        status={m ? statusFor(m.value, d.thresholds[metric]) : null}
      />
    );
  };

  const bp = d.latestBloodPressure;
  const bpStatus = bp
    ? [statusFor(bp.systolic, d.thresholds.blood_pressure_systolic), statusFor(bp.diastolic, d.thresholds.blood_pressure_diastolic)].find(
        (s) => s && s.tone !== "ok",
      ) ?? statusFor(bp.systolic, d.thresholds.blood_pressure_systolic)
    : null;

  const today = localDate(new Date(now), tz);
  const stepsToday = d.stepsByDay.at(-1)?.steps ?? 0;
  const lastNight = d.sleep.at(-1);
  const sleptLastNight = lastNight && lastNight.night === today ? lastNight : null;
  const hr = d.thresholds.heart_rate;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/dashboard" className="text-ink-soft underline underline-offset-4 hover:text-ink">
            Everyone you look after
          </Link>
          <h1 className="mt-2 text-4xl font-bold sm:text-5xl">{d.senior.full_name}</h1>
          <p className="mt-2 text-lg text-ink-soft">
            {[age && `${age} years old`, `${formatTime(new Date(now).toISOString(), tz)} where ${firstName} is`].filter(Boolean).join(", ")}
          </p>
        </div>
        <p
          className={`rounded-full px-4 py-2 font-bold ${stale ? "bg-marigold-tint text-marigold" : "bg-mist text-care-strong"}`}
        >
          {d.lastSyncAt ? `Last update ${timeAgo(d.lastSyncAt, now)}` : "Never synced"}
        </p>
      </div>

      {stale && (
        <p className="rounded-2xl border-2 border-marigold bg-marigold-tint px-5 py-4 text-lg">
          <strong>No new readings from {firstName}&apos;s watch recently.</strong> Quiet data
          doesn&apos;t mean all is well. Check that the phone is charged and online, or give{" "}
          {firstName} a call.
        </p>
      )}

      {d.openAlerts.length > 0 ? (
        <section aria-labelledby="open-alerts">
          <h2 id="open-alerts" className="text-2xl font-bold">
            {d.openAlerts.length === 1 ? "1 alert needs a look" : `${d.openAlerts.length} alerts need a look`}
          </h2>
          <ul className="mt-4 flex flex-col gap-3">
            {d.openAlerts.map((a) => (
              <AlertRow key={a.id} alert={a} tz={tz} open />
            ))}
          </ul>
        </section>
      ) : (
        <p className="flex items-center gap-3 rounded-2xl bg-mist px-5 py-4 text-lg">
          <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full bg-care text-on-care">
            ✓
          </span>
          No open alerts. Every reading is within {firstName}&apos;s safe range, or has been seen.
        </p>
      )}

      <section aria-label="Latest readings" className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-4">
        {metricTile("heart_rate", "Heart rate")}
        {metricTile("spo2", "Blood oxygen")}
        <Tile
          label="Blood pressure"
          value={bp ? `${bp.systolic}/${bp.diastolic}` : null}
          unit="mmHg"
          detail={bp ? timeAgo(bp.recorded_at, now) : undefined}
          status={bpStatus}
        />
        {metricTile("body_temperature", "Temperature")}
        {metricTile("blood_glucose", "Blood glucose")}
        <Tile label="Steps today" value={stepsToday.toLocaleString()} detail="So far, since midnight" />
        <Tile
          label="Sleep last night"
          value={sleptLastNight ? minutesToHours(sleptLastNight.total) : null}
          detail={sleptLastNight ? `${minutesToHours(sleptLastNight.deep)} deep sleep` : undefined}
        />
        {metricTile("weight", "Weight")}
      </section>

      <Section
        title="Heart rate, last 24 hours"
        note="The line is the hourly average. The shaded band shows the lowest and highest reading in each hour."
      >
        {d.heartRateByHour.length > 1 ? (
          <HeartRateChart
            safeMin={hr?.min ?? null}
            safeMax={hr?.max ?? null}
            data={d.heartRateByHour.map((p) => ({
              ...p,
              label: new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric" }).format(new Date(p.hour)),
            }))}
          />
        ) : (
          <p className="text-lg text-ink-soft">No heart rate readings in the last 24 hours.</p>
        )}
      </Section>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Steps, last 7 days" note="Today's bar fills in as the day goes on.">
          <BarChart
            ariaLabel="Steps per day for the last 7 days"
            data={d.stepsByDay.map((s) => ({
              key: s.date,
              label: s.date === today ? "Today" : weekday(s.date),
              value: s.steps,
              tooltip: `${s.date === today ? "Today" : weekday(s.date)}: ${s.steps.toLocaleString()} steps`,
            }))}
          />
        </Section>
        <Section title="Sleep, last 7 nights" note="Nights under 6 hours are shown in amber.">
          {d.sleep.length > 0 ? (
            <BarChart
              ariaLabel="Hours of sleep for each of the last 7 nights"
              reference={{ value: 7, label: "7 h" }}
              data={d.sleep.map((s) => ({
                key: s.night,
                label: weekday(s.night),
                value: Math.round((s.total / 60) * 10) / 10,
                flagged: s.total < 360,
                tooltip: `${weekday(s.night)}: ${minutesToHours(s.total)} (${minutesToHours(s.deep)} deep, ${minutesToHours(s.rem)} REM, awake ${minutesToHours(s.awake)})`,
              }))}
            />
          ) : (
            <p className="text-lg text-ink-soft">No sleep recorded yet.</p>
          )}
        </Section>
      </div>

      <Section
        title="Blood pressure, last 7 days"
        note="Each reading runs from the lower number (diastolic) to the upper number (systolic)."
      >
        {d.bloodPressure.length > 0 ? (
          <BloodPressureChart
            maxSystolic={d.thresholds.blood_pressure_systolic?.max ?? null}
            data={d.bloodPressure.map((r) => ({
              key: r.recorded_at,
              label: weekday(localDate(r.recorded_at, tz)),
              systolic: r.systolic,
              diastolic: r.diastolic,
              tooltip: `${formatDayTime(r.recorded_at, tz)}: ${r.systolic}/${r.diastolic} mmHg`,
            }))}
          />
        ) : (
          <p className="text-lg text-ink-soft">No blood pressure readings this week.</p>
        )}
      </Section>

      {d.recentAlerts.length > 0 && (
        <Section title="Earlier alerts">
          <ul className="flex flex-col gap-3">
            {d.recentAlerts.map((a) => (
              <AlertRow key={a.id} alert={a} tz={tz} open={false} />
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

async function SeniorDashboard({ params }: { params: Promise<{ seniorId: string }> }) {
  const [{ seniorId }, caregiver] = await Promise.all([params, getCurrentCaregiver()]);
  const data = await getSeniorDashboard(caregiver.id, seniorId);
  if (!data) notFound();
  return (
    <>
      <LiveUpdates />
      <Dashboard d={data} />
    </>
  );
}

export default function SeniorPage({ params }: PageProps<"/dashboard/[seniorId]">) {
  return (
    <Suspense fallback={<p className="text-lg text-ink-soft">Loading today&apos;s readings…</p>}>
      <SeniorDashboard params={params} />
    </Suspense>
  );
}
