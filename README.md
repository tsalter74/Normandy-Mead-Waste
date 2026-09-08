# Normandy Mead Waste Collection Calendar

A small, offline-first PWA showing upcoming bin collections.

- **Recycling** — green
- **General waste** — grey
- **Glass** — blue

Two independent schedules, merged into one list:

| Stream | Cycle |
|---|---|
| Waste & recycling | Weekly, alternating between the two |
| Glass | Its own weekday, every N weeks (default 4) |

Each is anchored to a known collection date. Everything is computed in the
browser, so there is no server or database.

> **⚠️ Set the glass reference date.** The default (`2026-09-03`) is a
> placeholder. Open Settings → Glass and set *Reference date* to a real glass
> collection day, and update `GLASS_ANCHOR_ISO` in `tools/generate-ics.mjs` to
> match so the published calendar feeds agree.

## Using it

- **Today** — jump back to the next upcoming collection.
- **‹ ›** — page backwards/forwards through the schedule, as far as you like.
- **Gear icon** — settings (see below).

## Settings (per device)

| Setting | What it does |
|---|---|
| Weeks to show | Size of the display window (1–12 weeks) |
| Waste: collection day / reference date / type | Anchors the weekly alternating cycle |
| Glass: include, day, interval, reference date | Anchors the glass cycle independently |
| Remind me / At | When the bin reminder should fire (see below) |

The view shows a **window of weeks**, not a fixed number of collections, so the
number of cards varies — a week containing a glass collection shows more.

For each stream the reference date and collection day stay in step
automatically: picking a new date adopts that date's weekday, and changing the
weekday shifts the reference date to the nearest matching day. **Reset to
defaults** restores the original schedule.

These are stored per device, so each household can adjust display preferences
without affecting anyone else.

---

## Bin reminders

Two ways to get a native reminder on your phone, both in **Settings**.

### 1. Subscribe (recommended — self-updating)

**Settings → Subscribe in calendar.** Your calendar app stores the *link*, not a
copy, and re-fetches it periodically. When a holiday adjustment is published,
the change reaches every subscriber automatically. Set up once, then forget.

Published feeds live in `/calendar/`, one per alarm time:

| Feed | Alarm |
|---|---|
| `bins-1700-day-before.ics` | 17:00 the day before |
| `bins-1900-day-before.ics` | 19:00 the day before |
| `bins-2100-day-before.ics` | 21:00 the day before |
| `bins-0600-same-day.ics` | 06:00 on the day |
| `bins-0700-same-day.ics` | 07:00 on the day |
| `bins-no-alarm.ics` | none — calendar entries only |

The app picks the feed matching your chosen reminder and shows the link. Alarm
times are fixed because the alarm is baked into the published file; the settings
panel says whether you have an exact match or the nearest one.

**How to subscribe**

- **iPhone/iPad** — tap *Subscribe in calendar*. iOS opens its subscribe dialog
  via the `webcal://` link. (Or: Settings → Calendar → Accounts → Add Account →
  Other → Add Subscribed Calendar, and paste the link.)
- **Android** — Google Calendar can't add a subscription from the phone app.
  Use *Copy link*, then on a computer go to
  calendar.google.com → Other calendars **+** → **From URL** → paste. It then
  syncs down to the phone.
- **Outlook / Thunderbird / macOS Calendar** — "Add calendar from internet" or
  "New calendar subscription", paste the link.

**Refresh timing, honestly:** the feed asks clients to re-check every 6 hours,
but that's a hint, not a rule. Apple honours it reasonably well and lets you
choose the interval. Google Calendar decides for itself and is often slow —
commonly 12–24 hours, sometimes longer. So publish holiday changes **several
days ahead**, not the night before, and you'll be fine.

### 2. One-off export (exact custom time)

**Settings → One-off export.** Writes the next two years into your calendar
using your exact chosen time. Good if you want, say, 18:30, which no published
feed covers. The trade-off: it's a snapshot, so later holiday changes won't
appear unless you export again. Events carry stable UIDs, so re-exporting
updates in place rather than duplicating.

### Why not in-app notifications?

A PWA can't reliably schedule its own local notifications:

- **Notification Triggers** — the API built for precisely this. Chrome trialled
  it, then shelved it. It never shipped anywhere.
- **Web Push** — works, but needs a server sending each push, which this project
  deliberately doesn't have.
- **Periodic Background Sync** — Chromium-only, and it can't target a time. You
  register an *interval* ("at most every 12 hours") and the browser decides when
  to run you, based on battery, network and how often you open the app. You
  might get woken at 03:00 and 22:00 and never near 17:00. It also won't run at
  all on iOS, in Firefox, or if the app isn't installed.

The calendar route sidesteps all of it: a real OS notification, offline, firing
whether or not the app is installed, identical on iOS and Android.

---

## Keeping the feeds current

`/calendar/*.ics` is generated, not hand-written. Don't edit those files.

`tools/generate-ics.mjs` reads `exceptions.json` and rebuilds every feed. The
GitHub Action in `.github/workflows/build-calendar.yml` runs it automatically:

- on every push touching `exceptions.json`, and
- monthly, to roll the 3-year window forward so subscribers never run out.

So the normal workflow is unchanged — **edit `exceptions.json`, commit, done.**
The feeds rebuild and subscribers pick the change up on their next refresh.

