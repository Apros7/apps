import * as db from "./storage.js";

const GIT_REPO_KEY = "cycle_git_repo";
const HOSTED_TOKEN_KEY = "cycle_token";
const SAVE_SKIP_KEY = "cycle_skip_save";
const MOVED_KEY = "cycle_moved";
const MOVED_WEIGHTS_KEY = "cycle_moved_has_weights";
const MOVE_ERROR_KEY = "cycle_move_error";
const NEW_APP_URL = "https://apros7.github.io/apps/cycle/";
const OLD_APP_ORIGIN = "https://easysort-gpu1.tail9a1938.ts.net";

const els = {
  save: document.getElementById("save"),
  saveTitle: document.getElementById("save-title"),
  saveSubtitle: document.getElementById("save-subtitle"),
  saveError: document.getElementById("save-error"),
  saveSteps: document.getElementById("save-steps"),
  saveInstall: document.getElementById("save-install"),
  saveFind: document.getElementById("save-find"),
  gate: document.getElementById("gate"),
  tracker: document.getElementById("tracker"),
  gateTitle: document.getElementById("gate-title"),
  gateSubtitle: document.getElementById("gate-subtitle"),
  oldHostNote: document.getElementById("old-host-note"),
  pinForm: document.getElementById("pin-form"),
  pinInput: document.getElementById("pin-input"),
  pinError: document.getElementById("pin-error"),
  pinSubmit: document.getElementById("pin-submit"),
  stayBtn: document.getElementById("stay-btn"),
  moveBanner: document.getElementById("move-banner"),
  moveBtn: document.getElementById("move-btn"),
  moveError: document.getElementById("move-error"),
  weightOpt: document.getElementById("weight-opt"),
  weightEnabledInput: document.getElementById("weight-enabled"),
  weightCard: document.getElementById("weight-card"),
  toggleWeightFeature: document.getElementById("toggle-weight-feature"),
  statusLine: document.getElementById("status-line"),
  lockBtn: document.getElementById("lock-btn"),
  prevMonth: document.getElementById("prev-month"),
  nextMonth: document.getElementById("next-month"),
  monthLabel: document.getElementById("month-label"),
  calendar: document.getElementById("calendar"),
  hint: document.getElementById("hint"),
  weightForm: document.getElementById("weight-form"),
  weightDate: document.getElementById("weight-date"),
  weightValue: document.getElementById("weight-value"),
  weightSummary: document.getElementById("weight-summary"),
  weightMessage: document.getElementById("weight-message"),
  toggleWeightChart: document.getElementById("toggle-weight-chart"),
  weightChartWrap: document.getElementById("weight-chart-wrap"),
  weightChart: document.getElementById("weight-chart"),
  weightChartEmpty: document.getElementById("weight-chart-empty"),
  sheet: document.getElementById("edit-sheet"),
  sheetBackdrop: document.getElementById("sheet-backdrop"),
  sheetRange: document.getElementById("sheet-range"),
  deletePeriod: document.getElementById("delete-period"),
  closeSheet: document.getElementById("close-sheet"),
  dataSummary: document.getElementById("data-summary"),
  installHint: document.getElementById("install-hint"),
  exportBtn: document.getElementById("export-btn"),
  importBtn: document.getElementById("import-btn"),
  importFile: document.getElementById("import-file"),
  gitRepo: document.getElementById("git-repo"),
  updateBtn: document.getElementById("update-btn"),
  resetBtn: document.getElementById("reset-btn"),
  dataMessage: document.getElementById("data-message"),
};

/** @type {{ id: string, start: string, end: string }[]} */
let periods = [];
/** @type {{ date: string, weight_kg: number }[]} */
let weights = [];
/** @type {Date} */
let viewMonth = startOfMonth(new Date());
/** @type {string | null} */
let rangeStart = null;
/** @type {string | null} */
let activePeriodId = null;
/** @type {"setup" | "unlock" | "migrate"} */
let gateMode = "setup";
let appVersion = "";
let waitingForUpdate = false;
let weightEnabled = false;

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(iso, days) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

function daysBetween(a, b) {
  const ms = parseISO(b) - parseISO(a);
  return Math.round(ms / 86400000);
}

