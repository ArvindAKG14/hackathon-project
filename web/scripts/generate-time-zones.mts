// Writes src/lib/time-zones.ts: the time zone choices for the care recipient
// form's dropdown.
//
//   npm run gen:timezones
//
// Each distinct time zone appears once, not once per city: Tijuana keeps the
// same clock as Los Angeles, so it is not a separate choice. Two zones count
// as the same when their UTC offsets match in both January and July, which
// keeps the southern hemisphere apart (Santiago and Halifax share offsets but
// change clocks in opposite seasons). Their changeover dates can still differ
// by a few weeks.
//
// The list is generated once and committed rather than built in the browser:
// the server and the browser can ship different time zone data, and the
// select would then render differently on each side and fail to hydrate.
// Re-run it when Node's time zone data changes.
import { writeFileSync } from "node:fs";

// The places most users will pick, shown first. Their time zones are left out
// of the rest of the list. Offsets are standard time first, then daylight
// saving time where the zone observes it.
const COMMON = [
  ["America/New_York", "Eastern Time (New York) — UTC−5 / UTC−4 (EST / EDT)"],
  ["America/Chicago", "Central Time (Chicago) — UTC−6 / UTC−5 (CST / CDT)"],
  ["America/Denver", "Mountain Time (Denver) — UTC−7 / UTC−6 (MST / MDT)"],
  ["America/Phoenix", "Arizona (Phoenix) — UTC−7 (MST, no daylight saving)"],
  ["America/Los_Angeles", "Pacific Time (Los Angeles) — UTC−8 / UTC−7 (PST / PDT)"],
  ["America/Anchorage", "Alaska (Anchorage) — UTC−9 / UTC−8 (AKST / AKDT)"],
  ["Pacific/Honolulu", "Hawaii (Honolulu) — UTC−10 (HST)"],
  ["Europe/London", "United Kingdom (London) — UTC+0 / UTC+1 (GMT / BST)"],
  ["Europe/Paris", "Central Europe (Paris) — UTC+1 / UTC+2 (CET / CEST)"],
  ["Asia/Kolkata", "India (Mumbai, Delhi) — UTC+5:30 (IST)"],
  ["Asia/Singapore", "Singapore — UTC+8 (SGT)"],
  ["Asia/Tokyo", "Japan (Tokyo) — UTC+9 (JST)"],
  ["Australia/Sydney", "Australia (Sydney) — UTC+10 / UTC+11 (AEST / AEDT)"],
] as const;

// Well-known places, best known first. Each time zone is stored as the first
// of these it contains and labelled with up to EXAMPLES of them; a zone with
// none falls back to its alphabetically first city.
const FAMOUS = [
  "Asia/Shanghai", "America/Sao_Paulo", "Asia/Jakarta", "Asia/Karachi", "Africa/Lagos",
  "Asia/Dhaka", "Europe/Moscow", "America/Mexico_City", "Africa/Cairo", "Asia/Manila",
  "Asia/Ho_Chi_Minh", "Asia/Tehran", "Europe/Istanbul", "Asia/Bangkok", "Asia/Seoul",
  "Africa/Kinshasa", "America/Bogota", "America/Lima", "Asia/Riyadh", "Africa/Johannesburg",
  "Africa/Nairobi", "America/Argentina/Buenos_Aires", "Asia/Dubai", "Asia/Baghdad",
  "America/Santiago", "America/Caracas", "Europe/Athens", "Europe/Kyiv", "Asia/Jerusalem",
  "Africa/Casablanca", "Africa/Algiers", "Africa/Accra", "Africa/Abidjan", "Atlantic/Reykjavik",
  "Asia/Tashkent", "Asia/Almaty", "Asia/Yekaterinburg", "Asia/Kabul", "Asia/Kathmandu",
  "Asia/Yangon", "Asia/Hong_Kong", "Australia/Perth", "Australia/Brisbane", "Australia/Adelaide",
  "Australia/Darwin", "Pacific/Auckland", "Pacific/Fiji", "Pacific/Guam", "Asia/Vladivostok",
  "Asia/Magadan", "Asia/Kamchatka", "America/Halifax", "America/St_Johns", "America/Puerto_Rico",
  "America/Santo_Domingo", "America/La_Paz", "America/Manaus", "America/Montevideo",
  "America/Guatemala", "America/Costa_Rica", "America/Panama", "America/Havana",
  "America/Nuuk", "America/Noronha", "Atlantic/Azores", "Atlantic/Cape_Verde", "Asia/Baku",
  "Asia/Tbilisi", "Asia/Yerevan", "Asia/Omsk", "Asia/Krasnoyarsk", "Africa/Harare",
  "Africa/Addis_Ababa", "Pacific/Tongatapu", "Pacific/Apia", "Pacific/Pago_Pago",
  "Pacific/Noumea", "Pacific/Port_Moresby", "Pacific/Tahiti", "Pacific/Kiritimati",
];
const EXAMPLES = 3;

// Intl lists some zones under the names CLDR froze years ago. Store and show
// the current IANA name instead, so users see Kolkata, not Calcutta.
const CURRENT_NAMES: Record<string, string> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Coral_Harbour": "America/Atikokan",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};

