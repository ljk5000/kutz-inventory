"use strict";
// Sends the game client's quest cache (Cache/WDB/<locale>/questcache.wdb under the game folder) to cr0m's
// POST /api/wow/quest-cache as quest-cache documents (schema/quest-cache.schema.json), only the quests that are new or
// changed since the server last accepted them. Reads each cache file once per run and never writes under the game folder.
//
// State file (no credentials), beside the other upload state as <output>.quest-cache-sent.json:
//   { "v": 1, "context": "<sha256 of site origin, account and schema version>",
//     "sets": { "<build>|<locale>": { "quests": { "<id>": "<12 hex: the row as sent>" }, "rejected": { "<16 hex>": "<reason>" } } } }
// A quest is sent when its row's hash is new or different. Hashes are recorded only after a 2xx. A new build or locale,
// another site or account, a new schema version, or a missing or unreadable state file sends everything again.
//
// Answers:
//   - 2xx: the document's rows are recorded as sent.
//   - 404 / 405: the site does not take quest caches yet. One log line, nothing recorded, nothing else sent this run;
//     the caller stops asking for the rest of its session (no retry storm, no error state).
//   - 400 / 413 / 422: this document will never be accepted. Its fingerprint (rows and Companion version) is recorded as
//     rejected and it is not sent again; its rows are not recorded as sent, so a changed row or a newer Companion tries again.
//   - 401 / 403 (the key, or cr0m's account refusals) and 426 (this Companion is too old): thrown, like the auction sender,
//     so the caller treats them as it treats the same answers to the other uploads.
//   - 429 waits Retry-After (at most a minute) and tries again, up to 3 times.
//   - Anything else (5xx, no connection, a pause, an invalid acknowledgement): one log line and nothing recorded; the next
//     run (the next save, or the next start) tries again. It never fails the run.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseQuestCache, questCacheDocuments, QUEST_CACHE_SCHEMA_VERSION } = require("./questcache");

const STATE_VERSION = 1;
const MAX_REJECTED = 32;
const LOCALE_RE = /^[a-z]{2}[A-Z]{2}$/;
const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");
const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeOrigin(origin) {
  try { return new URL(String(origin || "")).origin; } catch { return String(origin || ""); }
}
// Binds the remembered hashes to one site, one account and one schema version. No key goes into it.
function questCacheContext({ origin, username }) {
  return sha256(JSON.stringify([normalizeOrigin(origin), typeof username === "string" ? username : "", QUEST_CACHE_SCHEMA_VERSION]));
}
const rowHash = (row) => sha256(JSON.stringify(row)).slice(0, 12);

// -> [{ file, locale }] for every Cache/WDB/<locale>/questcache.wdb under the game folder, sorted by locale.
function findQuestCaches(game) {
  const root = path.join(String(game || ""), "Cache", "WDB");
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return entries.filter((e) => e.isDirectory() && LOCALE_RE.test(e.name)).map((e) => e.name).sort()
    .map((locale) => ({ locale, file: path.join(root, locale, "questcache.wdb") }))
    .filter((c) => { try { return fs.statSync(c.file).isFile(); } catch { return false; } });
}

// Reads a cache once, read-only. The game rewrites it while it runs and at exit: a file it cannot open, or one that
// changes while it is read, is skipped for this run.
function readOnce(file) {
  try {
    const before = fs.statSync(file);
    const bytes = fs.readFileSync(file);
    const after = fs.statSync(file);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== after.size) return { reason: "the game was writing it" };
    return { bytes };
  } catch (error) {
    return { reason: "it could not be read (" + ((error && error.code) || "error") + ")" };
  }
}

const passThrough = (error) => error && (error.status === 401 || error.status === 403 || error.status === 426 || error.resumable === true);