function formatShort(iso) {
  return parseISO(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function formatMonth(d) {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function todayISO() {
  return toISO(new Date());
}

function periodOnDay(iso) {
  return periods.find((p) => p.start <= iso && iso <= p.end) || null;
}

function isOldHost() {
  const host = location.hostname;
  if (host.endsWith(".ts.net")) return true;
  return (host === "localhost" || host === "127.0.0.1") && location.port === "8787";
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function deviceKind() {
  const ua = navigator.userAgent || "";
  const iOS =
    /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (iOS) {
    const safari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua);
    return safari ? "ios-safari" : "ios-other";
  }
  if (/Android/i.test(ua)) return "android";
  return "other";
}

function saveStepsForDevice() {
  switch (deviceKind()) {
    case "ios-safari":
      return [
        "Tap the Share button at the bottom (the square with the arrow).",
        "Tap Add to Home Screen, then Add.",
        "Open Cycle from your Home Screen.",
      ];
    case "ios-other":
      return [
        "Open this page in Safari.",
        "Tap Share, then Add to Home Screen.",
        "Open Cycle from your Home Screen.",
      ];
    case "android":
      return [
        "Tap the three dots in the corner.",
        "Tap Add to Home screen or Install app.",
        "Open Cycle from your Home Screen.",
      ];
    default:
      return [
        "Open this page on your phone.",
        "Add Cycle to your Home Screen.",
        "Use the new icon, not the website.",
      ];
  }
}

function showSave() {
  els.save.hidden = false;
  els.gate.hidden = true;
  els.tracker.hidden = true;
  els.saveSteps.replaceChildren();
  for (const text of saveStepsForDevice()) {
    const item = document.createElement("li");
    item.textContent = text;
    els.saveSteps.appendChild(item);
  }
  const moved = sessionStorage.getItem(MOVED_KEY) === "1";
  if (moved && els.saveTitle && els.saveSubtitle) {
    els.saveTitle.textContent = "Logs are on this phone";
    els.saveSubtitle.textContent = "Now save Cycle to your Home Screen. Then use that icon.";
  }
  const moveError = sessionStorage.getItem(MOVE_ERROR_KEY);
  if (els.saveError) {
    els.saveError.hidden = !moveError;
    els.saveError.textContent = moveError || "";
  }
}

function shouldShowSave() {
  if (isOldHost()) return false;
  return !isStandalone() && sessionStorage.getItem(SAVE_SKIP_KEY) !== "1";
}

function showMoveError(el, err) {
  if (!el) return;
  el.textContent = err?.message || "Could not move the logs.";
  el.hidden = false;
}

function setDataMessage(text, isError = false) {
  els.dataMessage.textContent = text;
  els.dataMessage.classList.toggle("error", isError);
}

async function hostedApi(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = sessionStorage.getItem(HOSTED_TOKEN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...options, headers, cache: "no-store" });
  if (!res.ok) {
    let detail = "Something went wrong";
    try {
      const body = await res.json();
      detail = body.detail || detail;
      if (Array.isArray(detail)) detail = detail.map((d) => d.msg || d).join(", ");
    } catch {
      /* ignore */
    }
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

async function probeHosted() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch("./api/status", { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Typical luteal phase used to estimate ovulation from next period. */
const LUTEAL_DAYS = 14;
/** Days before ovulation that are fertile (sperm can survive). */
const FERTILE_BEFORE = 5;

function computePrediction() {
  if (periods.length < 2) return null;
  const starts = periods.map((p) => p.start).sort();
  const lengths = [];
  for (let i = 1; i < starts.length; i++) {
    lengths.push(daysBetween(starts[i - 1], starts[i]));
  }
  const avgCycle = Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);
  const avgBleed = Math.max(
    1,
    Math.round(
      periods.reduce((sum, p) => sum + daysBetween(p.start, p.end) + 1, 0) / periods.length
    )
  );
  const lastStart = starts[starts.length - 1];
  const nextStart = addDays(lastStart, avgCycle);
  const nextEnd = addDays(nextStart, avgBleed - 1);
  const ovulation = addDays(nextStart, -LUTEAL_DAYS);
  const fertileStart = addDays(ovulation, -FERTILE_BEFORE);
  const fertileEnd = ovulation;
  return {
    nextStart,
    nextEnd,
    avgCycle,
    avgBleed,
    ovulation,
    fertileStart,
    fertileEnd,
    peakDay: ovulation,
  };
}

function dateSetInRange(start, end) {
  const set = new Set();
  if (!start || !end || end < start) return set;
  let cur = start;
  while (cur <= end) {
    set.add(cur);
    cur = addDays(cur, 1);
  }
  return set;
}

function predictedDays(pred) {
  if (!pred) return new Set();
  return dateSetInRange(pred.nextStart, pred.nextEnd);
}

function fertileDays(pred) {
  if (!pred) return new Set();
  return dateSetInRange(pred.fertileStart, pred.fertileEnd);
}

function updateStatus() {
  const pred = computePrediction();
  if (!pred) {
    els.statusLine.textContent =
      periods.length === 0
        ? "Tap days to log your periods."
        : "Add one more period to see a prediction.";
    return;
  }
  els.statusLine.textContent = `Next ~ ${formatShort(pred.nextStart)} · Ovulation ~ ${formatShort(pred.ovulation)} · Most fertile ${formatShort(pred.peakDay)}`;
}

function syncWeightInput() {
  const entry = weights.find((item) => item.date === els.weightDate.value);
  els.weightValue.value = entry ? String(entry.weight_kg) : "";
  els.weightMessage.textContent = entry ? "Saved. Change the number to update it." : "";
  els.weightMessage.classList.remove("error");
}

function renderWeightSummary() {
  if (!weights.length) {
    els.weightSummary.textContent = "Add today’s weight";
    return;
  }
  const latest = weights[weights.length - 1];
  els.weightSummary.textContent = `Latest: ${latest.weight_kg} kg · ${formatShort(latest.date)}`;
}

function renderWeightChart() {
  els.weightChart.replaceChildren();
  const points = weights.slice(-90);
  const hasTrend = points.length >= 2;
  els.weightChart.hidden = !hasTrend;
  els.weightChartEmpty.hidden = hasTrend;
  if (!hasTrend) return;

  const width = 340;
  const height = 190;
  const pad = { top: 14, right: 12, bottom: 28, left: 38 };
  const values = points.map((point) => point.weight_kg);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const rangePadding = Math.max((rawMax - rawMin) * 0.2, 0.5);
  const minValue = rawMin - rangePadding;
  const maxValue = rawMax + rangePadding;
  const firstTime = parseISO(points[0].date).getTime();
  const lastTime = parseISO(points[points.length - 1].date).getTime();
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const x = (date) =>
    pad.left + ((parseISO(date).getTime() - firstTime) / (lastTime - firstTime)) * plotWidth;
  const y = (value) =>
    pad.top + ((maxValue - value) / (maxValue - minValue)) * plotHeight;
  const line = points
    .map((point, index) => `${index ? "L" : "M"} ${x(point.date).toFixed(1)} ${y(point.weight_kg).toFixed(1)}`)
    .join(" ");
  const area = `${line} L ${x(points[points.length - 1].date).toFixed(1)} ${
    height - pad.bottom
  } L ${x(points[0].date).toFixed(1)} ${height - pad.bottom} Z`;
  const gridValues = [maxValue, (maxValue + minValue) / 2, minValue];
  const dots = points
    .map(
      (point) =>
        `<circle class="chart-dot" cx="${x(point.date).toFixed(1)}" cy="${y(
          point.weight_kg
        ).toFixed(1)}" r="3.5"><title>${formatShort(point.date)}: ${
          point.weight_kg
        } kg</title></circle>`
    )
    .join("");
  const grid = gridValues
    .map(
      (value) =>
        `<line class="chart-grid" x1="${pad.left}" x2="${width - pad.right}" y1="${y(
          value
        ).toFixed(1)}" y2="${y(value).toFixed(1)}" />
         <text class="chart-label" x="${pad.left - 6}" y="${(y(value) + 3).toFixed(
           1
         )}" text-anchor="end">${value.toFixed(1)}</text>`
    )
    .join("");

  els.weightChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" aria-hidden="true">
      <defs>
        <linearGradient id="weight-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#b03d4f" stop-opacity="0.2" />
          <stop offset="100%" stop-color="#b03d4f" stop-opacity="0" />
        </linearGradient>
      </defs>
      ${grid}
      <path class="chart-area" d="${area}" />
      <path class="chart-line" d="${line}" />
      ${dots}
      <text class="chart-label" x="${pad.left}" y="${height - 7}">${formatShort(
        points[0].date
      )}</text>
      <text class="chart-label" x="${width - pad.right}" y="${
        height - 7
      }" text-anchor="end">${formatShort(points[points.length - 1].date)}</text>
    </svg>`;
  els.weightChart.setAttribute(
    "aria-label",
    `Weight from ${values[0]} to ${values[values.length - 1]} kilograms over ${
      points.length
    } entries`
  );
}

function renderWeights() {
  renderWeightSummary();
  renderWeightChart();
}

function renderDataCard() {
  const parts = [`${periods.length} period${periods.length === 1 ? "" : "s"}`];
  if (weightEnabled) {
    parts.push(`${weights.length} weight${weights.length === 1 ? "" : "s"}`);
  }
  if (appVersion) parts.push(`app ${appVersion}`);
  els.dataSummary.textContent = `On this phone · ${parts.join(" · ")}`;
  els.installHint.hidden = isStandalone();
  els.toggleWeightFeature.textContent = weightEnabled
    ? "Turn off weight tracking"
    : "Add weight tracking";
}

function applyWeightVisibility() {
  els.weightCard.hidden = !weightEnabled;
}

function showGate(mode) {
  gateMode = mode;
  els.save.hidden = true;
  els.gate.hidden = false;
  els.tracker.hidden = true;
  const asking = mode === "setup";
  els.weightOpt.hidden = !asking;
  if (asking) {
    els.weightEnabledInput.checked = sessionStorage.getItem(MOVED_WEIGHTS_KEY) === "1";
  }
  if (els.stayBtn) els.stayBtn.hidden = mode !== "migrate";
  if (els.oldHostNote) {
    els.oldHostNote.hidden = !(isOldHost() && mode === "unlock");
  }
  if (mode === "setup") {
    els.gateTitle.textContent = "Welcome";
    els.gateSubtitle.textContent = "Pick a PIN. Stays on this phone.";
    els.pinSubmit.textContent = "Create PIN";
  } else if (mode === "migrate") {
    els.gateTitle.textContent = "Move to the new app";
    els.gateSubtitle.textContent = "Enter your PIN. We copy your logs, then you save the new app to your Home Screen.";
    els.pinSubmit.textContent = "Move to the new app";
  } else {
    els.gateTitle.textContent = "Hello";
    els.gateSubtitle.textContent = "Enter your PIN.";
    els.pinSubmit.textContent = "Unlock";
  }
  els.pinError.hidden = true;
  const moveError = sessionStorage.getItem(MOVE_ERROR_KEY);
  if (moveError && mode === "setup") {
    els.pinError.textContent = moveError;
    els.pinError.hidden = false;
  }
  els.pinInput.value = "";
  els.pinInput.focus();
}

function showTracker() {
  els.save.hidden = true;
  els.gate.hidden = true;
  els.tracker.hidden = false;
  if (els.moveBanner) els.moveBanner.hidden = !isOldHost();
  applyWeightVisibility();
  renderCalendar();
  updateStatus();
  renderWeights();
  syncWeightInput();
  renderDataCard();
}

function daysInMonthGrid(monthDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const first = new Date(year, month, 1);
  let startPad = first.getDay() - 1;
  if (startPad < 0) startPad = 6;
  const count = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= count; d++) cells.push(new Date(year, month, d));
  return cells;
}

function isInSelectingRange(iso) {
  if (!rangeStart) return false;
  const a = rangeStart <= iso ? rangeStart : iso;
  const b = rangeStart <= iso ? iso : rangeStart;
  return iso >= a && iso <= b;
}

function renderCalendar() {
  els.monthLabel.textContent = formatMonth(viewMonth);
  const pred = computePrediction();
  const periodPred = predictedDays(pred);
  const fertile = fertileDays(pred);
  const today = todayISO();
  const cells = daysInMonthGrid(viewMonth);
  els.calendar.replaceChildren();

  for (const day of cells) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "day";
    if (!day) {
      btn.disabled = true;
      els.calendar.appendChild(btn);
      continue;
    }
    const iso = toISO(day);
    btn.textContent = String(day.getDate());
    btn.dataset.date = iso;
    btn.setAttribute("role", "gridcell");

    const logged = periodOnDay(iso);
    if (logged) {
      btn.classList.add("logged");
    } else if (periodPred.has(iso)) {
      btn.classList.add("predicted");
    } else if (pred && iso === pred.peakDay) {
      btn.classList.add("peak");
      btn.title = "Most fertile · estimated ovulation";
    } else if (fertile.has(iso)) {
      btn.classList.add("fertile");
      btn.title = "Fertile window";
    }

    if (iso === today) btn.classList.add("today");

    if (rangeStart) {
      if (iso === rangeStart) btn.classList.add("range-edge", "selecting");
      else if (isInSelectingRange(iso)) btn.classList.add("in-range");
    }

    btn.addEventListener("click", () => onDayClick(iso, logged));
    els.calendar.appendChild(btn);
  }

  els.hint.textContent = rangeStart
    ? `Started ${formatShort(rangeStart)}. Tap the last day.`
    : "Tap a day to start a period, then tap the end day.";
}

async function loadLocal() {
  const status = await db.getStatus();
  weightEnabled = status.weight_enabled;
  [periods, weights] = await Promise.all([db.listPeriods(), db.listWeights()]);
  applyWeightVisibility();
  renderCalendar();
  updateStatus();
  renderWeights();
  syncWeightInput();
  renderDataCard();
}

async function onDayClick(iso, logged) {
  if (logged && !rangeStart) {
    openSheet(logged);
    return;
  }

  if (!rangeStart) {
    rangeStart = iso;
    renderCalendar();
    return;
  }

  let start = rangeStart;
  let end = iso;
  if (end < start) [start, end] = [end, start];
  rangeStart = null;

  try {
    await db.createPeriod(start, end);
    await loadLocal();
  } catch (err) {
    els.hint.textContent = err.message || "Could not save period.";
    renderCalendar();
  }
}

function openSheet(period) {
  activePeriodId = period.id;
  els.sheetRange.textContent = `${formatShort(period.start)} to ${formatShort(period.end)}`;
  els.sheet.hidden = false;
  els.sheetBackdrop.hidden = false;
}

function closeSheet() {
  activePeriodId = null;
  els.sheet.hidden = true;
  els.sheetBackdrop.hidden = true;
}

async function migrateFromHosted(pin, wantWeight) {
  const result = await hostedApi("./api/login", {
    method: "POST",
    body: JSON.stringify({ pin }),
  });
  sessionStorage.setItem(HOSTED_TOKEN_KEY, result.token);
  const [remotePeriods, remoteWeights] = await Promise.all([
    hostedApi("./api/periods"),
    hostedApi("./api/weights"),
  ]);
  await db.setupPin(pin, {
    weightEnabled: typeof wantWeight === "boolean" ? wantWeight : remoteWeights.length > 0,
  });
  await db.replaceAll({
    periods: remotePeriods,
    weights: remoteWeights,
  });
}

async function loginHosted(pin) {
  const result = await hostedApi("./api/login", {
    method: "POST",
    body: JSON.stringify({ pin }),
  });
  sessionStorage.setItem(HOSTED_TOKEN_KEY, result.token);
  return result.token;
}

async function moveToNewApp({ pin, remote } = {}) {
  if (pin) await loginHosted(pin);
  let nextPeriods = periods;
  let nextWeights = weights;
  if (remote || (!nextPeriods.length && !nextWeights.length)) {
    const [remotePeriods, remoteWeights] = await Promise.all([
      hostedApi("./api/periods"),
      hostedApi("./api/weights"),
    ]);
    nextPeriods = remotePeriods;
    nextWeights = remoteWeights;
  }
  const result = await hostedApi("./api/migrate", {
    method: "POST",
    body: JSON.stringify({ periods: nextPeriods, weights: nextWeights }),
  });
  if (!result?.url) throw new Error("Could not start the move.");
  location.href = result.url;
}

function consumeMoveToken() {
  const params = new URLSearchParams(location.search);
  const token = params.get("move");
  if (!token) return "";
  const url = new URL(location.href);
  url.searchParams.delete("move");
  history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  return token;
}

async function takeIncomingMove() {
  const token = consumeMoveToken();
  if (!token) return false;
  const res = await fetch(`${OLD_APP_ORIGIN}/api/migrate/${encodeURIComponent(token)}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = "That move link expired. Open the old Cycle and tap Move again.";
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  const data = await res.json();
  const incoming = {
    periods: Array.isArray(data.periods) ? data.periods : [],
    weights: Array.isArray(data.weights) ? data.weights : [],
  };
  const status = await db.getStatus();
  const existing = status.setup_complete
    ? await Promise.all([db.listPeriods(), db.listWeights()])
    : [[], []];
  const [existingPeriods, existingWeights] = existing;
  if (existingPeriods.length || existingWeights.length) {
    const ok = window.confirm(
      "Replace the logs on this phone with the ones from the old Cycle?"
    );
    if (!ok) return false;
  }
  await db.replaceAll(incoming);
  sessionStorage.setItem(MOVED_KEY, "1");
  if (incoming.weights.length) {
    sessionStorage.setItem(MOVED_WEIGHTS_KEY, "1");
    if ((await db.getStatus()).setup_complete) await db.setWeightEnabled(true);
  } else {
    sessionStorage.removeItem(MOVED_WEIGHTS_KEY);
  }
  sessionStorage.removeItem(MOVE_ERROR_KEY);
  return true;
}

function parseGitHubRepo(value) {
  const trimmed = (value || "").trim().replace(/\.git$/, "");
  if (!trimmed) return null;
  const match = trimmed.match(/github\.com\/([^/]+)\/([^/]+)\/?$/i) || trimmed.match(/^([^/]+)\/([^/]+)$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

function mimeFor(path) {
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".js")) return "text/javascript";
  if (path.endsWith(".webmanifest")) return "application/manifest+json";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".html") || path.endsWith("/")) return "text/html; charset=utf-8";
  return "application/octet-stream";
}

async function fetchVersionJson(base) {
  const url = `${base.replace(/\/$/, "")}/version.json?t=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Could not read version.json");
  return { version: await res.json(), base: base.replace(/\/$/, "") };
}

async function loadRemoteVersion(repoUrl) {
  const parsed = parseGitHubRepo(repoUrl);
  if (parsed) {
    const bases = [
      `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/HEAD/cycle`,
      `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/HEAD/apps/cycle`,
      `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/HEAD/static`,
      `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/HEAD`,
    ];
    let lastErr = null;
    for (const base of bases) {
      try {
        return await fetchVersionJson(base);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("Could not load that GitHub repo");
  }
  return fetchVersionJson(new URL("./", document.baseURI).href);
}

async function cacheRemoteFiles(base, files) {
  const cache = await caches.open("cycle-offline");
  await Promise.all(
    (files || []).map(async (file) => {
      const remote = file === "./" ? `${base}/index.html` : `${base}/${file.replace(/^\.\//, "")}`;
      const local = new URL(file === "./" ? "./index.html" : file, document.baseURI);
      const res = await fetch(remote, { cache: "no-store" });
      if (!res.ok) throw new Error(`Could not download ${file}`);
      const body = await res.arrayBuffer();
      await cache.put(
        local.href,
        new Response(body, {
          headers: { "Content-Type": mimeFor(file), "Cache-Control": "public" },
        })
      );
      if (file === "./index.html" || file === "./") {
        await cache.put(
          new URL("./", document.baseURI).href,
          new Response(body, {
            headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public" },
          })
        );
      }
    })
  );
}

async function applyServiceWorkerUpdate() {
  if (!("serviceWorker" in navigator)) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;
  await reg.update();
  if (reg.waiting) {
    reg.waiting.postMessage("skipWaiting");
    return true;
  }
  return false;
}

async function checkForUpdates() {
  setDataMessage("Checking…");
  const repo = els.gitRepo.value.trim();
  localStorage.setItem(GIT_REPO_KEY, repo);
  try {
    const remote = await loadRemoteVersion(repo);
    const remoteVersion = remote.version?.version || "";
    if (repo && remoteVersion && remoteVersion !== appVersion) {
      await cacheRemoteFiles(remote.base, remote.version.files);
      waitingForUpdate = true;
      setDataMessage(`Updated to ${remoteVersion}. Reloading…`);
      const waiting = await applyServiceWorkerUpdate();
      if (!waiting) location.reload();
      return;
    }
    waitingForUpdate = true;
    const waiting = await applyServiceWorkerUpdate();
    if (waiting) {
      setDataMessage("Update found. Reloading…");
      return;
    }
    waitingForUpdate = false;
    if (remoteVersion && remoteVersion === appVersion) {
      setDataMessage(`Already up to date (${appVersion}).`);
      return;
    }
    setDataMessage(remoteVersion ? `App ${remoteVersion} is current.` : "No update found.");
  } catch (err) {
    setDataMessage(err.message || "Could not check for updates.", true);
  }
}

async function exportBackup() {
  const payload = db.buildBackup(periods, weights);
  const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cycle-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setDataMessage("Backup saved.");
}

async function importBackupFile(file) {
  const text = await file.text();
  const parsed = db.parseBackup(text);
  if (periods.length || weights.length) {
    const ok = window.confirm(
      `Replace ${periods.length} periods and ${weights.length} weights on this phone with this backup?`
    );
    if (!ok) {
      setDataMessage("Import cancelled.");
      return;
    }
  }
  const saved = await db.replaceAll(parsed);
  periods = saved.periods;
  weights = saved.weights;
  showTracker();
  setDataMessage(
    `Imported ${periods.length} period${periods.length === 1 ? "" : "s"} and ${weights.length} weight${weights.length === 1 ? "" : "s"}.`
  );
}

async function registerWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("./sw.js");
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (waitingForUpdate) location.reload();
    });
    if (reg.waiting) reg.waiting.postMessage("skipWaiting");
  } catch (err) {
    console.warn("Service worker not registered", err);
  }
}

