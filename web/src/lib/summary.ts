import "server-only";
import { ConfigError } from "./config-error";
import { localDate } from "./data";
import { pg } from "./pg";

// A short plain-language summary of a senior's week, written by Gemini from
// aggregates the dashboard already computes.
//
// The point is translation, not analysis. A caregiver sees a seven-day heart
// rate chart and cannot tell whether to worry; "she slept 40 minutes less than
// usual and her oxygen dipped twice on Tuesday" answers the question they
// actually have.
//
// Deliberately NOT used for alert text. A threshold breach is safety-critical
// and its wording must be deterministic: generated text adds latency to the
// one path that has to be fast, fails when the API does, and could soften a
// warning. Alerts stay templated.

// Tried in order. Flash models get overloaded on the free tier and answer 503
// or simply hang; without a fallback that would mean no summary for the whole
// day, since the result is cached per day.
//
// Not newest-first. gemini-3.8-flash failed every attempt across half an hour
// of testing, so leading with it buys a guaranteed timeout before falling
// through. For a 60-word plain-language paragraph the model tier makes little
// difference and availability makes all of it, so the reliable one goes first
// and the newer one is the upgrade when it is free.
const MODELS = ["gemini-3.5-flash", "gemini-3.8-flash"] as const;
const endpointFor = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
/** The table's CHECK rejects anything longer; fail before writing, not after. */
const MAX_CHARS = 2000;
// Per model, not per request. A hung primary must not eat the whole budget
// before the fallback gets a turn.
const TIMEOUT_MS = 12_000;

export interface SummaryInput {
  firstName: string;
  age: number | null;
  days: {
    date: string;
    steps: number | null;
    sleepMinutes: number | null;
    heartRate: { min: number; avg: number; max: number } | null;
    bloodPressure: { systolic: number; diastolic: number } | null;
  }[];
  alerts: { day: string; message: string }[];
}

const INSTRUCTIONS = `You write one short paragraph for a family member checking on an older relative.

Rules, all of them strict:
- Describe what the numbers show. Never diagnose, never speculate about causes, never give medical advice.
- Never suggest treatment, medication, or that anything is or isn't serious.
- If something looks unusual, say what changed and suggest speaking to their doctor. Nothing more.
- Only use the figures given. Never invent a reading, a trend, or a day that isn't listed.
- Never reassure. Do not say a reading is fine, normal for them, nothing to worry about, or that rest is good for them. A drop in activity can mean illness, and comforting words could stop someone checking on a person who needs help.
- If there isn't enough data to say anything useful, say exactly that in one sentence.
- Lead with what changed from their own usual pattern, not with raw numbers.
- Plain, warm, everyday language. No clinical terms, no bullet points, no headings.
- 60 words or fewer. One paragraph.`;

function buildPrompt(input: SummaryInput): string {
  const lines = input.days.map((d) => {
    const parts = [
      d.steps !== null ? `${d.steps} steps` : null,
      d.sleepMinutes !== null ? `${Math.round((d.sleepMinutes / 60) * 10) / 10} h sleep` : null,
      d.heartRate ? `heart rate ${d.heartRate.min}-${d.heartRate.max} (avg ${d.heartRate.avg})` : null,
      d.bloodPressure ? `BP ${d.bloodPressure.systolic}/${d.bloodPressure.diastolic}` : null,
    ].filter(Boolean);
    return `${d.date}: ${parts.length > 0 ? parts.join(", ") : "no readings"}`;
  });

  const alerts =
    input.alerts.length > 0
      ? input.alerts.map((a) => `${a.day}: ${a.message}`).join("\n")
      : "None.";

  return [
    INSTRUCTIONS,
    "",
    `The person is ${input.firstName}${input.age ? `, aged ${input.age}` : ""}.`,
    "",
    "Last 7 days:",
    ...lines,
    "",
    "Alerts raised:",
    alerts,
  ].join("\n");
}

