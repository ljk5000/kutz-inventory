"use strict";
// The quest cache reader (tools/questcache.js) on a fixture cut from a real build 71037 enUS questcache.wdb.
//
// tools/fixtures/questcache-71037-enUS.wdb: the real 24-byte header and eight whole records (quests 257, 1003, 1097, 2359,
// 8372, 78150, 94238, 98372) with their real sizes and their real 488-byte fixed blocks. Each record's variable part (quest
// text and objectives, never read) is replaced by a repeated synthetic sentence of the same length, so the repository holds
// no game text, and the tests can prove no text reaches a document.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { parseQuestCache, questCacheDocuments, SUPPORTED_BUILDS, QUEST_CACHE_SCHEMA_VERSION, FIXED_BYTES } = require("./questcache");
const { validateQuestCache, validateAny } = require("./validate_export");

const FIXTURE = path.join(__dirname, "fixtures", "questcache-71037-enUS.wdb");
const bytes = () => Buffer.from(fs.readFileSync(FIXTURE));
const byId = (parsed, id) => parsed.quests.find((q) => q.id === id);

// Offsets of each record in the fixture: [{ id, at (record header), size }].
function records(buf) {
  const out = []; let at = 24;
  for (;;) {
    const id = buf.readUInt32LE(at), size = buf.readUInt32LE(at + 4);
    if (!id && !size) return out;
    out.push({ id, at, size }); at += 8 + size;
  }
}

test("the fixture reads as build 71037 enUS with every quest's facts", () => {
  const p = parseQuestCache(bytes(), { locale: "enUS" });
  assert.equal(p.ok, true, p.reason);
  assert.equal(p.build, 71037); assert.equal(p.locale, "enUS"); assert.equal(p.total, 8);
  assert.deepEqual(p.quests.map((q) => q.id), [257, 1003, 1097, 2359, 8372, 78150, 94238, 98372], "sorted by id");
  // Friend of the Library: two choices, 1s 25c, XP difficulty 1 (Blizzard's API and EG Link agree).
  assert.deepEqual(byId(p, 78150), { id: 78150, level: 20, minLevel: 1, sort: -284, xpDifficulty: 1, xpMultiplier: 1, money: 125,
    choose: [{ id: 277203, n: 1 }, { id: 277204, n: 1 }] });
  // Always-given items with a count above one, money and reputation by tier (tier 5 = 100 in QuestFactionReward).
  assert.deepEqual(byId(p, 1003), { id: 1003, level: 16, minLevel: 7, sort: 148, xpDifficulty: 5, xpMultiplier: 1, money: 800,
    items: [{ id: 2082, n: 1 }, { id: 11846, n: 5 }], rep: [{ faction: 54, tier: 5 }] });
  // A reward spell (Poisons, a spell that teaches 2842), an item handed over at accept, the next quest, an Elite quest.
  assert.deepEqual(byId(p, 2359), { id: 2359, level: 24, minLevel: 20, sort: -162, info: 1, next: 2607, xpDifficulty: 5, xpMultiplier: 1,
    money: 0, spell: 364159, startItem: 8046, items: [{ id: 18160, n: 1 }] });
  // A currency (Honor), PvP quest info and a zone sort.
  assert.deepEqual(byId(p, 8372), { id: 8372, level: 19, minLevel: 10, sort: 3277, info: 41, xpDifficulty: 5, xpMultiplier: 1, money: 1100,
    spell: 24960, rep: [{ faction: 890, tier: 6 }], currencies: [{ id: 1792, n: 10 }] });
  assert.deepEqual(byId(p, 257).choose, [{ id: 2903, n: 1 }, { id: 2904, n: 1 }]); assert.equal(byId(p, 257).next, 258);
  // Reputation overrides, in hundredths (7500 = 75).
  assert.deepEqual(byId(p, 94238).rep, [{ faction: 2586, tier: 0, override: 7500 }, { faction: 2587, tier: 0, override: 7500 }]);
  // A quest with no reward but XP: only the required numbers, no empty lists or zero ids.
  assert.deepEqual(byId(p, 1097), { id: 1097, level: 15, minLevel: 9, sort: 1519, xpDifficulty: 1, xpMultiplier: 1, money: 0 });
  // The smallest record of the live file (518 bytes).
  assert.equal(records(bytes()).find((r) => r.id === 98372).size, 518);
  assert.deepEqual(byId(p, 98372).items, [{ id: 280612, n: 1 }]);
});

test("supported builds are the verified ones; the schema version is 1.0.0", () => {
  assert.deepEqual(SUPPORTED_BUILDS, [70938, 71037]);
  assert.ok(Object.isFrozen(SUPPORTED_BUILDS));
  assert.equal(QUEST_CACHE_SCHEMA_VERSION, "1.0.0");
});