async function loadAppVersion() {
  try {
    const res = await fetch("./version.json", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    appVersion = data.version || "";
  } catch {
    /* offline with no cached version */
  }
}

async function startApp() {
  els.gitRepo.value = localStorage.getItem(GIT_REPO_KEY) || "";
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

  const status = await db.getStatus();
  if (status.setup_complete) {
    if (status.authenticated) {
      await loadLocal();
      showTracker();
      return;
    }
    showGate("unlock");
    return;
  }

  const hosted = isOldHost() ? await probeHosted() : null;
  if (hosted?.setup_complete) {
    showGate("migrate");
    return;
  }
  showGate("setup");
}

async function bootstrap() {
  registerWorker();
  loadAppVersion().then(() => renderDataCard());
  try {
    await takeIncomingMove();
  } catch (err) {
    sessionStorage.setItem(MOVE_ERROR_KEY, err.message || "Could not copy the old logs.");
  }
  if (shouldShowSave()) {
    showSave();
    return;
  }
  await startApp();
}

let deferredInstall = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstall = event;
  if (els.saveInstall && !els.save.hidden) els.saveInstall.hidden = false;
});

els.saveInstall.addEventListener("click", async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  const choice = await deferredInstall.userChoice;
  deferredInstall = null;
  els.saveInstall.hidden = true;
  if (choice?.outcome === "accepted" && els.saveFind) {
    els.saveFind.textContent = "go find the app on your phone now <3";
  }
});

