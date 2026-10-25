"use client";

import { useActionState, useState, type ReactNode } from "react";
import { addCareRecipient, type AddRecipientState } from "@/app/actions";
import { COMMON_TIME_ZONES, OTHER_TIME_ZONES } from "@/lib/time-zones";

// Everything a caregiver types in when adding a care recipient. The fields
// follow the tables a new senior needs: users (profile), caregiver_links
// (relationship), measurements (starting weight and height) and
// alert_thresholds (safe ranges). addCareRecipient writes all of them in one
// transaction and redirects to the new senior's dashboard.

// Stored as the caregiver's relation to the senior, lowercase, as in db/seed.sql.
const RELATIONSHIPS = [
  ["son", "Son"],
  ["daughter", "Daughter"],
  ["grandchild", "Grandchild"],
  ["spouse", "Spouse or partner"],
  ["sibling", "Brother or sister"],
  ["relative", "Other relative"],
  ["friend", "Friend or neighbour"],
  ["professional", "Professional caregiver"],
] as const;

// The dashboard's safe ranges, prefilled with the seed data's values. A blank
// bound means no limit on that side, as alert_thresholds allows.
const SAFE_RANGES = [
  { metric: "heart_rate", label: "Heart rate", unit: "bpm", min: "50", max: "120" },
  { metric: "spo2", label: "Blood oxygen", unit: "%", min: "92", max: "" },
  { metric: "body_temperature", label: "Temperature", unit: "°C", min: "35.5", max: "38", step: "0.1" },
  { metric: "blood_pressure_systolic", label: "Blood pressure, upper number", unit: "mmHg", min: "", max: "145" },
  { metric: "blood_pressure_diastolic", label: "Blood pressure, lower number", unit: "mmHg", min: "", max: "95" },
  { metric: "blood_glucose", label: "Blood glucose", unit: "mg/dL", min: "70", max: "180" },
];

const control = "rounded-xl border-2 border-line bg-surface px-4 py-3 text-lg outline-none focus:border-care";
const input = `w-full ${control}`;
// Beside a number: the number takes the space, the unit keeps its own width.
const numberInput = `min-w-0 flex-1 ${control}`;
const unitSelect = `shrink-0 ${control}`;

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-lg font-bold">
        {label}
        {required ? <span className="text-rose"> *</span> : <span className="font-normal text-ink-soft"> (optional)</span>}
      </span>
      {hint && <span className="-mt-1 text-ink-soft">{hint}</span>}
      {children}
    </label>
  );
}

/** A number with a unit picker beside it: several controls, so a group rather than a <label>. */
function Measurement({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-2">
      <span id={id} className="text-lg font-bold">
        {label}
        <span className="font-normal text-ink-soft"> (optional)</span>
      </span>
      {hint && <span className="-mt-1 text-ink-soft">{hint}</span>}
      <div className="flex gap-3">{children}</div>
    </div>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-5 rounded-2xl border-2 border-line bg-surface px-5 py-6 sm:px-6">
      <legend className="px-2 text-2xl font-bold">{title}</legend>
      {note && <p className="-mt-2 text-ink-soft">{note}</p>}
      {children}
    </fieldset>
  );
}

const INITIAL: AddRecipientState = { status: "idle", message: "" };

