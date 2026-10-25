import "server-only";
import { ConfigError } from "./config-error";

// Shared Gemini plumbing. summary.ts makes one-shot calls; check-in.ts holds
// a conversation. Both go through the same model list so a model change is
// made once.

// Tried in order. Flash models get overloaded on the free tier and answer 503
// or simply hang; without a fallback that would mean no summary for the whole
// day, since the result is cached per day.
//
// Not newest-first. gemini-3.8-flash failed every attempt across half an hour
// of testing, so leading with it buys a guaranteed timeout before falling
// through. For a 60-word plain-language paragraph the model tier makes little
// difference and availability makes all of it, so the reliable one goes first
// and the newer one is the upgrade when it is free.
export const MODELS = ["gemini-3.5-flash", "gemini-3.8-flash"] as const;
export const endpointFor = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// Per model, as in summary.ts. Reasoning comes before every reply, so a
// tighter limit would turn slow answers into failed ones.
const TIMEOUT_MS = 12_000;

export type Turn = { role: "user" | "model"; text: string };

export function geminiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new ConfigError(
      ["GEMINI_API_KEY"],
      "Get one from Google AI Studio and set it server-side. Never prefix it with NEXT_PUBLIC_.",
    );
  }
  return key;
}

async function callModel(
  model: string,
  key: string,
  system: string,
  turns: Turn[],
  options: { temperature: number; json?: object },
): Promise<string> {
  const res = await fetch(`${endpointFor(model)}?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
      generationConfig: {
        temperature: options.temperature,
        // Gemini 3.x spends ~1,500-1,900 tokens reasoning before a short
        // answer, so 2,000 came back MAX_TOKENS; see the note in summary.ts.
        // Only generated tokens are billed, so the headroom is free.
        maxOutputTokens: 6000,
        ...(options.json && { responseMimeType: "application/json", responseSchema: options.json }),
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`${model} ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }

  const body = await res.json();
  const candidate = body?.candidates?.[0];
  if (candidate?.finishReason === "MAX_TOKENS") {
    throw new Error(`${model} hit the token limit before finishing`);
  }

  // Skip reasoning parts (thought: true) so working-out is never shown.
  const parts: { text?: string; thought?: boolean }[] = candidate?.content?.parts ?? [];
  const text = parts
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("")
    .trim();
  if (!text) throw new Error(`${model} returned no text`);
  return text;
}

/** A conversation turn or a structured result, falling through the model list. */
export async function converse(
  system: string,
  turns: Turn[],
  options: { temperature: number; json?: object },
): Promise<{ text: string; model: string }> {
  const key = geminiKey();
  let last: unknown;
  for (const model of MODELS) {
    try {
      return { text: await callModel(model, key, system, turns, options), model };
    } catch (error) {
      last = error;
      console.warn("[gemini]", error instanceof Error ? error.message : error);
    }
  }
  throw last instanceof Error ? last : new Error("All Gemini models failed");
}