window.addEventListener("appinstalled", () => {
  if (els.saveInstall) els.saveInstall.hidden = true;
});

els.stayBtn.addEventListener("click", async () => {
  els.pinError.hidden = true;
  const pin = els.pinInput.value.trim();
  if (!/^\d{4,12}$/.test(pin)) {
    els.pinError.textContent = "Use 4-12 digits.";
    els.pinError.hidden = false;
    return;
  }
  try {
    await migrateFromHosted(pin);
    await loadLocal();
    showTracker();
  } catch (err) {
    els.pinError.textContent = err.message || "Could not continue.";
    els.pinError.hidden = false;
  }
});

els.moveBtn.addEventListener("click", async () => {
  if (els.moveError) els.moveError.hidden = true;
  els.moveBtn.disabled = true;
  try {
    await moveToNewApp();
  } catch (err) {
    if (err.status === 401) {
      const pin = window.prompt("Enter your Cycle PIN to move the logs.");
      if (!pin) return;
      try {
        await moveToNewApp({ pin });
        return;
      } catch (retryErr) {
        showMoveError(els.moveError, retryErr);
        return;
      }
    }
    showMoveError(els.moveError, err);
  } finally {
    els.moveBtn.disabled = false;
  }
});

els.pinForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.pinError.hidden = true;
  const pin = els.pinInput.value.trim();
  if (!/^\d{4,12}$/.test(pin)) {
    els.pinError.textContent = "Use 4-12 digits.";
    els.pinError.hidden = false;
    return;
  }
  try {
    if (gateMode === "setup") {
      const wantWeight = els.weightEnabledInput.checked;
      await db.setupPin(pin, { weightEnabled: wantWeight });
      periods = [];
      weights = [];
      weightEnabled = wantWeight;
    } else if (gateMode === "migrate") {
      await moveToNewApp({ pin, remote: true });
      return;
    } else {
      await db.unlockPin(pin);
      if (isOldHost()) {
        try {
          await loginHosted(pin);
        } catch {
          /* local unlock still works */
        }
      }
    }
    await loadLocal();
    showTracker();
  } catch (err) {
    els.pinError.textContent = err.message || "Could not continue.";
    els.pinError.hidden = false;
  }
});

