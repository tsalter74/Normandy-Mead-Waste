(() => {
  "use strict";

  // ---- Config ---------------------------------------------------------
  // Collections are every Thursday, alternating between general waste and
  // recycling. This reference Thursday was a GENERAL WASTE collection; every
  // other Thursday from here alternates, forwards and backwards indefinitely.
  const ANCHOR = new Date(2026, 4, 28);   // Thu 28 May 2026 = general waste
  const COLLECTION_WEEKDAY = 4;           // 0=Sun ... 4=Thursday
  const WEEKS_SHOWN = 4;

  const TYPES = {
    general: { name: "General waste", key: "general" },
    recycling: { name: "Recycling", key: "recycling" },
  };

  const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  // ---- Date helpers (local midnight, no time component) ----------------
  function atMidnight(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function today() { return atMidnight(new Date()); }
  function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function dayDiff(a, b) { return Math.round((atMidnight(a) - atMidnight(b)) / 86400000); }
  function sameDate(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  // First collection day on or after the given date.
  function nextCollectionOnOrAfter(date) {
    const offset = (COLLECTION_WEEKDAY - date.getDay() + 7) % 7;
    return addDays(date, offset);
  }

  // Which bin goes out on a given collection date.
  function typeForDate(date) {
    const weeks = Math.floor(dayDiff(date, ANCHOR) / 7);
    const parity = ((weeks % 2) + 2) % 2;
    return parity === 0 ? TYPES.general : TYPES.recycling;
  }

  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // ---- Elements ---------------------------------------------------------
  const el = {
    board: document.getElementById("board"),
    nextUp: document.getElementById("nextUp"),
    installBtn: document.getElementById("installBtn"),
    iosHint: document.getElementById("iosHint"),
  };

  // ---- Render -----------------------------------------------------------
  function render() {
    const t = today();
    const first = nextCollectionOnOrAfter(t);
    el.board.innerHTML = "";

    for (let i = 0; i < WEEKS_SHOWN; i++) {
      const date = addDays(first, i * 7);
      const type = typeForDate(date);
      const isToday = sameDate(date, t);
      const isTomorrow = sameDate(date, addDays(t, 1));

      let tag = "";
      if (isToday) tag = '<span class="today-tag">TODAY</span>';
      else if (isTomorrow) tag = '<span class="tomorrow-tag">TOMORROW</span>';

      const row = document.createElement("div");
      row.className = `day-row ${type.key}${isToday ? " is-today" : ""}`;
      row.style.animationDelay = `${i * 45}ms`;
      row.innerHTML = `
        <div class="date-block">
          <span class="dow">${WEEKDAY_SHORT[date.getDay()]}</span>
          <span class="dom">${date.getDate()}</span>
        </div>
        <div class="day-info">
          <div class="type-name">${type.name}${tag}</div>
          <p class="full-date">${WEEKDAY_LONG[date.getDay()]}, ${ordinal(date.getDate())} ${MONTH_LONG[date.getMonth()]} ${date.getFullYear()}</p>
        </div>
      `;
      el.board.appendChild(row);
    }

    // Friendly "next collection" line above the list
    const nextType = typeForDate(first);
    const days = dayDiff(first, t);
    let when;
    if (days === 0) when = "today";
    else if (days === 1) when = "tomorrow";
    else when = `in ${days} days`;
    el.nextUp.innerHTML = `Next collection <strong>${when}</strong> — ${nextType.name.toLowerCase()}`;
  }

  // ---- Install prompt ----------------------------------------------------
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

  // iOS Safari has no beforeinstallprompt — show a manual hint instead.
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isIOS && !isInstalled()) el.iosHint.hidden = false;
  if (isInstalled()) {
    el.installBtn.hidden = true;
    el.iosHint.hidden = true;
  }
  window.matchMedia("(display-mode: standalone)").addEventListener("change", (e) => {
    if (e.matches) {
      el.installBtn.hidden = true;
      el.iosHint.hidden = true;
    }
  });

  // ---- Service worker ------------------------------------------------------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  // ---- Boot -----------------------------------------------------------------
  render();

  // If the app is left open past midnight, refresh the list when it regains focus.
  let renderedOn = today().getTime();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && today().getTime() !== renderedOn) {
      renderedOn = today().getTime();
      render();
    }
  });
})();
