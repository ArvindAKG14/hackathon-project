// Terminal dashboard: a stand-in for the Next.js dashboard that uses the same HTTP API.
// Usage: npm run dashboard -- --user u2
import { VITALS, worst } from "../services/thresholds.js";
import type { Alert, Reading, Senior, Status, VitalType } from "../types.js";

type SeniorSummary = Senior & { status: Status; latest: Partial<Record<VitalType, Reading>> };

const TREND_LENGTH = 20;
const MAX_ALERTS = 6;
const RETRY_MS = 3000;
const RENDER_MS = 500;

const baseUrl = process.env.API_URL ?? "http://localhost:4000";
const userId = argValue("--user") ?? "u1";

const seniors = new Map<string, SeniorSummary>();
const heartHistory = new Map<string, number[]>();
let alerts: Alert[] = [];
let userName = userId;
let connection: "connecting" | "live" | "offline" = "connecting";
let lastError = "";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- data ----------

async function api<T>(path: string): Promise<T> {
  const res = await fetch(baseUrl + path, { headers: { "x-user-id": userId } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function loadSnapshot(): Promise<void> {
  const me = await api<{ name: string }>("/api/me");
  userName = me.name;

  const list = await api<SeniorSummary[]>("/api/seniors");
  seniors.clear();
  for (const s of list) seniors.set(s.id, s);

  await Promise.all(
    list.map(async (s) => {
      const hr = await api<Reading[]>(`/api/seniors/${s.id}/vitals?type=heart_rate&limit=${TREND_LENGTH}`);
      heartHistory.set(s.id, hr.map((r) => r.value));
    }),
  );

  alerts = await api<Alert[]>(`/api/alerts?limit=${MAX_ALERTS}`);
}

function applyReading(reading: Reading): void {
  const senior = seniors.get(reading.seniorId);
  if (!senior) return;
  senior.latest[reading.type] = reading;
  senior.status = worst(Object.values(senior.latest).map((r) => r.status));
  if (reading.type === "heart_rate") {
    const history = heartHistory.get(senior.id) ?? [];
    history.push(reading.value);
    heartHistory.set(senior.id, history.slice(-TREND_LENGTH));
  }
}

function applyAlert(alert: Alert): void {
  alerts = [alert, ...alerts].slice(0, MAX_ALERTS);
}

function handleEvent(raw: string): void {
  let event = "message";
  let data = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice(7);
    else if (line.startsWith("data: ")) data += line.slice(6);
  }
  if (!data) return; // heartbeat comment
  if (event === "reading") applyReading(JSON.parse(data) as Reading);
  else if (event === "alert") applyAlert(JSON.parse(data) as Alert);
}

async function readEvents(res: Response): Promise<void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      handleEvent(buffer.slice(0, end));
      buffer = buffer.slice(end + 2);
    }
  }
}

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const code = (err.cause as { code?: string } | undefined)?.code;
  return code ? `${err.message} (${code})` : err.message;
}

async function connect(): Promise<never> {
  for (;;) {
    try {
      connection = "connecting";
      await loadSnapshot();
      const res = await fetch(`${baseUrl}/api/stream`, { headers: { "x-user-id": userId } });
      if (!res.ok || !res.body) throw new Error(`stream failed: ${res.status}`);
      connection = "live";
      lastError = "";
      await readEvents(res);
      lastError = "stream closed";
    } catch (err) {
      lastError = describeError(err);
    }
    connection = "offline";
    await delay(RETRY_MS);
  }
}

// ---------- rendering ----------

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};
const STATUS_COLOR: Record<Status, string> = { normal: ANSI.green, warning: ANSI.yellow, critical: ANSI.red };

const paint = (text: string, color: string) => `${color}${text}${ANSI.reset}`;
const cell = (text: string, width: number, color = "") => {
  const padded = text.padEnd(width);
  return color ? paint(padded, color) : padded;
};