els.lockBtn.addEventListener("click", () => {
  db.lock();
  periods = [];
  weights = [];
  rangeStart = null;
  closeSheet();
  showGate("unlock");
});

els.prevMonth.addEventListener("click", () => {
  viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1);
  renderCalendar();
});

els.nextMonth.addEventListener("click", () => {
  viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);
  renderCalendar();
});

els.weightDate.value = todayISO();
els.weightDate.addEventListener("change", syncWeightInput);

els.weightForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.weightMessage.classList.remove("error");
  const entryDate = els.weightDate.value;
  const weight = Number(els.weightValue.value);
  if (!entryDate || !Number.isFinite(weight) || weight < 25 || weight > 400) {
    els.weightMessage.textContent = "Enter a weight between 25 and 400 kg.";
    els.weightMessage.classList.add("error");
    return;
  }
  try {
    const saved = await db.upsertWeight(entryDate, weight);
    const existingIndex = weights.findIndex((entry) => entry.date === saved.date);
    if (existingIndex >= 0) weights[existingIndex] = saved;
    else weights.push(saved);
    weights.sort((a, b) => a.date.localeCompare(b.date));
    renderWeights();
    renderDataCard();
    els.weightMessage.textContent = "Saved";
    els.weightValue.blur();
  } catch (err) {
    els.weightMessage.textContent = err.message || "Could not save weight.";
    els.weightMessage.classList.add("error");
  }
});

