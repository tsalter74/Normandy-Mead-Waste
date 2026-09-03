# Normandy Mead Waste Collection Calendar

A tiny, offline-first PWA showing the next four bin collections.

- **Recycling** — green
- **General waste** — grey

Collections are every **Thursday**, alternating between the two. The schedule is
anchored to **Thursday 28 May 2026 (general waste)** and computed in the browser,
so it works indefinitely with no server or database.

## Files

```
index.html      the app shell
styles.css      dark theme styling
app.js          schedule logic, rendering, install prompt
manifest.json   PWA metadata
sw.js           offline caching (service worker)
icons/          app icons (192/512, incl. maskable variants)
```

## Changing the schedule

Three constants at the top of `app.js` control everything:

```js
const ANCHOR = new Date(2026, 4, 28);   // Thu 28 May 2026 = general waste
const COLLECTION_WEEKDAY = 4;           // 0=Sun ... 4=Thursday
const WEEKS_SHOWN = 4;                  // how many collections to list
```

Month is 0-indexed, so `4` = May. To flip which type falls on the anchor date,
swap `general` and `recycling` in the `typeForDate` return. Colours are the
`--recycling` and `--general` variables at the top of `styles.css`.

## Deploying to GitHub Pages

1. Create a new **public** repo (e.g. `normandy-mead-waste`).
2. Upload the files from this folder to the repo root — keep the `icons/`
   folder structure intact, or the icons will 404 and the app won't install
   as a proper PWA.
3. **Settings → Pages → Build and deployment → Source → Deploy from a branch**.
4. Choose `main` and `/ (root)`, then **Save**.
5. After a minute or two the live URL appears, e.g.
   `https://<your-username>.github.io/normandy-mead-waste/`

### Installing
- **Android / desktop Chrome**: an "Install app" button appears in the page.
- **iPhone/iPad**: must use Safari — tap Share → **Add to Home Screen**.
  (iOS doesn't support automatic install prompts, so the app shows this
  instruction automatically on iOS.)

After the first load the app works fully offline.
