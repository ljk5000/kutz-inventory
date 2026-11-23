"use strict";
// Reads the game client's quest cache, Cache/WDB/<locale>/questcache.wdb: the client's copy of the quest query answers the
// server sent it, one record per quest the client has been shown. Dependency-free (no Node APIs either): give it the file's
// bytes, get quest facts back, or a refusal with a reason and no rows.
//
// File (little-endian):
//   0  magic, the bytes "TSQW" ("WQST" read as a 32-bit number)
//   4  client build (u32)
//   8  locale, four bytes reversed ("SUne" is enUS)
//   12 three more u32 fields: 0x3008, 12, 0 on every supported build
//   24 records: quest id (u32), size (u32), then size bytes; an all-zero pair ends the file, and nothing follows it.
//
// A record is the quest query response's body. Its fixed block (the first FIXED_BYTES bytes) holds 32-bit fields at fixed
// offsets; quest text, objectives and the rest follow it with variable lengths and are never read. Only the offsets below
// are read, each checked against Blizzard's quest API, EG Link's quest files, QuestieDB and the client's own tables
// (QuestXP, QuestMoneyReward, QuestFactionReward, ItemSparse, SpellName, SpellEffect) for builds 70938 and 71037
// (schema/README.md, "Quest cache"). Fields that could not be confirmed are not read at all.
//
// Refusals: a file whose magic, build, header fields or record sizes are not what a supported build must have, a record
// whose id disagrees with its body or that is smaller than the fixed block, a truncated or over-long file, an absurd count,
// or a value outside the range the layout allows (a sign that the layout is not the one this module knows).

const QUEST_CACHE_SCHEMA_VERSION = "1.0.0";

const MAGIC = [0x54, 0x53, 0x51, 0x57]; // "TSQW"
const HEADER_BYTES = 24;
const FIXED_BYTES = 488;            // the fixed block of build 70938 / 71037 records (smallest record seen: 518 bytes)
const MAX_RECORD_BYTES = 65536;     // largest seen: 1,521 bytes
const MAX_RECORDS = 200000;         // the whole game has about 100,000 quest ids
const MAX_FILE_BYTES = 64 * 1024 * 1024;

// Byte offsets inside a record of the supported builds (the client's quest query response of this generation).
const LAYOUT = Object.freeze({
  id: 0,             // QuestID, equal to the record's id
  level: 8,          // QuestLevel
  minLevel: 16,      // QuestMinLevel
  sort: 24,          // QuestSortID: a positive AreaTable id (zone) or a negative QuestSort id
  info: 28,          // QuestInfoID (QuestInfo table: 1 Elite, 41 PvP, 62 Raid, 81 Dungeon, ...)
  next: 36,          // RewardNextQuest
  xpDifficulty: 40,  // RewardXPDifficulty: a column of the client's QuestXP table
  xpMultiplier: 44,  // RewardXPMultiplier (float)
  money: 48,         // RewardMoney, copper
  spell: 68,         // RewardSpell: the spell cast on the character at turn-in
  startItem: 96,     // StartItem: the item handed over when the quest is accepted
  items: 116,        // 4 x { item id, amount, drop item id, drop amount }, 16 bytes each
  choices: 180,      // 6 x { item id, quantity, display id }, 12 bytes each
  reputation: 300,   // 5 x { faction id, value, override, cap }, 16 bytes each
  currencies: 384,   // 4 x { currency id, amount }, 8 bytes each
});

// Builds whose layout was verified against the real file. Each must also have these three header fields.
const BUILDS = Object.freeze({
  70938: Object.freeze({ header: Object.freeze([0x3008, 12, 0]), fixedBytes: FIXED_BYTES }),
  71037: Object.freeze({ header: Object.freeze([0x3008, 12, 0]), fixedBytes: FIXED_BYTES }),
});
const SUPPORTED_BUILDS = Object.freeze(Object.keys(BUILDS).map(Number).sort((a, b) => a - b));

const I32_MAX = 2147483647;
const refuse = (reason) => ({ ok: false, reason });

// The float is a 32-bit one: 2.0999999046 is 2.1 as the server's data has it.
const float32 = (view, at) => Number(view.getFloat32(at, true).toPrecision(6));

function readQuest(view, base, id) {
  const i32 = (at) => view.getInt32(base + at, true);
  const L = LAYOUT;
  const q = {
    id,
    level: i32(L.level),
    minLevel: i32(L.minLevel),
    sort: i32(L.sort),
  };
  const info = i32(L.info); if (info) q.info = info;
  const next = i32(L.next); if (next) q.next = next;
  q.xpDifficulty = i32(L.xpDifficulty);
  q.xpMultiplier = float32(view, base + L.xpMultiplier);
  q.money = i32(L.money);
  const spell = i32(L.spell); if (spell) q.spell = spell;
  const startItem = i32(L.startItem); if (startItem) q.startItem = startItem;
  const items = [];
  for (let k = 0; k < 4; k++) {
    const at = L.items + k * 16, item = i32(at);
    if (item) items.push({ id: item, n: i32(at + 4) });
  }
  if (items.length) q.items = items;
  const choose = [];
  for (let k = 0; k < 6; k++) {
    const at = L.choices + k * 12, item = i32(at);
    if (item) choose.push({ id: item, n: i32(at + 4) });
  }
  if (choose.length) q.choose = choose;
  const rep = [];
  for (let k = 0; k < 5; k++) {
    const at = L.reputation + k * 16, faction = i32(at);
    if (!faction) continue;
    const row = { faction, tier: i32(at + 4) };
    const override = i32(at + 8); if (override) row.override = override;
    rep.push(row);
  }
  if (rep.length) q.rep = rep;
  const currencies = [];
  for (let k = 0; k < 4; k++) {
    const at = L.currencies + k * 8, currency = i32(at);
    if (currency) currencies.push({ id: currency, n: i32(at + 4) });
  }
  if (currencies.length) q.currencies = currencies;
  return q;
}