export function CareRecipientForm() {
  const [state, action, pending] = useActionState(addCareRecipient, INITIAL);
  const [weightUnit, setWeightUnit] = useState<"kg" | "lb">("kg");
  const [heightUnit, setHeightUnit] = useState<"cm" | "ft_in">("cm");

  return (
    <form action={action} className="flex flex-col gap-8">
      <Group title="About them">
        <Field label="Full name" required>
          <input name="full_name" type="text" required autoComplete="off" className={input} />
        </Field>
        <Field label="Date of birth">
          <input name="date_of_birth" type="date" min="1900-01-02" className={input} />
        </Field>
        <Measurement id="weight-label" label="Weight" hint="A starting point until a smart scale sends readings.">
          <input
            name="weight"
            type="number"
            inputMode="decimal"
            step="0.1"
            min={weightUnit === "kg" ? 20 : 44}
            max={weightUnit === "kg" ? 300 : 660}
            aria-label={`Weight in ${weightUnit === "kg" ? "kilograms" : "pounds"}`}
            className={numberInput}
          />
          <select
            name="weight_unit"
            value={weightUnit}
            onChange={(e) => setWeightUnit(e.target.value as "kg" | "lb")}
            aria-label="Weight unit"
            className={unitSelect}
          >
            <option value="kg">kg</option>
            <option value="lb">lb</option>
          </select>
        </Measurement>
        <Measurement id="height-label" label="Height">
          {heightUnit === "cm" ? (
            <input
              key="cm"
              name="height_cm"
              type="number"
              inputMode="decimal"
              min={100}
              max={250}
              aria-label="Height in centimetres"
              className={numberInput}
            />
          ) : (
            <>
              <input
                key="ft"
                name="height_ft"
                type="number"
                inputMode="numeric"
                min={3}
                max={8}
                placeholder="ft"
                aria-label="Height, feet"
                className={numberInput}
              />
              <input
                key="in"
                name="height_in"
                type="number"
                inputMode="numeric"
                min={0}
                max={11}
                placeholder="in"
                aria-label="Height, inches"
                className={numberInput}
              />
            </>
          )}
          <select
            name="height_unit"
            value={heightUnit}
            onChange={(e) => setHeightUnit(e.target.value as "cm" | "ft_in")}
            aria-label="Height unit"
            className={unitSelect}
          >
            <option value="cm">cm</option>
            <option value="ft_in">ft &amp; in</option>
          </select>
        </Measurement>
        <Field label="Phone number" hint="So you can call them if their readings look wrong.">
          <input name="phone" type="tel" autoComplete="off" className={input} />
        </Field>
        <Field label="Email address" hint="Only if they want to sign in themselves.">
          <input name="email" type="email" autoComplete="off" className={input} />
        </Field>
        <Field label="Where they live" hint={'Their time zone, so "today" on the dashboard means their today.'} required>
          <select name="timezone" required defaultValue="" className={input}>
            <option value="" disabled>
              Choose a time zone
            </option>
            <optgroup label="Common">
              {COMMON_TIME_ZONES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Other time zones">
              {OTHER_TIME_ZONES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </optgroup>
          </select>
        </Field>
      </Group>

      <Group title="You and them">
        <Field label="You are their…" required>
          <select name="relationship" required defaultValue="" className={input}>
            <option value="" disabled>
              Choose one
            </option>
            {RELATIONSHIPS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </Group>

      <Group
        title="Safe ranges"
        note="You get an alert when a reading falls outside these. Typical values are filled in: check them with their doctor. Leave a box empty for no limit."
      >
        {SAFE_RANGES.map((r) => (
          <div key={r.metric} className="flex flex-col gap-2">
            <span className="text-lg font-bold">
              {r.label} <span className="font-normal text-ink-soft">({r.unit})</span>
            </span>
            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span className="text-ink-soft">Lowest</span>
                <input name={`${r.metric}_min`} type="number" inputMode="decimal" step={r.step ?? "1"} defaultValue={r.min} className={input} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-ink-soft">Highest</span>
                <input name={`${r.metric}_max`} type="number" inputMode="decimal" step={r.step ?? "1"} defaultValue={r.max} className={input} />
              </label>
            </div>
          </div>
        ))}
      </Group>

      <div className="flex flex-col gap-3">
        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-full bg-care px-7 py-3.5 text-lg font-bold text-on-care hover:bg-care-strong disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add care recipient"}
        </button>
        {state.status === "error" && (
          <p role="alert" className="rounded-2xl bg-rose-tint px-5 py-4 text-lg font-bold text-rose">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