To run it by hand: `node tools/generate-ics.mjs`

One setup step: the Action needs permission to push. In the repo, go to
**Settings → Actions → General → Workflow permissions** and select
**Read and write permissions**.

Note the generator has its own copy of the schedule constants at the top
(`ANCHOR_ISO`, `ANCHOR_TYPE`, `GLASS_ANCHOR_ISO`, `GLASS_INTERVAL_WEEKS`). If you
change the permanent schedule in `app.js`, change it there too — otherwise the
app and the published feeds will disagree.

Feeds are generated **8 years** ahead (`YEARS_AHEAD`). That's deliberate: GitHub
disables scheduled workflows after 60 days of repository inactivity, so a quiet
repo could stop rebuilding. With 8 years published, subscribers have plenty of
runway even if that happens, and any push to `exceptions.json` re-enables and
regenerates immediately.

---

## Holiday adjustments — the important bit

Bank holidays shift collections, and that change must reach **everyone**, not
just whoever noticed. So holiday changes are **not** a per-device setting. They
live in one central file in this repo: **`exceptions.json`**.

### How it works

1. Someone edits `exceptions.json` on GitHub and commits.
2. Every household's app re-reads that file each time it opens (and whenever it
   returns to the foreground).
3. Affected collections show the corrected date with a **MOVED** badge and the
   reason.

No app rebuild, no version bump, no reinstall, no message to the street. One
edit updates everyone.

### Editing it

Open `exceptions.json` on GitHub, click the pencil icon, add entries to the
`adjustments` list, and commit. The file has a full crib sheet at the top, plus
worked examples under `_example` you can copy.

```jsonc
"adjustments": [
  // Moved to a different day
  { "scheduled": "2026-12-24", "actual": "2026-12-23", "reason": "Christmas Eve" },

  // Cancelled outright
  { "scheduled": "2027-01-01", "cancelled": true, "reason": "New Year's Day" },

  // Same day, but the other bin goes out
  { "scheduled": "2027-04-01", "type": "recycling", "reason": "Easter swap" }
]
```

`scheduled` is the date the app *would* have shown — that is the key, so use the
regular schedule's date, not the new one.

**Glass needs `"stream": "glass"`.** Adjustments default to the waste stream. If
waste and glass fall on the same day and both move, that's **two entries**, one
per stream:

```jsonc
{ "scheduled": "2026-12-31", "actual": "2027-01-02", "reason": "New Year" },
{ "scheduled": "2026-12-31", "actual": "2027-01-02", "stream": "glass", "reason": "New Year" }
```

### Why it can't knock the cycle out of step

Adjustments are applied **after** the app works out which bin is due. Moving a
Christmas collection changes only its date, never the general/recycling
alternation. A shifted collection cannot cascade into every following week
being wrong — a real risk if dates were simply shunted along.

### Offline and stale-cache behaviour

`exceptions.json` is fetched **network-first** by the service worker, unlike
everything else in the app, which is cache-first for speed. That matters: a
cache-first holiday file could serve last Christmas's data indefinitely.

Offline, the app falls back to the last fetched copy and carries on with the
regular schedule. Settings show a status pill — *"3 active"*, *"none
published"*, or *"offline"* — so you can tell what the app is working from.

### Who should edit it

Anyone with write access to the repo. Practical suggestions:

- Give one or two neighbours commit access so it isn't a single point of failure.
- Add adjustments as soon as the council publishes them, typically several weeks
  ahead of Christmas.
- Leave past entries in place as a record — they're ignored once the date passes.
- Keep `updated` current; it appears in the settings tooltip so people can see
  how fresh the list is.

### If the schedule changes permanently

For a permanent change (a new collection day, or a re-based cycle), don't use
`exceptions.json` — update the defaults in `app.js`:

```js
const DEFAULTS = {
  anchorISO: "2026-05-28",
  anchorType: "general",
  weekday: 4,
  count: 4,
};
```

Then bump `CACHE_NAME` in `sw.js` so installed apps pick it up. Note that anyone
who has already changed their settings keeps their own values, so it's worth
telling people to hit **Reset to defaults**.

---

## Files

```
index.html        app shell
styles.css        dark theme styling
app.js            schedule logic, settings, rendering
exceptions.json   CENTRAL holiday adjustments — edit this one
manifest.json     PWA metadata
sw.js             offline caching (network-first for exceptions.json)
icons/            app icons (192/512, incl. maskable variants)
```

## Deploying to GitHub Pages

1. Create a **public** repo (e.g. `normandy-mead-waste`).
2. Upload these files to the repo root, keeping the `icons/` folder structure
   intact — if the icons 404, the app won't install as a proper PWA.
3. **Settings → Pages → Build and deployment → Source → Deploy from a branch**.
4. Choose `main` and `/ (root)`, then **Save**.
5. The live URL appears after a minute or two.

### Installing

Only Chromium browsers support an in-page install button, so the app detects the
browser and shows the right instruction:

- **Chrome / Edge / Samsung Internet** — an "Install app" button appears.
- **Firefox on Android** — ⋮ menu → Install.
- **Firefox on desktop** — can't install PWAs at all; bookmark it or use Chrome.
- **Safari on iOS** — Share → Add to Home Screen.

All install prompts disappear once the app is running installed.

Works fully offline after the first load.
