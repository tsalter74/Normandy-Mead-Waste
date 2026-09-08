(() => {
  "use strict";

  // ---- Defaults ---------------------------------------------------------
  // Two independent schedules:
  //   waste — weekly, alternating general/recycling
  //   glass — its own weekday and its own multi-week cycle
  // Each is anchored to a known collection date, which fixes both the day of
  // the week and (for waste) which bin was out.
  const DEFAULTS = {
    // Waste & recycling
    wasteAnchorISO: "2026-05-28",  // Thu 28 May 2026
    wasteAnchorType: "general",    // ...was general waste
    wasteWeekday: 4,               // 0=Sun ... 4=Thu

    // Glass — PLACEHOLDER: set this to a real glass collection date.
    glassEnabled: true,
    glassAnchorISO: "2026-09-03",
    glassWeekday: 4,
    glassIntervalWeeks: 4,

    // Display
    weeks: 4,                      // how many weeks of schedule to show

    // Reminders
    remindDaysBefore: 1,
    remindTime: "17:00",
  };

  const TYPES = {
    general:   { name: "General waste", key: "general" },
    recycling: { name: "Recycling",     key: "recycling" },
    glass:     { name: "Glass",         key: "glass" },
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
  // Nearest date with the given weekday (ties go forward).
  function snapToWeekday(date, weekday) {
    const fwd = (weekday - date.getDay() + 7) % 7;
    const back = (date.getDay() - weekday + 7) % 7;
    return fwd <= back ? addDays(date, fwd) : addDays(date, -back);
  }
  // Floor division, so cycles work correctly for dates before the anchor.
  function floorDiv(a, b) { return Math.floor(a / b); }

  // ---- Settings ----------------------------------------------------------
  const SETTINGS_KEY = "normandyMeadWasteSettings";

  function loadSettings() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null"); } catch { raw = null; }
    const s = Object.assign({}, DEFAULTS, raw || {});

    if (!fromISO(s.wasteAnchorISO)) s.wasteAnchorISO = DEFAULTS.wasteAnchorISO;
    if (s.wasteAnchorType !== "general" && s.wasteAnchorType !== "recycling") s.wasteAnchorType = DEFAULTS.wasteAnchorType;
    const ww = Number(s.wasteWeekday);
    s.wasteWeekday = Number.isInteger(ww) && ww >= 0 && ww <= 6 ? ww : DEFAULTS.wasteWeekday;

    if (!fromISO(s.glassAnchorISO)) s.glassAnchorISO = DEFAULTS.glassAnchorISO;
    const gw = Number(s.glassWeekday);
    s.glassWeekday = Number.isInteger(gw) && gw >= 0 && gw <= 6 ? gw : DEFAULTS.glassWeekday;
    const gi = Number(s.glassIntervalWeeks);
    s.glassIntervalWeeks = Number.isInteger(gi) && gi >= 1 && gi <= 12 ? gi : DEFAULTS.glassIntervalWeeks;
    s.glassEnabled = s.glassEnabled !== false;

    const wk = Number(s.weeks);
    s.weeks = Number.isInteger(wk) && wk >= 1 && wk <= 52 ? wk : DEFAULTS.weeks;

    const rd = Number(s.remindDaysBefore);
    s.remindDaysBefore = Number.isInteger(rd) && rd >= 0 && rd <= 7 ? rd : DEFAULTS.remindDaysBefore;
    if (!/^\d{2}:\d{2}$/.test(String(s.remindTime || ""))) s.remindTime = DEFAULTS.remindTime;

    // Keep each anchor on its own collection weekday.
    const wa = fromISO(s.wasteAnchorISO);
    if (wa.getDay() !== s.wasteWeekday) s.wasteAnchorISO = toISO(snapToWeekday(wa, s.wasteWeekday));
    const ga = fromISO(s.glassAnchorISO);
    if (ga.getDay() !== s.glassWeekday) s.glassAnchorISO = toISO(snapToWeekday(ga, s.glassWeekday));

    return s;
  }

  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
  }

  let settings = loadSettings();

  // ---- Central holiday adjustments --------------------------------------
  // Keyed by "stream:scheduledDate" so waste and glass can be adjusted
  // independently even when they fall on the same day.
  let adjustments = new Map();
  let exceptionsMeta = { state: "loading", count: 0, updated: null };

  function adjKey(stream, date) { return `${stream}:${toISO(date)}`; }

  async function loadExceptions() {
    try {
      const res = await fetch(`exceptions.json?v=${Date.now()}`, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data.adjustments) ? data.adjustments : [];

      adjustments = new Map();
      for (const item of list) {
        const scheduled = fromISO(item && item.scheduled);
        if (!scheduled) continue;
        // Entries without a stream apply to waste, so older files still work.
        const stream = item.stream === "glass" ? "glass" : "waste";
        adjustments.set(adjKey(stream, scheduled), {
          actual: fromISO(item.actual),
          cancelled: item.cancelled === true,
          type: TYPES[item.type] ? item.type : null,
          reason: typeof item.reason === "string" ? item.reason : "",
        });
      }
      exceptionsMeta = { state: "ok", count: adjustments.size, updated: data.updated || null };
    } catch {
      exceptionsMeta = { state: "unavailable", count: 0, updated: null };
    }
    render();
    refreshExceptionStatus();
  }

  function applyAdjustment(entry) {
    const adj = adjustments.get(adjKey(entry.stream, entry.date));
    if (!adj) return { ...entry, scheduledDate: entry.date, moved: false, cancelled: false, reason: "" };
    return {
      stream: entry.stream,
      typeKey: adj.type || entry.typeKey,
      date: adj.actual || entry.date,
      scheduledDate: entry.date,
      moved: !!adj.actual && !sameDate(adj.actual, entry.date),
      cancelled: adj.cancelled,
      reason: adj.reason,
    };
  }

  // ---- Schedules ----------------------------------------------------------
  // Raw (pre-adjustment) occurrences of each stream between two dates.
  function wasteOccurrences(from, to) {
    const anchor = fromISO(settings.wasteAnchorISO);
    const out = [];
    const startK = Math.ceil(dayDiff(from, anchor) / 7);
    const endK = Math.floor(dayDiff(to, anchor) / 7);
    for (let k = startK; k <= endK; k++) {
      const parity = ((k % 2) + 2) % 2;
      out.push({
        stream: "waste",
        date: addDays(anchor, k * 7),
        typeKey: parity === 0 ? settings.wasteAnchorType : OTHER[settings.wasteAnchorType],
      });
    }
    return out;
  }

  function glassOccurrences(from, to) {
    if (!settings.glassEnabled) return [];
    const anchor = fromISO(settings.glassAnchorISO);
    const step = settings.glassIntervalWeeks * 7;
    const out = [];
    const startK = Math.ceil(dayDiff(from, anchor) / step);
    const endK = floorDiv(dayDiff(to, anchor), step);
    for (let k = startK; k <= endK; k++) {
      out.push({ stream: "glass", date: addDays(anchor, k * step), typeKey: "glass" });
    }
    return out;
  }

  // Merged, adjusted, chronological list for a date window. The raw range is
  // padded so a collection moved into the window by a holiday adjustment
  // still shows up (and one moved out disappears).
  function collectionsBetween(from, to) {
    const pad = 21;
    const rawFrom = addDays(from, -pad);
    const rawTo = addDays(to, pad);

    const raw = [...wasteOccurrences(rawFrom, rawTo), ...glassOccurrences(rawFrom, rawTo)];
    return raw
      .map(applyAdjustment)
      .filter((c) => !c.cancelled)
      .filter((c) => dayDiff(c.date, from) >= 0 && dayDiff(c.date, to) <= 0)
      .sort((a, b) => a.date - b.date || a.stream.localeCompare(b.stream));
  }

  // Next collection on or after a date, scanning far enough ahead to cover a
  // long glass interval.
  function nextCollectionFrom(date) {
    const horizon = addDays(date, Math.max(60, settings.glassIntervalWeeks * 7 + 14));
    return collectionsBetween(date, horizon)[0] || null;
  }

  // ---- State ---------------------------------------------------------------
  let viewStart = today();
  const windowEnd = () => addDays(viewStart, settings.weeks * 7 - 1);

  // ---- Elements ------------------------------------------------------------
  const el = {};
  for (const id of [
    "board", "emptyNote", "nextUp", "rangeLabel", "btnToday", "btnPrev", "btnNext",
    "installBtn", "installHint", "btnSettings", "settingsOverlay", "btnCloseSettings",
    "weeksSelect", "wasteWeekday", "wasteAnchor", "wasteType", "wasteSummary",
    "glassEnabled", "glassFields", "glassWeekday", "glassAnchor", "glassInterval", "glassSummary",
    "remindWhen", "remindTime", "reminderSummary", "btnCalendar", "btnSubscribe",
    "btnCopyUrl", "subscribeUrl", "subscribeMatch", "exceptionStatus", "btnReset", "legendGlass",
  ]) el[id] = document.getElementById(id);

  // Populate weekday dropdowns
  for (const sel of [el.wasteWeekday, el.glassWeekday]) {
    sel.innerHTML = WEEKDAY_LONG.map((d, i) => `<option value="${i}">${d}</option>`).join("");
  }

  // ---- Render ---------------------------------------------------------------
  function render() {
    const t = today();
    const from = viewStart, to = windowEnd();
    const items = collectionsBetween(from, to);

    el.board.innerHTML = "";
    el.emptyNote.hidden = items.length > 0;

    items.forEach((item, i) => {
      const type = TYPES[item.typeKey];
      const isToday = sameDate(item.date, t);
      const isTomorrow = sameDate(item.date, addDays(t, 1));
      const isPast = dayDiff(item.date, t) < 0;

      let tag = "";
      if (isToday) tag = '<span class="pill-tag">TODAY</span>';
      else if (isTomorrow) tag = '<span class="pill-tag">TOMORROW</span>';

      const note = item.moved
        ? `<p class="adj-note">Moved from ${WEEKDAY_SHORT[item.scheduledDate.getDay()]} ${item.scheduledDate.getDate()} ${MONTH_SHORT[item.scheduledDate.getMonth()]}${item.reason ? ` — ${item.reason}` : ""}</p>`
        : (item.reason ? `<p class="adj-note">${item.reason}</p>` : "");

      const row = document.createElement("div");
      row.className = `day-row ${type.key}${isToday ? " is-today" : ""}${isPast ? " is-past" : ""}`;
      row.style.animationDelay = `${Math.min(i, 10) * 35}ms`;
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

    // Window label
    const sameYear = from.getFullYear() === to.getFullYear();
    el.rangeLabel.textContent = sameYear
      ? `${from.getDate()} ${MONTH_SHORT[from.getMonth()]} – ${to.getDate()} ${MONTH_SHORT[to.getMonth()]}`
      : `${MONTH_SHORT[from.getMonth()]} ${from.getFullYear()} – ${MONTH_SHORT[to.getMonth()]} ${to.getFullYear()}`;

    // Next collection, always relative to today
    const upcoming = nextCollectionFrom(t);
    if (upcoming) {
      const days = dayDiff(upcoming.date, t);
      const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
      el.nextUp.innerHTML = `Next collection <strong>${when}</strong> — ${TYPES[upcoming.typeKey].name.toLowerCase()}`;
    } else {
      el.nextUp.textContent = "";
    }

    el.legendGlass.hidden = !settings.glassEnabled;
  }

  // ---- Navigation ------------------------------------------------------------
  el.btnToday.addEventListener("click", () => { viewStart = today(); render(); });
  el.btnPrev.addEventListener("click", () => { viewStart = addDays(viewStart, -settings.weeks * 7); render(); });
  el.btnNext.addEventListener("click", () => { viewStart = addDays(viewStart, settings.weeks * 7); render(); });

  // ---- Calendar export (.ics) --------------------------------------------
  // A PWA cannot reliably schedule local notifications (Notification Triggers
  // was dropped; Web Push needs a server), so the phone's own calendar does it.
  function icsEscape(t) {
    return String(t).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  }
  function icsDate(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  }
  // All-day events start at midnight, so the alarm is just an offset from it:
  // 17:00 the day before is -7h; 07:00 on the day is +7h.
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

  function buildICS(years = 2) {
    const t = today();
    const items = collectionsBetween(t, addDays(t, years * 365));
    const trigger = alarmTrigger(settings.remindDaysBefore, settings.remindTime);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

    const lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0",
      "PRODID:-//Normandy Mead//Waste Collection//EN",
      "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      "X-WR-CALNAME:Normandy Mead Bin Collections",
      "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
    ];

    for (const item of items) {
      const type = TYPES[item.typeKey];
      const desc = item.moved
        ? `Moved from ${toISO(item.scheduledDate)}${item.reason ? ` - ${icsEscape(item.reason)}` : ""}`
        : (item.reason ? icsEscape(item.reason) : `${icsEscape(type.name)} collection`);
      lines.push(
        "BEGIN:VEVENT",
        `UID:nm-${item.stream}-${icsDate(item.scheduledDate)}@normandy-mead`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${icsDate(item.date)}`,
        `DTEND;VALUE=DATE:${icsDate(addDays(item.date, 1))}`,
        `SUMMARY:${icsEscape(type.name)} collection`,
        `DESCRIPTION:${desc}`,
        "TRANSP:TRANSPARENT",
        "BEGIN:VALARM",
        `TRIGGER:${trigger}`,
        "ACTION:DISPLAY",
        `DESCRIPTION:${icsEscape("Put out the " + type.name.toLowerCase() + " bin")}`,
        "END:VALARM",
        "END:VEVENT"
      );
    }
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }

  function downloadICS() {
    const blob = new Blob([buildICS(2)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "normandy-mead-bin-collections.ics";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ---- Subscribable feeds ---------------------------------------------------
  const FEEDS = [
    { file: "bins-1700-day-before.ics", daysBefore: 1, time: "17:00" },
    { file: "bins-1900-day-before.ics", daysBefore: 1, time: "19:00" },
    { file: "bins-2100-day-before.ics", daysBefore: 1, time: "21:00" },
    { file: "bins-0600-same-day.ics",   daysBefore: 0, time: "06:00" },
    { file: "bins-0700-same-day.ics",   daysBefore: 0, time: "07:00" },
    { file: "bins-no-alarm.ics",        daysBefore: null, time: null },
  ];

  function baseURL() {
    return new URL(".", window.location.href).href.replace(/\/$/, "");
  }
  function matchFeed() {
    const exact = FEEDS.find(f => f.daysBefore === settings.remindDaysBefore && f.time === settings.remindTime);
    if (exact) return { feed: exact, exact: true };
    const [th, tm] = settings.remindTime.split(":").map(Number);
    const target = (th * 60 + tm) - settings.remindDaysBefore * 1440;
    let best = FEEDS[0], bestGap = Infinity;
    for (const f of FEEDS) {
      if (f.daysBefore === null) continue;
      const [h, m] = f.time.split(":").map(Number);
      const gap = Math.abs(((h * 60 + m) - f.daysBefore * 1440) - target);
      if (gap < bestGap) { bestGap = gap; best = f; }
    }
    return { feed: best, exact: false };
  }
  function subscribeURL() { return `${baseURL()}/calendar/${matchFeed().feed.file}`; }

  function refreshSubscribeUI() {
    const { feed, exact } = matchFeed();
    el.subscribeUrl.textContent = `${baseURL()}/calendar/${feed.file}`;
    if (exact) {
      el.subscribeMatch.textContent = "exact match";
      el.subscribeMatch.className = "status-pill ok";
      el.subscribeMatch.title = "";
    } else {
      const label = feed.daysBefore === 1 ? `${feed.time} day before` : `${feed.time} on the day`;
      el.subscribeMatch.textContent = `nearest: ${label}`;
      el.subscribeMatch.className = "status-pill warn";
      el.subscribeMatch.title = "Published feeds have fixed alarm times. Use the one-off export for an exact custom time.";
    }
  }

  // ---- Settings wiring --------------------------------------------------------
  function syncSettingsForm() {
    el.weeksSelect.value = String(settings.weeks);

    el.wasteWeekday.value = String(settings.wasteWeekday);
    el.wasteAnchor.value = settings.wasteAnchorISO;
    el.wasteType.value = settings.wasteAnchorType;
    const wa = fromISO(settings.wasteAnchorISO);
    el.wasteSummary.textContent =
      `Every ${WEEKDAY_LONG[settings.wasteWeekday]}, alternating. ${ordinal(wa.getDate())} ${MONTH_SHORT[wa.getMonth()]} ${wa.getFullYear()} = ${TYPES[settings.wasteAnchorType].name.toLowerCase()}.`;

    el.glassEnabled.checked = settings.glassEnabled;
    el.glassFields.hidden = !settings.glassEnabled;
    el.glassWeekday.value = String(settings.glassWeekday);
    el.glassInterval.value = String(settings.glassIntervalWeeks);
    el.glassAnchor.value = settings.glassAnchorISO;
    const ga = fromISO(settings.glassAnchorISO);
    el.glassSummary.textContent =
      `Every ${settings.glassIntervalWeeks} weeks on ${WEEKDAY_LONG[settings.glassWeekday]}, from ${ordinal(ga.getDate())} ${MONTH_SHORT[ga.getMonth()]} ${ga.getFullYear()}.`;

    el.remindWhen.value = String(settings.remindDaysBefore);
    el.remindTime.value = settings.remindTime;
    const when = settings.remindDaysBefore === 0 ? "on collection day"
      : settings.remindDaysBefore === 1 ? "the day before"
      : `${settings.remindDaysBefore} days before`;
    el.reminderSummary.textContent = `Alarm at ${settings.remindTime} ${when}.`;

    refreshSubscribeUI();
  }

  function refreshExceptionStatus() {
    const s = exceptionsMeta, pill = el.exceptionStatus;
    if (s.state === "loading") { pill.textContent = "checking…"; pill.className = "status-pill"; }
    else if (s.state === "ok") {
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
    render();
  }

  el.btnSettings.addEventListener("click", () => {
    syncSettingsForm(); refreshExceptionStatus();
    el.settingsOverlay.hidden = false;
  });
  el.btnCloseSettings.addEventListener("click", () => { el.settingsOverlay.hidden = true; });
  el.settingsOverlay.addEventListener("click", (e) => {
    if (e.target === el.settingsOverlay) el.settingsOverlay.hidden = true;
  });

  el.weeksSelect.addEventListener("change", () => {
    settings.weeks = Number(el.weeksSelect.value);
    viewStart = today();
    applyAndRender();
  });

  el.wasteWeekday.addEventListener("change", () => {
    settings.wasteWeekday = Number(el.wasteWeekday.value);
    settings.wasteAnchorISO = toISO(snapToWeekday(fromISO(settings.wasteAnchorISO), settings.wasteWeekday));
    applyAndRender();
  });
  el.wasteAnchor.addEventListener("change", () => {
    const d = fromISO(el.wasteAnchor.value);
    if (!d) { syncSettingsForm(); return; }
    settings.wasteAnchorISO = toISO(d);
    settings.wasteWeekday = d.getDay();
    applyAndRender();
  });
  el.wasteType.addEventListener("change", () => {
    settings.wasteAnchorType = el.wasteType.value;
    applyAndRender();
  });

  el.glassEnabled.addEventListener("change", () => {
    settings.glassEnabled = el.glassEnabled.checked;
    applyAndRender();
  });
  el.glassWeekday.addEventListener("change", () => {
    settings.glassWeekday = Number(el.glassWeekday.value);
    settings.glassAnchorISO = toISO(snapToWeekday(fromISO(settings.glassAnchorISO), settings.glassWeekday));
    applyAndRender();
  });
  el.glassInterval.addEventListener("change", () => {
    settings.glassIntervalWeeks = Number(el.glassInterval.value);
    applyAndRender();
  });
  el.glassAnchor.addEventListener("change", () => {
    const d = fromISO(el.glassAnchor.value);
    if (!d) { syncSettingsForm(); return; }
    settings.glassAnchorISO = toISO(d);
    settings.glassWeekday = d.getDay();
    applyAndRender();
  });

  el.remindWhen.addEventListener("change", () => {
    settings.remindDaysBefore = Number(el.remindWhen.value);
    saveSettings(settings); syncSettingsForm();
  });
  el.remindTime.addEventListener("change", () => {
    if (/^\d{2}:\d{2}$/.test(el.remindTime.value)) { settings.remindTime = el.remindTime.value; saveSettings(settings); }
    syncSettingsForm();
  });

  el.btnCalendar.addEventListener("click", downloadICS);
  el.btnSubscribe.addEventListener("click", () => {
    window.location.href = subscribeURL().replace(/^https?:/, "webcal:");
  });
  el.btnCopyUrl.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(subscribeURL());
      el.btnCopyUrl.textContent = "Copied ✓";
    } catch {
      const r = document.createRange();
      r.selectNodeContents(el.subscribeUrl);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(r);
      el.btnCopyUrl.textContent = "Select & copy";
    }
    setTimeout(() => { el.btnCopyUrl.textContent = "Copy link"; }, 2000);
  });

  el.btnReset.addEventListener("click", () => {
    settings = Object.assign({}, DEFAULTS);
    viewStart = today();
    applyAndRender();
  });

  // ---- Install prompt ----------------------------------------------------------
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
    el.installHint.hidden = true; // a real button beats an instruction
  });
  el.installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    el.installBtn.hidden = true;
  });
  window.addEventListener("appinstalled", () => { el.installBtn.hidden = true; });

  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  const isFirefox = /firefox|fxios/i.test(ua);
  const isAndroid = /android/i.test(ua);

  function showInstallHint() {
    if (isInstalled() || !el.installHint.hidden || !el.installBtn.hidden) return;
    let msg;
    if (isIOS) msg = "On iPhone/iPad: open in <strong>Safari</strong>, then tap <strong>Share</strong> → <strong>Add to Home Screen</strong>.";
    else if (isFirefox && isAndroid) msg = "In Firefox: tap the <strong>⋮</strong> menu → <strong>Install</strong> (or <em>Add to Home screen</em>).";
    else if (isFirefox) msg = "Firefox on desktop can't install web apps — bookmark this page, or open it in Chrome or Edge to install.";
    else msg = "To install, open this page in Chrome, Edge or Safari and use the browser's install or <em>Add to Home Screen</em> option.";
    el.installHint.innerHTML = msg;
    el.installHint.hidden = false;
  }
  if (!isInstalled()) setTimeout(showInstallHint, 1200);
  if (isInstalled()) { el.installBtn.hidden = true; el.installHint.hidden = true; }
  window.matchMedia("(display-mode: standalone)").addEventListener("change", (e) => {
    if (e.matches) { el.installBtn.hidden = true; el.installHint.hidden = true; }
  });

  // ---- Service worker -----------------------------------------------------------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  // ---- Boot ---------------------------------------------------------------------
  render();
  syncSettingsForm();
  loadExceptions();

  let renderedOn = today().getTime();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (today().getTime() !== renderedOn) {
      renderedOn = today().getTime();
      viewStart = today();
      render();
    }
    loadExceptions();
  });
})();
