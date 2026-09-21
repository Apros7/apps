/** On-device storage for Cycle: IndexedDB + PIN hashing. */

const DB_NAME = "cycle";
const DB_VERSION = 1;
const UNLOCKED_KEY = "cycle_unlocked";
const PIN_ATTEMPTS_KEY = "cycle_pin_attempts";
const PIN_WINDOW_MS = 15 * 60 * 1000;
const PIN_MAX_ATTEMPTS = 8;
const PBKDF2_ITERATIONS = 150_000;

export class StorageError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function fail(message, status = 400) {
  throw new StorageError(message, status);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      if (!db.objectStoreNames.contains("periods")) {
        db.createObjectStore("periods", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("weights")) {
        db.createObjectStore("weights", { keyPath: "date" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function bytesToB64(bytes) {
  let bin = "";
  const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derivePinHash(pin, saltBytes, iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations },
    key,
    256
  );
  return bytesToB64(bits);
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isUnlocked() {
  return sessionStorage.getItem(UNLOCKED_KEY) === "1";
}

export function setUnlocked(value) {
  if (value) sessionStorage.setItem(UNLOCKED_KEY, "1");
  else sessionStorage.removeItem(UNLOCKED_KEY);
}

function checkPinRateLimit() {
  const now = Date.now();
  let attempts = [];
  try {
    attempts = JSON.parse(localStorage.getItem(PIN_ATTEMPTS_KEY) || "[]");
  } catch {
    attempts = [];
  }
  attempts = attempts.filter((ts) => now - ts < PIN_WINDOW_MS);
  if (attempts.length >= PIN_MAX_ATTEMPTS) {
    localStorage.setItem(PIN_ATTEMPTS_KEY, JSON.stringify(attempts));
    fail("Too many PIN attempts. Try again in a few minutes.", 429);
  }
  attempts.push(now);
  localStorage.setItem(PIN_ATTEMPTS_KEY, JSON.stringify(attempts));
}

export async function getConfig() {
  const db = await openDb();
  return (await requestToPromise(db.transaction("meta").objectStore("meta").get("config"))) || null;
}

export function isWeightEnabled(config) {
  if (typeof config?.weight_enabled === "boolean") return config.weight_enabled;
  return true;
}

export async function getStatus() {
  const config = await getConfig();
  return {
    setup_complete: Boolean(config?.hash),
    authenticated: isUnlocked(),
    weight_enabled: isWeightEnabled(config),
  };
}

export async function patchConfig(patch) {
  const config = (await getConfig()) || {};
  const next = { ...config, ...patch };
  const db = await openDb();
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put(next, "config");
  await txDone(tx);
  return next;
}

export async function setWeightEnabled(enabled) {
  await patchConfig({ weight_enabled: Boolean(enabled) });
}

export async function setupPin(pin, options = {}) {
  if (!/^\d{4,12}$/.test(pin)) fail("PIN must be 4-12 digits");
  checkPinRateLimit();
  if ((await getConfig())?.hash) fail("PIN already set");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePinHash(pin, salt);
  const config = {
    salt: bytesToB64(salt),
    hash,
    iterations: PBKDF2_ITERATIONS,
    created_at: new Date().toISOString(),
    weight_enabled: Boolean(options.weightEnabled),
  };
  const db = await openDb();
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put(config, "config");
  await txDone(tx);
  setUnlocked(true);
}

export async function unlockPin(pin) {
  if (!/^\d{4,12}$/.test(pin)) fail("PIN must be 4-12 digits");
  checkPinRateLimit();
  const config = await getConfig();
  if (!config?.hash) fail("PIN not set yet");
  const hash = await derivePinHash(pin, b64ToBytes(config.salt), config.iterations || PBKDF2_ITERATIONS);
  if (hash !== config.hash) fail("Incorrect PIN", 401);
  setUnlocked(true);
}

export function lock() {
  setUnlocked(false);
}

export async function wipeAll() {
  const db = await openDb();
  const names = [...db.objectStoreNames];
  if (names.length) {
    const tx = db.transaction(names, "readwrite");
    for (const name of names) tx.objectStore(name).clear();
    await txDone(tx);
  }
  db.close();
  setUnlocked(false);
  localStorage.removeItem(PIN_ATTEMPTS_KEY);
}

export async function listPeriods() {
  const db = await openDb();
  const rows = (await requestToPromise(db.transaction("periods").objectStore("periods").getAll())) || [];
  return rows.sort((a, b) => a.start.localeCompare(b.start));
}

export async function listWeights() {
  const db = await openDb();
  const rows = (await requestToPromise(db.transaction("weights").objectStore("weights").getAll())) || [];
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export async function createPeriod(start, end) {
  if (!isIsoDate(start) || !isIsoDate(end)) fail("Invalid dates");
  if (end < start) fail("end must be on or after start");
  const periods = await listPeriods();
  for (const existing of periods) {
    if (rangesOverlap(start, end, existing.start, existing.end)) {
      fail("Overlaps an existing period");
    }
  }
  const period = { id: crypto.randomUUID(), start, end };
  const db = await openDb();
  const tx = db.transaction("periods", "readwrite");
  tx.objectStore("periods").put(period);
  await txDone(tx);
  return period;
}

export async function deletePeriod(id) {
  const periods = await listPeriods();
  if (!periods.some((period) => period.id === id)) fail("Period not found", 404);
  const db = await openDb();
  const tx = db.transaction("periods", "readwrite");
  tx.objectStore("periods").delete(id);
  await txDone(tx);
}

export async function upsertWeight(entryDate, weightKg) {
  if (!isIsoDate(entryDate)) fail("Invalid date");
  const value = Number(weightKg);
  if (!Number.isFinite(value) || value < 25 || value > 400) {
    fail("Enter a weight between 25 and 400 kg.");
  }
  const entry = { date: entryDate, weight_kg: Math.round(value * 100) / 100 };
  const db = await openDb();
  const tx = db.transaction("weights", "readwrite");
  tx.objectStore("weights").put(entry);
  await txDone(tx);
  return entry;
}

function normalizePeriods(raw) {
  if (!Array.isArray(raw)) fail("Backup is missing periods");
  const periods = raw.map((item) => {
    const start = item?.start;
    const end = item?.end;
    if (!isIsoDate(start) || !isIsoDate(end)) fail("Backup has an invalid period date");
    if (end < start) fail("Backup has a period that ends before it starts");
    return {
      id: typeof item.id === "string" && item.id ? item.id : crypto.randomUUID(),
      start,
      end,
    };
  });
  const sorted = periods.sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (rangesOverlap(sorted[i].start, sorted[i].end, sorted[j].start, sorted[j].end)) {
        fail("Backup has overlapping periods");
      }
    }
  }
  return sorted;
}

function normalizeWeights(raw) {
  if (!Array.isArray(raw)) fail("Backup is missing weights");
  const byDate = new Map();
  for (const item of raw) {
    if (!isIsoDate(item?.date)) fail("Backup has an invalid weight date");
    const value = Number(item.weight_kg);
    if (!Number.isFinite(value) || value < 25 || value > 400) {
      fail("Backup has an invalid weight");
    }
    byDate.set(item.date, { date: item.date, weight_kg: Math.round(value * 100) / 100 });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function replaceAll({ periods, weights }) {
  const nextPeriods = normalizePeriods(periods);
  const nextWeights = normalizeWeights(weights);
  const db = await openDb();
  const tx = db.transaction(["periods", "weights"], "readwrite");
  tx.objectStore("periods").clear();
  tx.objectStore("weights").clear();
  for (const period of nextPeriods) tx.objectStore("periods").put(period);
  for (const entry of nextWeights) tx.objectStore("weights").put(entry);
  await txDone(tx);
  return { periods: nextPeriods, weights: nextWeights };
}

export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    fail("That file is not valid JSON");
  }
  if (!data || typeof data !== "object") fail("That file is not a Cycle backup");
  if (data.app && data.app !== "cycle") fail("That file is not a Cycle backup");
  if (!Array.isArray(data.periods) && !Array.isArray(data.weights)) {
    fail("That file is not a Cycle backup");
  }
  return {
    periods: Array.isArray(data.periods) ? data.periods : [],
    weights: Array.isArray(data.weights) ? data.weights : [],
  };
}

export function buildBackup(periods, weights) {
  return {
    app: "cycle",
    format: 1,
    exported_at: new Date().toISOString(),
    periods,
    weights,
  };
}