/** One attempt against one model. Throws so the caller can try the next. */
async function callModel(model: string, prompt: string, key: string): Promise<string> {
  const res = await fetch(`${endpointFor(model)}?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        // Low but not zero: deterministic enough to be consistent between
        // siblings reading the same day, varied enough not to read like a form.
        temperature: 0.3,
        // Generous for a 60-word paragraph because Gemini 3.x spends output
        // budget on internal reasoning first. At 200 the visible answer was
        // cut off mid-sentence after about 90 characters.
        maxOutputTokens: 2000,
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`${model} ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }

  const body = await res.json();
  const candidate = body?.candidates?.[0];

  // A half-written sentence is worse than no summary: it reads like the app
  // broke. Treat it as a failure so the next page load tries again rather
  // than caching the fragment for the rest of the day.
  if (candidate?.finishReason === "MAX_TOKENS") {
    throw new Error(`${model} hit the token limit before finishing`);
  }

  // Gemini 3.x can return reasoning alongside the answer, flagged thought:true.
  // Taking parts[0] blindly would sometimes surface its working-out.
  const parts: { text?: string; thought?: boolean }[] = candidate?.content?.parts ?? [];
  const text = parts
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("")
    .trim();
  if (!text) throw new Error(`${model} returned no text`);

  const trimmed = text;
  if (trimmed.length > MAX_CHARS) {
    throw new Error(`${model} returned ${trimmed.length} chars; expected a paragraph`);
  }
  return trimmed;
}

/** Calls Gemini, falling through the model list. Throws only if all fail. */
async function generate(prompt: string): Promise<{ text: string; model: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new ConfigError(
      ["GEMINI_API_KEY"],
      "Get one from Google AI Studio and set it server-side. Never prefix it with NEXT_PUBLIC_.",
    );
  }

  let last: unknown;
  for (const model of MODELS) {
    try {
      return { text: await callModel(model, prompt, key), model };
    } catch (error) {
      last = error;
      console.warn("[summary]", error instanceof Error ? error.message : error);
    }
  }
  throw last instanceof Error ? last : new Error("All Gemini models failed");
}

/**
 * Seven days of daily aggregates, bucketed by the senior's own local date --
 * their Tuesday, not the server's. One round trip; the date series on the
 * left means a day with no readings still appears, which the model needs in
 * order to notice a gap rather than skip over it.
 */
