#!/usr/bin/env node
/**
 * Regenerates the subscribable calendar feeds in /calendar.
 *
 * Run it whenever exceptions.json changes, or on a schedule to roll the
 * window forward. The GitHub Action in .github/workflows/build-calendar.yml
 * does both automatically — you shouldn't normally need to run this by hand.
 *
 *   node tools/generate-ics.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---- Schedule config (keep in step with DEFAULTS in app.js) --------------
// Waste & recycling: weekly, alternating
const ANCHOR_ISO = "2026-05-28";
const ANCHOR_TYPE = "general";

// Glass: its own weekday and cycle.
// PLACEHOLDER — set GLASS_ANCHOR_ISO to a real glass collection date.
const GLASS_ENABLED = true;
const GLASS_ANCHOR_ISO = "2026-09-03";
const GLASS_INTERVAL_WEEKS = 4;

const YEARS_AHEAD = 8;
const MONTHS_BEHIND = 1; // keep a little history so recent events don't vanish

// Published alarm variants. Each becomes one .ics file that people can
// subscribe to; they pick the one matching when they want reminding.
const VARIANTS = [
  { file: "bins-1700-day-before.ics", daysBefore: 1, time: "17:00", label: "17:00 the day before" },
  { file: "bins-1900-day-before.ics", daysBefore: 1, time: "19:00", label: "19:00 the day before" },
  { file: "bins-2100-day-before.ics", daysBefore: 1, time: "21:00", label: "21:00 the day before" },
  { file: "bins-0600-same-day.ics",   daysBefore: 0, time: "06:00", label: "06:00 on the day" },
  { file: "bins-0700-same-day.ics",   daysBefore: 0, time: "07:00", label: "07:00 on the day" },
  { file: "bins-no-alarm.ics",        daysBefore: null, time: null,  label: "no alarm" },
];

const TYPES = { general: "General waste", recycling: "Recycling", glass: "Glass" };
const OTHER = { general: "recycling", recycling: "general" };

// ---- Date helpers ---------------------------------------------------------
const atMid = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const dayDiff = (a, b) => Math.round((atMid(a) - atMid(b)) / 86400000);
const pad = (n) => String(n).padStart(2, "0");
const icsDate = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const sameDate = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function fromISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d) ? null : d;
}
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function icsEscape(t) {
  return String(t).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function alarmTrigger(daysBefore, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const minutes = (h * 60 + m) - daysBefore * 1440;
  if (minutes === 0) return "PT0S";
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(minutes);
  const hrs = Math.floor(abs / 60), mins = abs % 60;
  let dur = "PT";
  if (hrs) dur += `${hrs}H`;
  if (mins) dur += `${mins}M`;
  return sign + dur;
}

// ---- Load central holiday adjustments -------------------------------------
const exceptionsRaw = JSON.parse(readFileSync(resolve(ROOT, "exceptions.json"), "utf8"));
const adjustments = new Map();
for (const item of exceptionsRaw.adjustments || []) {
  const scheduled = fromISO(item && item.scheduled);
  if (!scheduled) continue;
  // Entries without a stream apply to waste, so older files still work.
  const stream = item.stream === "glass" ? "glass" : "waste";
  adjustments.set(`${stream}:${toISO(scheduled)}`, {
    actual: fromISO(item.actual),
    cancelled: item.cancelled === true,
    type: TYPES[item.type] ? item.type : null,
    reason: typeof item.reason === "string" ? item.reason : "",
  });
}

// ---- Build the collection list --------------------------------------------
const anchor = fromISO(ANCHOR_ISO);
const glassAnchor = fromISO(GLASS_ANCHOR_ISO);
const now = new Date();
const windowStart = addDays(atMid(now), -MONTHS_BEHIND * 30);
const windowEnd = addDays(atMid(now), YEARS_AHEAD * 365);
const floorDiv = (a, b) => Math.floor(a / b);

const raw = [];

// Waste & recycling — weekly, alternating
for (let k = Math.ceil(dayDiff(windowStart, anchor) / 7); k <= floorDiv(dayDiff(windowEnd, anchor), 7); k++) {
  const parity = ((k % 2) + 2) % 2;
  raw.push({
    stream: "waste",
    date: addDays(anchor, k * 7),
    typeKey: parity === 0 ? ANCHOR_TYPE : OTHER[ANCHOR_TYPE],
  });
}

// Glass — its own interval
if (GLASS_ENABLED) {
  const step = GLASS_INTERVAL_WEEKS * 7;
  for (let k = Math.ceil(dayDiff(windowStart, glassAnchor) / step); k <= floorDiv(dayDiff(windowEnd, glassAnchor), step); k++) {
    raw.push({ stream: "glass", date: addDays(glassAnchor, k * step), typeKey: "glass" });
  }
}

// Apply central adjustments, drop cancellations, sort chronologically
const collections = [];
for (const item of raw) {
  const adj = adjustments.get(`${item.stream}:${toISO(item.date)}`);
  if (adj && adj.cancelled) continue;
  if (!adj) {
    collections.push({ ...item, scheduledDate: item.date, moved: false, reason: "" });
    continue;
  }
  collections.push({
    stream: item.stream,
    typeKey: adj.type || item.typeKey,
    date: adj.actual || item.date,
    scheduledDate: item.date,
    moved: !!adj.actual && !sameDate(adj.actual, item.date),
    reason: adj.reason,
  });
}
collections.sort((a, b) => a.date - b.date || a.stream.localeCompare(b.stream));

// ---- Emit one feed per alarm variant ---------------------------------------
const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
mkdirSync(resolve(ROOT, "calendar"), { recursive: true });

for (const v of VARIANTS) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Normandy Mead//Waste Collection//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:Bin collections (${icsEscape(v.label)})`,
    "X-WR-CALDESC:Normandy Mead waste collection schedule",
    // Hints to subscribing clients about how often to re-fetch.
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];

  for (const c of collections) {
    const name = TYPES[c.typeKey];
    const desc = c.moved
      ? `Moved from ${toISO(c.scheduledDate)}${c.reason ? ` - ${icsEscape(c.reason)}` : ""}`
      : (c.reason ? icsEscape(c.reason) : `${icsEscape(name)} collection`);

    lines.push(
      "BEGIN:VEVENT",
      // Stable UID: re-subscribing or re-importing updates in place rather
      // than duplicating, and a moved date edits the existing entry.
      `UID:nm-${c.stream}-${icsDate(c.scheduledDate)}@normandy-mead`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(c.date)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(c.date, 1))}`,
      `SUMMARY:${icsEscape(name)} collection`,
      `DESCRIPTION:${desc}`,
      "TRANSP:TRANSPARENT"
    );

    if (v.daysBefore !== null) {
      lines.push(
        "BEGIN:VALARM",
        `TRIGGER:${alarmTrigger(v.daysBefore, v.time)}`,
        "ACTION:DISPLAY",
        `DESCRIPTION:${icsEscape("Put out the " + name.toLowerCase() + " bin")}`,
        "END:VALARM"
      );
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  writeFileSync(resolve(ROOT, "calendar", v.file), lines.join("\r\n") + "\r\n", "utf8");
  console.log(`wrote calendar/${v.file}  (${collections.length} events, ${v.label})`);
}

console.log(`\nWindow: ${toISO(collections[0].date)} → ${toISO(collections[collections.length - 1].date)}`);
console.log(`Adjustments applied: ${adjustments.size}`);