const JANUARY = new Date("2026-01-15T12:00:00Z");
const JULY = new Date("2026-07-15T12:00:00Z");

// Abbreviations like BST or AEST only appear in the locale that uses them;
// en-US alone calls London's summer time "GMT+1". The first locale that has
// a real name for the zone wins.
const LOCALES = ["en-US", "en-CA", "en-GB", "en-IE", "en-AU", "en-NZ", "en-IN", "en-SG", "en-ZA"];

function zoneName(timeZone: string, at: Date, locale: string, style: "short" | "shortOffset") {
  return new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: style })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")!.value;
}

/** Minutes east of UTC: "GMT-5" -> -300, "GMT" -> 0. */
function offsetMinutes(timeZone: string, at: Date) {
  const raw = zoneName(timeZone, at, "en-US", "shortOffset");
  const m = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(raw);
  if (!m) throw new Error(`Unexpected offset "${raw}" for ${timeZone}`);
  return m[1] ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}

/** -330 -> "UTC−5:30" */
function offsetLabel(minutes: number) {
  const abs = Math.abs(minutes);
  const mins = abs % 60;
  return `UTC${minutes < 0 ? "−" : "+"}${Math.floor(abs / 60)}${mins ? `:${String(mins).padStart(2, "0")}` : ""}`;
}

const isRealName = (name: string) => !/^(GMT|UTC)[+-]/.test(name);

function abbreviations(timeZone: string, dates: Date[]): string[] {
  for (const locale of LOCALES) {
    const names = dates.map((d) => zoneName(timeZone, d, locale, "short"));
    if (names.every(isRealName)) return names;
  }
  return [];
}

// IANA ids are ASCII without punctuation; these read better spelled properly.
const CITY_NAMES: Record<string, string> = {
  "America/Bogota": "Bogotá",
  "America/Sao_Paulo": "São Paulo",
  "America/St_Johns": "St. John's",
  "Asia/Ho_Chi_Minh": "Ho Chi Minh City",
};

/** "America/Argentina/Buenos_Aires" -> "Buenos Aires" */
const city = (timeZone: string) => CITY_NAMES[timeZone] ?? timeZone.split("/").at(-1)!.replaceAll("_", " ");

const key = (timeZone: string) => `${offsetMinutes(timeZone, JANUARY)}|${offsetMinutes(timeZone, JULY)}`;

const zonesByKey = new Map<string, string[]>();
for (const listed of Intl.supportedValuesOf("timeZone")) {
  const timeZone = CURRENT_NAMES[listed] ?? listed;
  const k = key(timeZone);
  zonesByKey.set(k, [...(zonesByKey.get(k) ?? []), timeZone]);
}

const commonKeys = new Set(COMMON.map(([timeZone]) => key(timeZone)));
const rank = (timeZone: string) => {
  const i = FAMOUS.indexOf(timeZone);
  return i === -1 ? FAMOUS.length : i;
};

const others = [...zonesByKey.entries()]
  .filter(([k]) => !commonKeys.has(k))
  .map(([, zones]) => {
    const ordered = zones.toSorted((a, b) => rank(a) - rank(b) || city(a).localeCompare(city(b)));
    const value = ordered[0]!;
    const [standard, summer] = [offsetMinutes(value, JANUARY), offsetMinutes(value, JULY)].sort((a, b) => a - b) as [number, number];
    const observesDst = standard !== summer;

    // Abbreviations in the same order as the offsets: standard, then summer.
    const standardDate = offsetMinutes(value, JANUARY) === standard ? JANUARY : JULY;
    const summerDate = standardDate === JANUARY ? JULY : JANUARY;
    const names = abbreviations(value, observesDst ? [standardDate, summerDate] : [standardDate]);

    const offsets = observesDst ? `${offsetLabel(standard)} / ${offsetLabel(summer)}` : offsetLabel(standard);
    const named = names.length > 0 ? ` (${names.join(" / ")})` : "";
    const examples = ordered.slice(0, EXAMPLES).map(city).join(", ");
    return { value, label: `${offsets}${named} — ${examples}`, standard, summer };
  })
  .sort((a, b) => a.standard - b.standard || a.summer - b.summer);

const entry = ([value, label]: readonly [string, string]) => `  [${JSON.stringify(value)}, ${JSON.stringify(label)}],`;

const file = `// Generated by scripts/generate-time-zones.mts (npm run gen:timezones). Do not edit by hand.
// [IANA name, label] pairs. Where a zone has daylight saving time, the standard offset comes first.

/** The places most users will pick. */
export const COMMON_TIME_ZONES: readonly (readonly [string, string])[] = [
${COMMON.map(entry).join("\n")}
];

/** Every other time zone, once each, from UTC−11 to UTC+14. */
export const OTHER_TIME_ZONES: readonly (readonly [string, string])[] = [
${others.map((o) => entry([o.value, o.label])).join("\n")}
];
`;

writeFileSync(new URL("../src/lib/time-zones.ts", import.meta.url), file);
console.log(`Wrote ${COMMON.length} common and ${others.length} other time zones.`);