export async function buildSummaryInput(
  seniorId: string,
  timezone: string,
  firstName: string,
  age: number | null,
): Promise<SummaryInput> {
  const { rows } = await pg().query<{
    day: string;
    steps: number | null;
    sleep_minutes: number | null;
    hr_min: number | null;
    hr_avg: number | null;
    hr_max: number | null;
    systolic: number | null;
    diastolic: number | null;
  }>(
    `WITH d AS (
       SELECT generate_series(((now() AT TIME ZONE $2)::date - 6),
                              ((now() AT TIME ZONE $2)::date),
                              interval '1 day')::date AS day
     ),
     -- Sum within a source, then take the largest source -- never sum across
     -- them. Each device reports the same person's whole day, so a phone
     -- saying 5000 and a watch saying 4800 means they walked about 5000, not
     -- 9800. Margaret has five sources from testing, which made this obvious.
     steps AS (
       SELECT day, max(source_total)::int AS steps
       FROM (
         SELECT (period_start AT TIME ZONE $2)::date AS day,
                data_source_id,
                sum(value) AS source_total
         FROM measurements
         WHERE senior_id = $1 AND metric_type = 'steps' AND period_start IS NOT NULL
           AND period_start > now() - interval '8 days'
         GROUP BY 1, 2
       ) per_source
       GROUP BY day
     ),
     hr AS (
       SELECT (recorded_at AT TIME ZONE $2)::date AS day,
              round(min(value))::int AS hr_min,
              round(avg(value))::int AS hr_avg,
              round(max(value))::int AS hr_max
       FROM measurements
       WHERE senior_id = $1 AND metric_type = 'heart_rate'
         AND recorded_at > now() - interval '8 days'
       GROUP BY 1
     ),
     -- Same reasoning: one night is one night. Two devices both reporting it
     -- is duplication, not extra sleep.
     sleep AS (
       SELECT day, max(source_total)::int AS sleep_minutes
       FROM (
         SELECT (started_at AT TIME ZONE $2)::date AS day,
                data_source_id,
                sum(total_minutes) AS source_total
         FROM sleep_sessions
         WHERE senior_id = $1 AND started_at > now() - interval '8 days'
         GROUP BY 1, 2
       ) per_source
       GROUP BY day
     ),
     bp AS (
       SELECT DISTINCT ON ((recorded_at AT TIME ZONE $2)::date)
              (recorded_at AT TIME ZONE $2)::date AS day, systolic, diastolic
       FROM blood_pressure_readings
       WHERE senior_id = $1 AND recorded_at > now() - interval '8 days'
       ORDER BY (recorded_at AT TIME ZONE $2)::date, recorded_at DESC
     )
     SELECT d.day::text, steps.steps, sleep.sleep_minutes,
            hr.hr_min, hr.hr_avg, hr.hr_max, bp.systolic, bp.diastolic
     FROM d
     LEFT JOIN steps ON steps.day = d.day
     LEFT JOIN hr    ON hr.day    = d.day
     LEFT JOIN sleep ON sleep.day = d.day
     LEFT JOIN bp    ON bp.day    = d.day
     ORDER BY d.day`,
    [seniorId, timezone],
  );

  const alerts = await pg().query<{ day: string; message: string }>(
    `SELECT (triggered_at AT TIME ZONE $2)::date::text AS day, message
     FROM alerts
     WHERE senior_id = $1 AND triggered_at > now() - interval '7 days'
     ORDER BY triggered_at DESC
     LIMIT 10`,
    [seniorId, timezone],
  );

  return {
    firstName,
    age,
    days: rows.map((r) => ({
      date: r.day,
      steps: r.steps,
      sleepMinutes: r.sleep_minutes,
      heartRate:
        r.hr_min !== null && r.hr_avg !== null && r.hr_max !== null
          ? { min: r.hr_min, avg: r.hr_avg, max: r.hr_max }
          : null,
      bloodPressure:
        r.systolic !== null && r.diastolic !== null
          ? { systolic: r.systolic, diastolic: r.diastolic }
          : null,
    })),
    alerts: alerts.rows,
  };
}

/**
 * Today's summary for a senior, generating and caching it on first request.
 *
 * Returns null rather than throwing when generation fails: a missing summary
 * must never take down the dashboard. The readings are the point; this is
 * commentary on them.
 */
export async function getDailySummary(
  seniorId: string,
  timezone: string,
  build: () => Promise<SummaryInput>,
): Promise<string | null> {
  const today = localDate(new Date(), timezone);

  const cached = await pg().query<{ summary: string }>(
    `SELECT summary FROM senior_summaries WHERE senior_id = $1 AND local_date = $2`,
    [seniorId, today],
  );
  if (cached.rows[0]) return cached.rows[0].summary;

  if (!process.env.GEMINI_API_KEY) return null;

  try {
    const input = await build();
    // Nothing to describe: don't spend a request inventing reassurance.
    if (input.days.every((d) => d.steps === null && d.sleepMinutes === null && d.heartRate === null)) {
      return null;
    }

    const { text: summary, model } = await generate(buildPrompt(input));

    // ON CONFLICT DO NOTHING: two caregivers can open the page at once, and
    // whichever request lands first wins. Both then read the same words.
    await pg().query(
      `INSERT INTO senior_summaries (senior_id, local_date, summary, model)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (senior_id, local_date) DO NOTHING`,
      [seniorId, today, summary, model],
    );

    return summary;
  } catch (error) {
    console.error("[summary] generation failed:", error instanceof Error ? error.message : error);
    return null;
  }
}
