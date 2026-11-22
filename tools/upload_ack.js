"use strict";
// Remembers what the upload service acknowledged for observations and trims already-received
// entries before an export enters the outbox. Never stores credentials.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const STATE_VERSION = 1;
const EVENT_ID_RE = /^([0-9a-z]{4,16})-([0-9]{1,12})$/;
const PREFIX_RE = /^[0-9a-z]{4,16}$/;
const EPOCH_MIN = 1;
const EPOCH_MAX = 1e9;
const COUNTER_MIN = 0;
const COUNTER_MAX = 999999999999;
const DAY_MIN = 1;
const DAY_MAX = 1157407;
const MAX_PREFIXES = 64;

const isIntInRange = (value, min, max) =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

function setOwn(target, key, value) {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

function normalizeOrigin(origin) {
  try { return new URL(String(origin || "")).origin; } catch { return String(origin || ""); }
}

// SHA-256 hex digest binding marks to one site, account, saved-file set, schema and Companion version.
function ackContext({ origin, username, files, schemaVersion, companionVersion }) {
  const sortedFiles = [...(Array.isArray(files) ? files : [])].map(String).sort();
  const payload = JSON.stringify([
    normalizeOrigin(origin),
    typeof username === "string" ? username : "",
    sortedFiles,
    typeof schemaVersion === "string" ? schemaVersion : "",
    typeof companionVersion === "string" ? companionVersion : "",
  ]);
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

// Sanitizes an untrusted ack object (or stored marks). Returns null when nothing valid is present.
function parseAck(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const epoch = isIntInRange(raw.epoch, EPOCH_MIN, EPOCH_MAX) ? raw.epoch : undefined;
  const day = isIntInRange(raw.day, DAY_MIN, DAY_MAX) ? raw.day : undefined;
  const events = {};
  let count = 0;
  if (raw.events && typeof raw.events === "object" && !Array.isArray(raw.events)) {
    for (const [prefix, counter] of Object.entries(raw.events)) {
      if (count >= MAX_PREFIXES) break;
      if (!PREFIX_RE.test(prefix) || !isIntInRange(counter, COUNTER_MIN, COUNTER_MAX)) continue;
      setOwn(events, prefix, counter);
      count++;
    }
  }
  if (epoch === undefined && day === undefined && count === 0) return null;
  const marks = { events };
  if (epoch !== undefined) marks.epoch = epoch;
  if (day !== undefined) marks.day = day;
  return marks;
}

// Combines previously remembered marks with a new server ack.
// If the server changed epoch after a trimmed upload, drop all marks and remember only the new epoch
// so the next upload carries everything once.
function mergeMarks(prevMarks, rawAck, { trimmed = false } = {}) {
  const prev = parseAck(prevMarks);
  const ack = parseAck(rawAck);
  if (!ack) return prev;

  const prevEpoch = prev ? prev.epoch : undefined;
  const ackEpoch = ack.epoch;

  if (ackEpoch !== undefined && ackEpoch !== prevEpoch) {
    if (trimmed) return { epoch: ackEpoch, events: {} };
    if (prevEpoch !== undefined) {
      // Untrimmed upload succeeded under a new epoch: keep only what the server acked for this epoch.
      const fresh = { epoch: ackEpoch, events: {} };
      for (const [prefix, counter] of Object.entries(ack.events)) setOwn(fresh.events, prefix, counter);
      if (ack.day !== undefined) fresh.day = ack.day;
      return fresh;
    }
  }

  const epoch = ackEpoch !== undefined ? ackEpoch : prevEpoch;
  const events = {};
  let count = 0;
  for (const [prefix, counter] of Object.entries(ack.events)) {
    if (count >= MAX_PREFIXES) break;
    const oldCounter = prev && Object.hasOwn(prev.events, prefix) ? prev.events[prefix] : undefined;
    setOwn(events, prefix, oldCounter !== undefined ? Math.max(oldCounter, counter) : counter);
    count++;
  }
  if (prev) {
    for (const [prefix, counter] of Object.entries(prev.events)) {
      if (count >= MAX_PREFIXES) break;
      if (Object.hasOwn(events, prefix)) continue;
      setOwn(events, prefix, counter);
      count++;
    }
  }

  let day;
  if (prev && prev.day !== undefined && ack.day !== undefined) day = Math.max(prev.day, ack.day);
  else if (ack.day !== undefined) day = ack.day;
  else if (prev && prev.day !== undefined) day = prev.day;

  const next = { events };
  if (epoch !== undefined) next.epoch = epoch;
  if (day !== undefined) next.day = day;
  return next;
}

// Returns a new export object with already-acknowledged observations omitted, never mutating input.
// Returns data unchanged when there are no valid marks or nothing is omitted.
function trimExport(data, marks) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const obs = data.observations;
  if (!obs || typeof obs !== "object" || Array.isArray(obs)) return data;
  const valid = parseAck(marks);
  if (!valid) return data;

  const markedEvents = valid.events;
  const hasEventMarks = Object.keys(markedEvents).length > 0;
  const markedDay = valid.day;
  if (!hasEventMarks && markedDay === undefined) return data;

  let changed = false;
  const nextObs = { ...obs };

  if (hasEventMarks && Array.isArray(obs.events) && obs.events.length > 0) {
    const maxByPrefix = Object.create(null);
    for (const ev of obs.events) {
      if (!ev || typeof ev.id !== "string") continue;
      const m = EVENT_ID_RE.exec(ev.id);
      if (!m) continue;
      const prefix = m[1], counter = Number(m[2]);
      if (maxByPrefix[prefix] === undefined || counter > maxByPrefix[prefix]) {
        maxByPrefix[prefix] = counter;
      }
    }
    const kept = obs.events.filter(ev => {
      if (!ev || typeof ev.id !== "string") return true;
      const m = EVENT_ID_RE.exec(ev.id);
      if (!m) return true;
      const prefix = m[1], counter = Number(m[2]);
      if (!Object.hasOwn(markedEvents, prefix)) return true;
      const mark = markedEvents[prefix];
      // A saved file restored from backup has highest counter < mark: keep all of that prefix's events.
      if (maxByPrefix[prefix] < mark) return true;
      return counter > mark;
    });
    if (kept.length !== obs.events.length) {
      nextObs.events = kept;
      changed = true;
    }
  }

  if (markedDay !== undefined) {
    const keepDay = entry => !(entry && Number.isInteger(entry.day) && entry.day < markedDay);
    if (Array.isArray(obs.npcs)) {
      const kept = obs.npcs.filter(keepDay);
      if (kept.length !== obs.npcs.length) {
        changed = true;
        if (kept.length === 0) {
          delete nextObs.npcs;
          delete nextObs.install;
        } else {
          nextObs.npcs = kept;
        }
      }
    }
    if (Array.isArray(obs.items)) {
      const kept = obs.items.filter(keepDay);
      if (kept.length !== obs.items.length) {
        changed = true;
        if (kept.length === 0) {
          delete nextObs.items;
        } else {
          nextObs.items = kept;
        }
      }
    }
    if (Array.isArray(obs.kills)) {
      const kept = obs.kills.filter(keepDay);
      if (kept.length !== obs.kills.length) {
        changed = true;
        if (kept.length === 0) {
          delete nextObs.kills;
          delete nextObs.killsInstall;
        } else {
          nextObs.kills = kept;
        }
      }
    }
  }

  if (!changed) return data;

  const hasEvents = Array.isArray(nextObs.events) && nextObs.events.length > 0;
  const hasNpcs = Array.isArray(nextObs.npcs) && nextObs.npcs.length > 0;
  const hasItems = Array.isArray(nextObs.items) && nextObs.items.length > 0;
  const hasKills = Array.isArray(nextObs.kills) && nextObs.kills.length > 0;

  if (!hasEvents && !hasNpcs && !hasItems && !hasKills) {
    const out = { ...data };
    delete out.observations;
    return out;
  }
  return { ...data, observations: nextObs };
}

function readAckState(file, expectedContext) {
  if (!file || typeof expectedContext !== "string" || !expectedContext) return null;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (raw.v !== STATE_VERSION) return null;
  if (typeof raw.context !== "string" || raw.context !== expectedContext) return null;
  return parseAck(raw);
}

function writeAckState(file, context, marks) {
  const valid = parseAck(marks);
  if (!valid || typeof context !== "string" || !context) return;
  const state = { v: STATE_VERSION, context, ...valid };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  try {
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

module.exports = {
  STATE_VERSION,
  EVENT_ID_RE,
  ackContext,
  parseAck,
  mergeMarks,
  trimExport,
  readAckState,
  writeAckState,
};