// The ranges the layout allows. A value outside them means the bytes are not what this module thinks they are.
function implausible(q) {
  const between = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const ref = (v) => v === undefined || between(v, 1, I32_MAX);
  if (!between(q.level, -1, 255)) return "level " + q.level;
  if (!between(q.minLevel, 0, 255)) return "minimum level " + q.minLevel;
  if (!between(q.xpDifficulty, 0, 9)) return "XP difficulty " + q.xpDifficulty;
  if (!Number.isFinite(q.xpMultiplier) || q.xpMultiplier < 0 || q.xpMultiplier > 100) return "XP multiplier " + q.xpMultiplier;
  if (!ref(q.info) || !ref(q.next) || !ref(q.spell) || !ref(q.startItem)) return "a negative id";
  for (const list of [q.items, q.choose, q.currencies]) {
    for (const r of list || []) if (!between(r.id, 1, I32_MAX) || !between(r.n, 0, 1000000)) return "an amount of " + r.n;
  }
  for (const r of q.rep || []) if (!between(r.faction, 1, I32_MAX) || !between(r.tier, -9, 9)) return "a reputation value of " + r.tier;
  return null;
}

// bytes: a Uint8Array (a Node Buffer is one). options.locale: the folder the file was found in; the header must agree.
// -> { ok: true, build, locale, total, quests } with quests sorted by id, or { ok: false, reason }.
function parseQuestCache(bytes, options = {}) {
  if (!bytes || typeof bytes.byteLength !== "number") return refuse("not a file's bytes");
  if (bytes.byteLength > MAX_FILE_BYTES) return refuse("the file is larger than any quest cache (" + bytes.byteLength + " bytes)");
  if (bytes.byteLength < HEADER_BYTES + 8) return refuse("the file is too short for a quest cache header");
  for (let i = 0; i < 4; i++) if (bytes[i] !== MAGIC[i]) return refuse("not a quest cache (wrong magic)");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const build = view.getUint32(4, true);
  const layout = Object.prototype.hasOwnProperty.call(BUILDS, build) ? BUILDS[build] : null;
  if (!layout) return refuse("client build " + build + " is not a supported build (" + SUPPORTED_BUILDS.join(", ") + ")");
  const locale = String.fromCharCode(bytes[11], bytes[10], bytes[9], bytes[8]);
  if (!/^[a-z]{2}[A-Z]{2}$/.test(locale)) return refuse("the header's locale is not a locale");
  if (options.locale !== undefined && options.locale !== locale) return refuse("the header's locale " + locale + " is not its folder's (" + options.locale + ")");
  for (let i = 0; i < 3; i++) {
    const got = view.getUint32(12 + i * 4, true);
    if (got !== layout.header[i]) return refuse("header field " + (i + 4) + " is " + got + ", build " + build + " has " + layout.header[i]);
  }
  const quests = [];
  const seen = new Set();
  let at = HEADER_BYTES;
  for (;;) {
    if (at + 8 > bytes.byteLength) return refuse("the file ends before its end marker (truncated)");
    const id = view.getUint32(at, true), size = view.getUint32(at + 4, true);
    at += 8;
    if (id === 0 && size === 0) break;
    if (id === 0 || id > I32_MAX) return refuse("a record has quest id " + id);
    if (size < layout.fixedBytes) return refuse("quest " + id + "'s record is " + size + " bytes, smaller than the " + layout.fixedBytes + "-byte fixed block");
    if (size > MAX_RECORD_BYTES) return refuse("quest " + id + "'s record is " + size + " bytes, larger than any quest record");
    if (at + size > bytes.byteLength) return refuse("quest " + id + "'s record runs past the end of the file (truncated)");
    if (view.getUint32(at + LAYOUT.id, true) !== id) return refuse("quest " + id + "'s record holds another quest id");
    if (seen.has(id)) return refuse("quest " + id + " has two records");
    seen.add(id);
    if (seen.size > MAX_RECORDS) return refuse("more than " + MAX_RECORDS + " records");
    const q = readQuest(view, at, id);
    const bad = implausible(q);
    if (bad) return refuse("quest " + id + " has " + bad + ", which this layout does not allow");
    quests.push(q);
    at += size;
  }
  if (at !== bytes.byteLength) return refuse((bytes.byteLength - at) + " bytes follow the end marker");
  quests.sort((a, b) => a.id - b.id);
  return { ok: true, build, locale, total: quests.length, quests };
}

// The documents for one locale file: header fields once per document, at most perDocument quests each, sorted by id.
// quests: the rows to send (a subset of parsed.quests); total stays the number of quests in the cache.
function questCacheDocuments(parsed, quests, { companion, perDocument = 500 } = {}) {
  const rows = [...quests].sort((a, b) => a.id - b.id);
  const docs = [];
  for (let i = 0; i < rows.length; i += perDocument) {
    docs.push({
      schemaVersion: QUEST_CACHE_SCHEMA_VERSION, kind: "quest-cache", build: parsed.build, locale: parsed.locale,
      supportedBuilds: [...SUPPORTED_BUILDS], companion: String(companion || ""), total: parsed.total,
      quests: rows.slice(i, i + perDocument),
    });
  }
  return docs;
}

module.exports = {
  QUEST_CACHE_SCHEMA_VERSION, SUPPORTED_BUILDS, LAYOUT, FIXED_BYTES,
  parseQuestCache, questCacheDocuments,
};
