(() => {
  "use strict";

  // ---- Defaults ---------------------------------------------------------
  // Collections run weekly, alternating between the two bin types. The
  // reference ("anchor") date fixes both the day of the week and which bin
  // is out, so everything else is derived from it.
  const DEFAULTS = {
    anchorISO: "2026-05-28",   // Thu 28 May 2026
    anchorType: "general",     // ...was a general waste collection
    weekday: 4,                // 0=Sun ... 4=Thu (derived from the anchor)
    count: 4,                  // collections shown per page
  };

  const TYPES = {
    general: { name: "General waste", key: "general" },
    recycling: { name: "Recycling", key: "recycling" },
  };
  const OTHER = { general: "recycling", recycling: "general" };

  const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ---- Date helpers (local midnight, no time component) ----------------
  function atMidnight(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function today() { return atMidnight(new Date()); }
  function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function dayDiff(a, b) { return Math.round((atMidnight(a) - atMidnight(b)) / 86400000); }
  function sameDate(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function toISO(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function fromISO(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d) ? null : d;
  }
  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // ---- Settings (persisted on this device) ------------------------------
  const SETTINGS_KEY = "normandyMeadWasteSettings";

  function loadSettings() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null"); } catch { raw = null; }
    const s = Object.assign({}, DEFAULTS, raw || {});

    // Validate every field so a corrupt or hand-edited store can't break the app.
    if (!fromISO(s.anchorISO)) s.anchorISO = DEFAULTS.anchorISO;
    if (s.anchorType !== "general" && s.anchorType !== "recycling") s.anchorType = DEFAULTS.anchorType;
    const wd = Number(s.weekday);
    s.weekday = Number.isInteger(wd) && wd >= 0 && wd <= 6 ? wd : DEFAULTS.weekday;
    const c = Number(s.count);
    s.count = Number.isInteger(c) && c >= 1 && c <= 52 ? c : DEFAULTS.count;

    // The anchor date must fall on the configured collection day; if they
    // disagree (e.g. the weekday was just changed), snap the anchor to the
    // nearest matching day so the two stay consistent.
    const a = fromISO(s.anchorISO);
    if (a.getDay() !== s.weekday) {
      s.anchorISO = toISO(snapToWeekday(a, s.weekday));
    }
    return s;
  }

  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
  }

  // Nearest date with the given weekday (ties go forward).
  function snapToWeekday(date, weekday) {
    const fwd = (weekday - date.getDay() + 7) % 7;
    const back = (date.getDay() - weekday + 7) % 7;
    return fwd <= back ? addDays(date, fwd) : addDays(date, -back);
  }

  let settings = loadSettings();

  // ---- Central holiday adjustments --------------------------------------
  // Keyed by the *scheduled* date, so moving a collection never disturbs the
  // general/recycling alternation.
  let adjustments = new Map();
  let exceptionsMeta = { state: "loading", count: 0, updated: null };

  async function loadExceptions() {
    try {
      // Cache-busted so a freshly published change is picked up rather than
      // being served indefinitely from the service worker cache.
      const res = await fetch(`exceptions.json?v=${Date.now()}`, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data.adjustments) ? data.adjustments : [];

      adjustments = new Map();
      for (const item of list) {
        const scheduled = fromISO(item && item.scheduled);
        if (!scheduled) continue;
        adjustments.set(toISO(scheduled), {
          actual: fromISO(item.actual),
          cancelled: item.cancelled === true,
          type: (item.type === "general" || item.type === "recycling") ? item.type : null,
          reason: typeof item.reason === "string" ? item.reason : "",
        });
      }
      exceptionsMeta = { state: "ok", count: adjustments.size, updated: data.updated || null };
    } catch {
      // Offline or the file is missing: fall back to the plain schedule.
      exceptionsMeta = { state: "unavailable", count: 0, updated: null };
    }
    render();
    refreshExceptionStatus();
  }

  // ---- Schedule ----------------------------------------------------------
  // Collection number `k` in the series, counting from the anchor (k may be
  // negative). Returns the scheduled date and the type due, before any
  // holiday adjustment is applied.
  function scheduledCollection(k) {
    const anchor = fromISO(settings.anchorISO);
    const date = addDays(anchor, k * 7);
    const parity = ((k % 2) + 2) % 2;
    const typeKey = parity === 0 ? settings.anchorType : OTHER[settings.anchorType];
    return { date, typeKey };
  }

  // Apply any central adjustment to a scheduled collection.
  function applyAdjustment(entry) {
    const adj = adjustments.get(toISO(entry.date));
    if (!adj) return { ...entry, moved: false, cancelled: false, reason: "" };
    return {
      date: adj.actual || entry.date,
      typeKey: adj.type || entry.typeKey,
      moved: !!adj.actual && !sameDate(adj.actual, entry.date),
      cancelled: adj.cancelled,
      reason: adj.reason,
      originalDate: entry.date,
    };
  }

  // Index of the first collection falling on or after `date`.
  function firstIndexOnOrAfter(date) {
    const anchor = fromISO(settings.anchorISO);
    return Math.ceil(dayDiff(date, anchor) / 7);
  }

  // Gather `count` collections starting at series index `startIdx`, skipping
  // cancelled ones so a full page is still returned.
  function collectFrom(startIdx, count) {
    const out = [];
    let k = startIdx;
    let guard = 0;
    while (out.length < count && guard < count * 12 + 60) {
      const item = applyAdjustment(scheduledCollection(k));
      if (!item.cancelled) out.push(item);
      k++;
      guard++;
    }
    return out;
  }

  // ---- State --------------------------------------------------------------
  let startIndex = 0; // series index the current page starts at

  function resetToToday() {
    startIndex = firstIndexOnOrAfter(today());
  }

  // ---- Elements -----------------------------------------------------------
  const el = {
    board: document.getElementById("board"),
    nextUp: document.getElementById("nextUp"),
    rangeLabel: document.getElementById("rangeLabel"),
    btnToday: document.getElementById("btnToday"),
    btnPrev: document.getElementById("btnPrev"),
    btnNext: document.getElementById("btnNext"),
    installBtn: document.getElementById("installBtn"),
    iosHint: document.getElementById("iosHint"),
    btnSettings: document.getElementById("btnSettings"),
    settingsOverlay: document.getElementById("settingsOverlay"),
    btnCloseSettings: document.getElementById("btnCloseSettings"),
    countSelect: document.getElementById("countSelect"),
    weekdaySelect: document.getElementById("weekdaySelect"),
    anchorDate: document.getElementById("anchorDate"),
    anchorType: document.getElementById("anchorType"),
    scheduleSummary: document.getElementById("scheduleSummary"),
    exceptionStatus: document.getElementById("exceptionStatus"),
    btnReset: document.getElementById("btnReset"),
  };

  // ---- Render --------------------------------------------------------------
  function render() {
    const t = today();
    const items = collectFrom(startIndex, settings.count);
    el.board.innerHTML = "";

    items.forEach((item, i) => {
      const type = TYPES[item.typeKey];
      const isToday = sameDate(item.date, t);
      const isTomorrow = sameDate(item.date, addDays(t, 1));
      const isPast = dayDiff(item.date, t) < 0;

      let tag = "";
      if (isToday) tag = '<span class="pill-tag">TODAY</span>';
      else if (isTomorrow) tag = '<span class="pill-tag">TOMORROW</span>';

      const note = item.moved
        ? `<p class="adj-note">Moved from ${WEEKDAY_SHORT[item.originalDate.getDay()]} ${item.originalDate.getDate()} ${MONTH_SHORT[item.originalDate.getMonth()]}${item.reason ? ` — ${item.reason}` : ""}</p>`
        : (item.reason ? `<p class="adj-note">${item.reason}</p>` : "");

      const row = document.createElement("div");
      row.className = `day-row ${type.key}${isToday ? " is-today" : ""}${isPast ? " is-past" : ""}`;
      row.style.animationDelay = `${Math.min(i, 8) * 40}ms`;
      row.innerHTML = `
        <div class="date-block">
          <span class="dow">${WEEKDAY_SHORT[item.date.getDay()]}</span>
          <span class="dom">${item.date.getDate()}</span>
          <span class="mon">${MONTH_SHORT[item.date.getMonth()]}</span>
        </div>
        <div class="day-info">
          <div class="type-name">${type.name}${tag}${item.moved ? '<span class="moved-tag">MOVED</span>' : ""}</div>
          <p class="full-date">${WEEKDAY_LONG[item.date.getDay()]}, ${ordinal(item.date.getDate())} ${MONTH_LONG[item.date.getMonth()]} ${item.date.getFullYear()}</p>
          ${note}
        </div>
      `;
      el.board.appendChild(row);
    });

    // Range label
    if (items.length) {
      const a = items[0].date, b = items[items.length - 1].date;
      const sameYear = a.getFullYear() === b.getFullYear();
      el.rangeLabel.textContent = sameYear
        ? `${MONTH_SHORT[a.getMonth()]} ${a.getDate()} – ${MONTH_SHORT[b.getMonth()]} ${b.getDate()}`
        : `${MONTH_SHORT[a.getMonth()]} ${a.getFullYear()} – ${MONTH_SHORT[b.getMonth()]} ${b.getFullYear()}`;
    }

    // "Next collection" line, always relative to today rather than the page
    const upcoming = collectFrom(firstIndexOnOrAfter(t), 1)[0];
    if (upcoming) {
      const days = dayDiff(upcoming.date, t);
      const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
      el.nextUp.innerHTML = `Next collection <strong>${when}</strong> — ${TYPES[upcoming.typeKey].name.toLowerCase()}`;
    }
  }

  // ---- Navigation ----------------------------------------------------------
  el.btnToday.addEventListener("click", () => { resetToToday(); render(); });
  el.btnPrev.addEventListener("click", () => { startIndex -= settings.count; render(); });
  el.btnNext.addEventListener("click", () => { startIndex += settings.count; render(); });

  // ---- Settings ------------------------------------------------------------
  function syncSettingsForm() {
    el.countSelect.value = String(settings.count);
    el.weekdaySelect.value = String(settings.weekday);
    el.anchorDate.value = settings.anchorISO;
    el.anchorType.value = settings.anchorType;

    const a = fromISO(settings.anchorISO);
    el.scheduleSummary.textContent =
      `Every ${WEEKDAY_LONG[settings.weekday]}, alternating. ${ordinal(a.getDate())} ${MONTH_SHORT[a.getMonth()]} ${a.getFullYear()} = ${TYPES[settings.anchorType].name.toLowerCase()}.`;
  }

  function refreshExceptionStatus() {
    const s = exceptionsMeta;
    const pill = el.exceptionStatus;
    if (s.state === "loading") {
      pill.textContent = "checking…";
      pill.className = "status-pill";
    } else if (s.state === "ok") {
      pill.textContent = s.count === 0 ? "none published" : `${s.count} active`;
      pill.className = "status-pill ok";
      pill.title = s.updated ? `Published ${s.updated}` : "";
    } else {
      pill.textContent = "offline";
      pill.className = "status-pill warn";
      pill.title = "Using the regular schedule until the list can be fetched again.";
    }
  }

  function applyAndRender() {
    saveSettings(settings);
    syncSettingsForm();
    resetToToday();
    render();
  }

  el.btnSettings.addEventListener("click", () => {
    syncSettingsForm();
    refreshExceptionStatus();
    el.settingsOverlay.hidden = false;
  });
  el.btnCloseSettings.addEventListener("click", () => { el.settingsOverlay.hidden = true; });
  el.settingsOverlay.addEventListener("click", (e) => {
    if (e.target === el.settingsOverlay) el.settingsOverlay.hidden = true;
  });

  el.countSelect.addEventListener("change", () => {
    settings.count = Number(el.countSelect.value);
    applyAndRender();
  });

  el.weekdaySelect.addEventListener("change", () => {
    settings.weekday = Number(el.weekdaySelect.value);
    // Keep the anchor on the collection day by snapping it to the nearest match.
    settings.anchorISO = toISO(snapToWeekday(fromISO(settings.anchorISO), settings.weekday));
    applyAndRender();
  });

  el.anchorDate.addEventListener("change", () => {
    const d = fromISO(el.anchorDate.value);
    if (!d) { syncSettingsForm(); return; }
    settings.anchorISO = toISO(d);
    settings.weekday = d.getDay(); // the chosen date defines the collection day
    applyAndRender();
  });

  el.anchorType.addEventListener("change", () => {
    settings.anchorType = el.anchorType.value;
    applyAndRender();
  });

  el.btnReset.addEventListener("click", () => {
    settings = Object.assign({}, DEFAULTS);
    applyAndRender();
  });

  // ---- Install prompt --------------------------------------------------------
  function isInstalled() {
    return window.matchMedia("(display-mode: standalone)").matches
      || window.matchMedia("(display-mode: fullscreen)").matches
      || window.matchMedia("(display-mode: minimal-ui)").matches
      || window.navigator.standalone === true
      || document.referrer.startsWith("android-app://");
  }

  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    if (isInstalled()) return;
    deferredPrompt = e;
    el.installBtn.hidden = false;
  });
  el.installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    el.installBtn.hidden = true;
  });
  window.addEventListener("appinstalled", () => { el.installBtn.hidden = true; });

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isIOS && !isInstalled()) el.iosHint.hidden = false;
  if (isInstalled()) { el.installBtn.hidden = true; el.iosHint.hidden = true; }
  window.matchMedia("(display-mode: standalone)").addEventListener("change", (e) => {
    if (e.matches) { el.installBtn.hidden = true; el.iosHint.hidden = true; }
  });

  // ---- Service worker ---------------------------------------------------------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  // ---- Boot -------------------------------------------------------------------
  resetToToday();
  render();
  syncSettingsForm();
  loadExceptions();

  // Refresh when the app regains focus on a new day, and re-check adjustments.
  let renderedOn = today().getTime();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (today().getTime() !== renderedOn) {
      renderedOn = today().getTime();
      resetToToday();
      render();
    }
    loadExceptions();
  });
})();