test("refusals: wrong magic, unknown build, bad header fields, locale, truncation, small records and more give a reason and no rows", () => {
  const refused = (buf, why, options) => {
    const p = parseQuestCache(buf, options);
    assert.equal(p.ok, false, "accepted: " + why);
    assert.equal(p.quests, undefined, "rows from a refused file: " + why);
    assert.equal(typeof p.reason, "string"); assert.ok(p.reason.length > 5);
    return p.reason;
  };
  let b = bytes(); b[0] = 0x57;
  assert.match(refused(b, "magic"), /magic/);
  b = bytes(); b.writeUInt32LE(71038, 4);
  assert.match(refused(b, "build"), /71038 is not a supported build \(70938, 71037\)/);
  for (const [at, value] of [[12, 0x3009], [16, 13], [20, 1]]) {
    b = bytes(); b.writeUInt32LE(value, at);
    assert.match(refused(b, "header field at " + at), /header field/);
  }
  assert.match(refused(bytes(), "locale folder", { locale: "deDE" }), /locale enUS is not its folder's \(deDE\)/);
  b = bytes(); b[8] = 0x31;
  assert.match(refused(b, "locale bytes"), /locale/);
  const full = bytes(), recs = records(full);
  assert.match(refused(full.subarray(0, recs[3].at + 100), "cut inside a record"), /truncated/);
  assert.match(refused(full.subarray(0, full.length - 8), "no end marker"), /truncated/);
  assert.match(refused(full.subarray(0, 20), "short header"), /too short/);
  assert.match(refused(Buffer.concat([full, Buffer.from([1, 2, 3, 4])]), "bytes after the end"), /follow the end marker/);
  // A record smaller than the fixed block: shrink quest 98372's record and drop the bytes it lost.
  const last = recs[recs.length - 1];
  const small = Buffer.concat([full.subarray(0, last.at), Buffer.alloc(8), Buffer.alloc(100), Buffer.alloc(8)]);
  small.writeUInt32LE(last.id, last.at); small.writeUInt32LE(100, last.at + 4); small.writeUInt32LE(last.id, last.at + 8);
  assert.match(refused(small, "record too small"), new RegExp(`100 bytes, smaller than the ${FIXED_BYTES}-byte fixed block`));
  b = bytes(); b.writeUInt32LE(0x7fff0000, recs[0].at + 4);
  assert.match(refused(b, "absurd size"), /larger than any quest record/);
  b = bytes(); b.writeUInt32LE(999, recs[0].at + 8);
  assert.match(refused(b, "body id"), /holds another quest id/);
  b = bytes(); b.writeUInt32LE(recs[0].id, recs[1].at); b.writeUInt32LE(recs[0].id, recs[1].at + 8);
  assert.match(refused(b, "duplicate"), /two records/);
  // A layout that is not the one this module knows shows as numbers no quest can have.
  b = bytes(); b.writeInt32LE(42, recs[0].at + 8 + 40);
  assert.match(refused(b, "xp difficulty"), /XP difficulty 42/);
  const r1003 = recs.find((r) => r.id === 1003);
  b = bytes(); b.writeInt32LE(77, r1003.at + 8 + 300 + 4);
  assert.match(refused(b, "reputation tier"), /reputation value of 77/);
  b = bytes(); b.writeInt32LE(-5, r1003.at + 8 + 116 + 4);
  assert.match(refused(b, "negative amount"), /amount of -5/);
  assert.match(refused(null, "nothing"), /bytes/);
});

test("documents: sorted, at most 500 quests each, header repeated, total is the whole cache, no text, valid against the schema", () => {
  const p = parseQuestCache(bytes(), { locale: "enUS" });
  const docs = questCacheDocuments(p, [...p.quests].reverse(), { companion: "0.12.8" });
  assert.equal(docs.length, 1);
  assert.deepEqual(Object.keys(docs[0]), ["schemaVersion", "kind", "build", "locale", "supportedBuilds", "companion", "total", "quests"]);
  assert.deepEqual(docs[0].quests.map((q) => q.id), p.quests.map((q) => q.id));
  assert.deepEqual(validateQuestCache(docs[0]), []);
  assert.deepEqual(validateAny(docs[0]), [], "validate_export picks the quest-cache schema by kind");
  const text = JSON.stringify(docs);
  assert.ok(!/Synthetic|never read|quest text/i.test(text), "quest text reached a document");
  // 1,203 quests: three documents of 500, 500 and 203, each with the same header and total.
  const many = Array.from({ length: 1203 }, (_, i) => ({ ...p.quests[i % 8], id: 100000 + i }));
  const split = questCacheDocuments({ ...p, total: 1203 }, many, { companion: "0.12.8" });
  assert.deepEqual(split.map((d) => d.quests.length), [500, 500, 203]);
  assert.ok(split.every((d) => d.total === 1203 && d.build === 71037 && d.locale === "enUS"));
  for (const d of split) assert.deepEqual(validateQuestCache(d), []);
  // Only what the schema names: an extra key anywhere is refused by it.
  const extra = JSON.parse(JSON.stringify(docs[0]));
  extra.quests[0].title = "x";
  assert.notDeepEqual(validateQuestCache(extra), []);
  const extraTop = { ...docs[0], character: "x" };
  assert.notDeepEqual(validateQuestCache(extraTop), []);
});

test("schema/examples/quest-cache.example.json is the fixture's document and matches the schema", () => {
  const example = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "schema", "examples", "quest-cache.example.json"), "utf8"));
  const p = parseQuestCache(bytes(), { locale: "enUS" });
  assert.deepEqual(example, questCacheDocuments(p, p.quests, { companion: example.companion })[0]);
  assert.deepEqual(validateQuestCache(example), []);
});