els.toggleWeightChart.addEventListener("click", () => {
  const willShow = els.weightChartWrap.hidden;
  els.weightChartWrap.hidden = !willShow;
  els.toggleWeightChart.textContent = willShow ? "Hide trend" : "Show trend";
  els.toggleWeightChart.setAttribute("aria-expanded", String(willShow));
  if (willShow) renderWeightChart();
});

els.closeSheet.addEventListener("click", closeSheet);
els.sheetBackdrop.addEventListener("click", closeSheet);

els.deletePeriod.addEventListener("click", async () => {
  if (!activePeriodId) return;
  try {
    await db.deletePeriod(activePeriodId);
    closeSheet();
    await loadLocal();
  } catch (err) {
    els.sheetRange.textContent = err.message || "Could not delete.";
  }
});

els.exportBtn.addEventListener("click", () => {
  exportBackup();
});

els.importBtn.addEventListener("click", () => {
  els.importFile.click();
});

els.importFile.addEventListener("change", async () => {
  const file = els.importFile.files?.[0];
  els.importFile.value = "";
  if (!file) return;
  try {
    await importBackupFile(file);
  } catch (err) {
    setDataMessage(err.message || "Could not import that file.", true);
  }
});

els.gitRepo.addEventListener("change", () => {
  localStorage.setItem(GIT_REPO_KEY, els.gitRepo.value.trim());
});

els.updateBtn.addEventListener("click", () => {
  checkForUpdates();
});

els.resetBtn.addEventListener("click", async () => {
  const ok = window.confirm(
    "Delete all periods, weights, and your PIN on this phone? This cannot be undone. Export a backup first if you want to keep it."
  );
  if (!ok) return;
  try {
    await db.wipeAll();
    periods = [];
    weights = [];
    rangeStart = null;
    weightEnabled = false;
    closeSheet();
    applyWeightVisibility();
    showGate("setup");
  } catch (err) {
    setDataMessage(err.message || "Could not delete data.", true);
  }
});

els.toggleWeightFeature.addEventListener("click", async () => {
  try {
    const next = !weightEnabled;
    await db.setWeightEnabled(next);
    weightEnabled = next;
    applyWeightVisibility();
    renderDataCard();
    setDataMessage(next ? "Weight tracking is on." : "Weight tracking is off.");
  } catch (err) {
    setDataMessage(err.message || "Could not update that setting.", true);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (rangeStart) {
      rangeStart = null;
      renderCalendar();
    }
    closeSheet();
  }
});

bootstrap().catch((err) => {
  console.error(err);
  showGate("setup");
  els.gateSubtitle.textContent = "Could not open local storage in this browser.";
});