const COLUMNS: [string, number][] = [
  ["SENIOR", 20],
  ["STATUS", 10],
  ["HEART", 10],
  ["BLOOD PRESSURE", 16],
  ["SpO₂", 7],
  ["TEMP", 9],
  ["GLUCOSE", 11],
  ["HEART TREND", TREND_LENGTH],
];
const width = (i: number) => COLUMNS[i]![1];

function vitalCell(senior: SeniorSummary, type: VitalType, col: number): string {
  const r = senior.latest[type];
  if (!r) return cell("—", width(col), ANSI.dim);
  return cell(`${r.value.toFixed(VITALS[type].decimals)} ${r.unit}`, width(col), STATUS_COLOR[r.status]);
}

function bloodPressureCell(senior: SeniorSummary, col: number): string {
  const sys = senior.latest.bp_systolic;
  const dia = senior.latest.bp_diastolic;
  if (!sys || !dia) return cell("—", width(col), ANSI.dim);
  return cell(`${sys.value}/${dia.value} mmHg`, width(col), STATUS_COLOR[worst([sys.status, dia.status])]);
}

function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const blocks = "▁▂▃▄▅▆▇█";
  const min = Math.min(...values);
  const range = Math.max(...values) - min || 1;
  return values.map((v) => blocks[Math.round(((v - min) / range) * (blocks.length - 1))]).join("");
}

function render(): void {
  const lines: string[] = [];
  const status =
    connection === "live"
      ? paint("● live", ANSI.green)
      : connection === "connecting"
        ? paint("◌ connecting…", ANSI.yellow)
        : paint(`○ offline — ${lastError} (retrying)`, ANSI.red);

  lines.push(
    `${paint("SENIOR HEALTH MONITOR", ANSI.bold + ANSI.cyan)}   ${paint(`viewing as ${userName}`, ANSI.dim)}   ` +
      `${new Date().toLocaleTimeString()}   ${status}`,
  );
  lines.push("");
  lines.push(paint(COLUMNS.map(([title, w]) => title.padEnd(w)).join(" "), ANSI.dim));

  for (const s of seniors.values()) {
    lines.push(
      [
        cell(`${s.name} (${s.age})`, width(0), ANSI.bold),
        cell(s.status.toUpperCase(), width(1), STATUS_COLOR[s.status]),
        vitalCell(s, "heart_rate", 2),
        bloodPressureCell(s, 3),
        vitalCell(s, "spo2", 4),
        vitalCell(s, "temperature", 5),
        vitalCell(s, "glucose", 6),
        paint(sparkline(heartHistory.get(s.id) ?? []), ANSI.cyan),
      ].join(" "),
    );
  }
  if (seniors.size === 0) lines.push(paint("No seniors shared with this user yet.", ANSI.dim));

  lines.push("");
  lines.push(paint("RECENT ALERTS", ANSI.bold));
  for (const a of alerts) {
    const who = seniors.get(a.seniorId)?.name ?? a.seniorId;
    const ack = a.acknowledgedAt ? paint(" (acknowledged)", ANSI.dim) : "";
    lines.push(
      `${new Date(a.createdAt).toLocaleTimeString().padEnd(12)}${cell(a.status.toUpperCase(), 10, STATUS_COLOR[a.status])}` +
        `${who.padEnd(16)}${a.message}${ack}`,
    );
  }
  if (alerts.length === 0) lines.push(paint("No alerts yet.", ANSI.dim));

  lines.push("");
  lines.push(paint(`API ${baseUrl} · Ctrl+C to quit`, ANSI.dim));

  // Redraw in place (clear each line's tail, then everything below) to avoid flicker.
  process.stdout.write(`\x1b[H${lines.map((l) => `${l}\x1b[K`).join("\n")}\n\x1b[J`);
}

process.on("SIGINT", () => {
  process.stdout.write("\x1b[?25h\n");
  process.exit(0);
});

process.stdout.write("\x1b[2J\x1b[?25l");
setInterval(render, RENDER_MS);
render();
void connect();