function createQuestCacheSender(stateFile, post, { context, companion, perDocument = 500, minGapMs = 10500, sleep = realSleep, log = () => {} } = {}) {
  if (typeof context !== "string" || !context) throw new Error("The quest cache sender needs a context.");
  let lastSentAt = 0;
  function read() {
    try {
      const raw = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      if (raw && raw.v === STATE_VERSION && raw.context === context && raw.sets && typeof raw.sets === "object" && !Array.isArray(raw.sets)) return raw;
    } catch { /* missing or unreadable: send everything again */ }
    return { v: STATE_VERSION, context, sets: {} };
  }
  function write(state) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    const tmp = stateFile + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    try { fs.renameSync(tmp, stateFile); } catch (error) { try { fs.unlinkSync(tmp); } catch {} throw error; }
  }
  async function paced(doc) {
    for (let attempt = 1; ; attempt++) {
      const wait = lastSentAt + minGapMs - Date.now();
      if (lastSentAt && wait > 0) await sleep(wait);
      lastSentAt = Date.now();
      try { return await post(doc); }
      catch (error) {
        if (error && error.status === 429 && attempt < 3) {
          await sleep(Math.min(60, Math.max(1, Number(error.retryAfter) || 10)) * 1000);
          continue;
        }
        throw error;
      }
    }
  }
  return {
    // game: the game client folder (the one holding WTF, Interface and Cache).
    // -> { caches, sent, unchanged, skipped: [{ locale, reason }], rejected: [{ locale, reason }], unsupported, failed }
    async send(game) {
      const out = { caches: 0, sent: 0, unchanged: 0, skipped: [], rejected: [], unsupported: false, failed: null };
      const caches = findQuestCaches(game);
      if (!caches.length) return out;
      const state = read();
      let dirty = false;
      const save = () => { if (dirty) { try { write(state); } catch { /* not saved: those rows are sent again next time */ } dirty = false; } };
      for (const cache of caches) {
        const got = readOnce(cache.file);
        let parsed = null;
        if (got.bytes) {
          try { parsed = parseQuestCache(got.bytes, { locale: cache.locale }); }
          catch { parsed = { ok: false, reason: "it could not be parsed" }; }
        }
        if (!parsed || !parsed.ok) {
          const reason = got.reason || parsed.reason;
          out.skipped.push({ locale: cache.locale, reason });
          log(`Quest cache ${cache.locale} not sent: ${reason}.`);
          continue;
        }
        out.caches++;
        const key = parsed.build + "|" + parsed.locale;
        // Another build of this locale: that build's hashes say nothing about this one.
        for (const other of Object.keys(state.sets)) if (other !== key && other.endsWith("|" + parsed.locale)) { delete state.sets[other]; dirty = true; }
        const known = state.sets[key] && typeof state.sets[key] === "object" ? state.sets[key] : {};
        const set = {
          quests: known.quests && typeof known.quests === "object" && !Array.isArray(known.quests) ? known.quests : {},
          rejected: known.rejected && typeof known.rejected === "object" && !Array.isArray(known.rejected) ? known.rejected : {},
        };
        state.sets[key] = set;
        const hashes = new Map(parsed.quests.map((q) => [q.id, rowHash(q)]));
        const changed = parsed.quests.filter((q) => set.quests[q.id] !== hashes.get(q.id));
        out.unchanged += parsed.quests.length - changed.length;
        for (const doc of questCacheDocuments(parsed, changed, { companion, perDocument })) {
          const fingerprint = sha256(JSON.stringify([companion, doc.quests])).slice(0, 16);
          if (Object.hasOwn(set.rejected, fingerprint)) continue;
          try {
            await paced(doc);
          } catch (error) {
            const status = error && error.status;
            if (status === 404 || status === 405) {
              out.unsupported = true;
              log(`The site does not take quest caches yet (HTTP ${status}); nothing was recorded.`);
              save(); return out;
            }
            if (status === 400 || status === 413 || status === 422) {
              const reason = `HTTP ${status}${error.detail ? ": " + error.detail : ""}`;
              const kept = Object.entries(set.rejected).slice(-(MAX_REJECTED - 1));
              set.rejected = Object.fromEntries([...kept, [fingerprint, reason]]);
              state.sets[key] = set; dirty = true;
              out.rejected.push({ locale: parsed.locale, reason });
              log(`Quest cache ${parsed.locale} (${doc.quests.length} quests) was rejected (${reason}); a changed quest will be tried again.`);
              save(); continue;
            }
            save();
            if (passThrough(error)) throw error;
            out.failed = (error && error.message) || "upload failed";
            log(`Quest cache ${parsed.locale} was not sent (${out.failed}); the next run tries again.`);
            return out;
          }
          for (const q of doc.quests) set.quests[q.id] = hashes.get(q.id);
          out.sent += doc.quests.length; dirty = true;
          save();
        }
        save();
      }
      return out;
    },
  };
}

module.exports = { createQuestCacheSender, questCacheContext, findQuestCaches, rowHash, STATE_VERSION };
