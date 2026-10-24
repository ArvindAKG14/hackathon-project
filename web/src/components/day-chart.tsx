// The hero: one person's day, laid out like the chart clipped to a care-home bed.
// Static sample data for the landing page; the dashboard will read the same shape from Supabase.

const vitals = [
  { label: "Blood pressure", value: "128/82", unit: "mmHg" },
  { label: "Heart rate", value: "71", unit: "bpm" },
  { label: "Oxygen", value: "97", unit: "%" },
  { label: "Temperature", value: "36.8", unit: "°C" },
];

type Dose = "taken" | "missed" | "due";

const week: { day: string; morning: Dose; evening: Dose }[] = [
  { day: "Sat", morning: "taken", evening: "taken" },
  { day: "Sun", morning: "taken", evening: "taken" },
  { day: "Mon", morning: "taken", evening: "taken" },
  { day: "Tue", morning: "taken", evening: "missed" },
  { day: "Wed", morning: "taken", evening: "taken" },
  { day: "Thu", morning: "taken", evening: "taken" },
  { day: "Fri", morning: "taken", evening: "due" },
];

const doseLabel: Record<Dose, string> = {
  taken: "taken",
  missed: "missed",
  due: "due later today",
};

function Compartment({ dose, index }: { dose: Dose; index: number }) {
  const shell =
    dose === "missed"
      ? "bg-marigold-tint border-marigold"
      : dose === "due"
        ? "border-dashed border-ink-soft/60"
        : "bg-mist border-line";
  return (
    <div
      className={`flex aspect-square items-center justify-center rounded-lg border-2 ${shell}`}
    >
      {dose === "taken" && (
        <span
          className="pill-dot block h-[42%] w-[42%] rounded-full bg-care"
          style={{ "--i": index } as React.CSSProperties}
        />
      )}
      {dose === "missed" && (
        <span className="text-sm font-bold text-marigold" aria-hidden>
          !
        </span>
      )}
    </div>
  );
}

export function DayChart() {
  return (
    <figure
      aria-label="Example of a KinCare daily chart for Margaret Chen"
      className="rounded-2xl border border-line bg-surface p-5 shadow-[0_1px_0_var(--line),0_18px_40px_-24px_rgb(29_43_54/0.35)] sm:p-7"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-4">
        <div>
          <p className="text-xl font-bold">Margaret Chen, 77</p>
          <p className="text-ink-soft">Friday 24 October</p>
        </div>
        <p className="rounded-full bg-mist px-3 py-1 text-sm font-bold text-care-strong">
          Updated 2 min ago
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 py-5">
        {vitals.map((v) => (
          <div key={v.label}>
            <dt className="text-sm text-ink-soft">{v.label}</dt>
            <dd className="text-2xl font-bold tabular-nums">
              {v.value}
              <span className="block text-base font-normal text-ink-soft sm:ml-1 sm:inline">
                {v.unit}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      <div className="border-t border-line pt-5">
        <p className="mb-3 font-bold">Medication this week</p>
        <div
          className="grid grid-cols-[auto_repeat(7,minmax(0,1fr))] items-center gap-1.5 sm:gap-2"
          role="table"
          aria-label="Doses taken this week"
        >
          <span role="presentation" />
          {week.map((d) => (
            <span
              key={d.day}
              className="text-center text-xs text-ink-soft sm:text-sm"
              role="columnheader"
            >
              {d.day}
            </span>
          ))}
          {(["morning", "evening"] as const).map((slot, row) => (
            <div key={slot} className="contents" role="row">
              <span className="pr-1 text-xs text-ink-soft sm:text-sm" role="rowheader">
                {slot === "morning" ? "AM" : "PM"}
              </span>
              {week.map((d, col) => (
                <div
                  key={d.day}
                  role="cell"
                  aria-label={`${d.day} ${slot}: ${doseLabel[d[slot]]}`}
                >
                  <Compartment dose={d[slot]} index={row * 7 + col} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-x-6 border-t border-line pt-5">
        <div>
          <p className="text-sm text-ink-soft">Sleep last night</p>
          <p className="text-xl font-bold">7 h 10 min</p>
        </div>
        <div>
          <p className="text-sm text-ink-soft">Steps so far</p>
          <p className="text-xl font-bold tabular-nums">2,140</p>
        </div>
      </div>

      <p className="mt-5 rounded-xl bg-marigold-tint px-4 py-3 text-[0.95rem] leading-snug">
        <strong>Tuesday evening dose was missed.</strong> Priya marked it as
        followed up on Wednesday.
      </p>
    </figure>
  );
}
