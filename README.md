# Normandy Mead Waste Collection Calendar

A small, offline-first PWA showing upcoming bin collections.

- **Recycling** — green
- **General waste** — grey

Collections run weekly, alternating between the two. Everything is computed in
the browser from a reference date, so there is no server or database.

## Using it

- **Today** — jump back to the next upcoming collection.
- **‹ ›** — page backwards/forwards through the schedule, as far as you like.
- **Gear icon** — settings (see below).

## Settings (per device)

| Setting | What it does |
|---|---|
| Collections to show | How many appear per page (2–12) |
| Collection day | Which weekday collections fall on |
| Reference date | A known collection date the schedule is anchored to |
| …is a collection of | Which bin went out on that reference date |

The reference date and collection day are kept in step automatically: picking a
new date adopts that date's weekday, and changing the weekday shifts the
reference date to the nearest matching day. **Reset to defaults** restores the
original Normandy Mead schedule (Thursdays, anchored to 28 May 2026 = general
waste).

These are stored per device, so each household can adjust display preferences
without affecting anyone else.

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
- **Android / desktop Chrome**: an "Install app" button appears in the page.
- **iPhone/iPad**: must be Safari — tap Share → **Add to Home Screen**.
  iOS has no automatic install prompt, so the app shows this hint itself.

Works fully offline after the first load.
