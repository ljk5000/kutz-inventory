"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const {
  STATE_VERSION, ackContext, parseAck, mergeMarks, trimExport, readAckState, writeAckState,
} = require("./upload_ack");
const { validateExport } = require("./validate_export");

const EXAMPLE_V3 = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "schema", "examples", "inventory-export.v3.example.json"), "utf8"),
);
const clone = value => JSON.parse(JSON.stringify(value));

test("trimExport: no marks returns input deep-equal and unmutated", () => {
  const input = clone(EXAMPLE_V3);
  const snap = clone(input);
  for (const marks of [null, undefined, {}, { epoch: 1 }, { epoch: 1, events: {} }]) {
    const out = trimExport(input, marks);
    assert.deepEqual(out, snap);
    assert.deepEqual(input, snap);
  }
});

test("trimExport: drops events at or below mark, keeps above, respects rollback and unknown prefixes", () => {
  const input = clone(EXAMPLE_V3);
  input.observations.events = [
    { ...EXAMPLE_V3.observations.events[0], id: "k1f9c2-000000" },
    { ...EXAMPLE_V3.observations.events[0], id: "k1f9c2-000010" },
    { ...EXAMPLE_V3.observations.events[0], id: "k1f9c2-000011" },
    { ...EXAMPLE_V3.observations.events[1], id: "roll99-000001" },
    { ...EXAMPLE_V3.observations.events[1], id: "roll99-000005" },
    { ...EXAMPLE_V3.observations.events[2], id: "unkn42-000001" },
    { ...EXAMPLE_V3.observations.events[2], id: "unkn42-000002" },
  ];
  const snap = clone(input);

  // k1f9c2 highest=11 >= 10 -> drops 0 and 10, keeps 11.
  // roll99 highest=5 < 50 -> rolled back, keeps both 1 and 5.
  // unkn42 has no mark -> keeps both 1 and 2.
  const out = trimExport(input, { epoch: 1, events: { k1f9c2: 10, roll99: 50 } });
  assert.notStrictEqual(out, input);
  assert.deepEqual(input, snap, "input must not be mutated");
  assert.deepEqual(out.observations.events.map(e => e.id), [
    "k1f9c2-000011", "roll99-000001", "roll99-000005", "unkn42-000001", "unkn42-000002",
  ]);
  assert.deepEqual(validateExport(out), []);

  // Counter 0 with mark 0 is dropped when highest >= 0.
  const zeroOnly = clone(EXAMPLE_V3);
  zeroOnly.observations.events = [{ ...EXAMPLE_V3.observations.events[0], id: "zero00-000000" }];
  const zeroTrimmed = trimExport(zeroOnly, { events: { zero00: 0 } });
  assert.deepEqual(zeroTrimmed.observations.events, []);
  assert.deepEqual(validateExport(zeroTrimmed), []);
});

test("trimExport: day entries below mark are dropped, on or above mark are kept, and emptied parts are removed cleanly", () => {
  // In EXAMPLE_V3:
  //   events: k1f9c2-000017..000031
  //   npcs:   days 20403, 20404, 20404, 20405
  //   items:  days 20404, 20404
  //   kills:  days 20404, 20404
  const base = clone(EXAMPLE_V3);
  const snap = clone(base);

  // Mark day 20404: drops npc day 20403, keeps 20404 and 20405; keeps items/kills on 20404.
  const partial = trimExport(base, { epoch: 1, events: { k1f9c2: 30 }, day: 20404 });
  assert.deepEqual(base, snap);
  assert.deepEqual(partial.observations.events.map(e => e.id), ["k1f9c2-000031"]);
  assert.deepEqual(partial.observations.npcs.map(n => n.day), [20404, 20405, 20404]);
  assert.equal(partial.observations.install, "k1f9c2");
  assert.equal(partial.observations.items.length, 2);
  assert.equal(partial.observations.kills.length, 2);
  assert.equal(partial.observations.killsInstall, "k1f9c2");
  assert.deepEqual(validateExport(partial), []);

  // Mark day 20405 and all events <= 31: events -> [], items deleted, kills & killsInstall deleted, only npc day 20405 stays.
  const npcsOnly = trimExport(base, { epoch: 1, events: { k1f9c2: 31 }, day: 20405 });
  assert.deepEqual(npcsOnly.observations.events, []);
  assert.equal(npcsOnly.observations.npcs.length, 1);
  assert.equal(npcsOnly.observations.npcs[0].day, 20405);
  assert.equal(npcsOnly.observations.install, "k1f9c2");
  assert.equal("items" in npcsOnly.observations, false);
  assert.equal("kills" in npcsOnly.observations, false);
  assert.equal("killsInstall" in npcsOnly.observations, false);
  assert.deepEqual(validateExport(npcsOnly), []);

  // Mark day 20406 and events <= 30: only event 31 stays; npcs+install, items, kills+killsInstall deleted.
  const eventsOnly = trimExport(base, { epoch: 1, events: { k1f9c2: 30 }, day: 20406 });
  assert.deepEqual(eventsOnly.observations.events.map(e => e.id), ["k1f9c2-000031"]);
  assert.equal("npcs" in eventsOnly.observations, false);
  assert.equal("install" in eventsOnly.observations, false);
  assert.equal("items" in eventsOnly.observations, false);
  assert.equal("kills" in eventsOnly.observations, false);
  assert.equal("killsInstall" in eventsOnly.observations, false);
  assert.deepEqual(validateExport(eventsOnly), []);

  // Only items remain (events=[], npcs/kills emptied).
  const itemsLate = clone(EXAMPLE_V3);
  itemsLate.observations.items[0].day = 20406;
  const itemsOnly = trimExport(itemsLate, { epoch: 1, events: { k1f9c2: 31 }, day: 20406 });
  assert.deepEqual(itemsOnly.observations.events, []);
  assert.equal(itemsOnly.observations.items.length, 1);
  assert.equal("npcs" in itemsOnly.observations, false);
  assert.equal("install" in itemsOnly.observations, false);
  assert.equal("kills" in itemsOnly.observations, false);
  assert.equal("killsInstall" in itemsOnly.observations, false);
  assert.deepEqual(validateExport(itemsOnly), []);

  // Only kills remain (events=[], npcs/items emptied).
  const killsLate = clone(EXAMPLE_V3);
  killsLate.observations.kills[0].day = 20406;
  const killsOnly = trimExport(killsLate, { epoch: 1, events: { k1f9c2: 31 }, day: 20406 });
  assert.deepEqual(killsOnly.observations.events, []);
  assert.equal(killsOnly.observations.kills.length, 1);
  assert.equal(killsOnly.observations.killsInstall, "k1f9c2");
  assert.equal("npcs" in killsOnly.observations, false);
  assert.equal("install" in killsOnly.observations, false);
  assert.equal("items" in killsOnly.observations, false);
  assert.deepEqual(validateExport(killsOnly), []);

  // Everything emptied -> observations deleted from export; non-observation fields stay whole.
  const allGone = trimExport(base, { epoch: 1, events: { k1f9c2: 31 }, day: 20406 });
  assert.equal("observations" in allGone, false);
  assert.deepEqual(allGone.characters, base.characters);
  assert.deepEqual(allGone.prices, base.prices);
  assert.deepEqual(allGone.raids, base.raids);
  assert.deepEqual(validateExport(allGone), []);

  // Unknown keys outside observations and inside surviving observations stay untouched.
  const withUnknown = { ...clone(EXAMPLE_V3), extraTop: { ok: true }, observations: { ...clone(EXAMPLE_V3.observations), extraObs: "keep" } };
  const trimmedUnknown = trimExport(withUnknown, { epoch: 1, events: { k1f9c2: 30 }, day: 20404 });
  assert.deepEqual(trimmedUnknown.extraTop, { ok: true });
  assert.equal(trimmedUnknown.observations.extraObs, "keep");
});

test("parseAck and mergeMarks: takes maximums, ignores malformed fields, caps prefixes, handles epoch changes", () => {
  // Absent / non-object ack -> null.
  for (const bad of [undefined, null, 123, "ack", true, [], {}]) {
    assert.equal(parseAck(bad), null);
  }

  // Malformed individual fields are ignored while valid ones survive.
  const sanitized = parseAck({
    epoch: 0, // out of range (< 1)
    day: 1157408, // out of range (> 1157407)
    events: {
      k1f9c2: 4711,
      "ok00": 0,
      "max1": 999999999999,
      "bad": 1, // too short (< 4)
      "toolongprefix1234": 1, // too long (> 16)
      "UPPER": 5, // uppercase
      "bad_ch": 5, // non-alnum
      "neg1": -1,
      "over": 1000000000000,
      "flt1": 1.5,
      "str1": "10",
      "nan1": Number.NaN,
      constructor: 7,
    },
    extra: "ignored",
  });
  assert.deepEqual(sanitized, { events: { k1f9c2: 4711, ok00: 0, max1: 999999999999, constructor: 7 } });
  assert.equal(parseAck({ epoch: 1e9 + 1, day: 0, events: [] }), null);
  assert.deepEqual(parseAck({ epoch: 1e9, day: 1157407 }), { epoch: 1e9, day: 1157407, events: {} });

  // At most 64 prefixes kept.
  const many = {};
  for (let i = 0; i < 80; i++) many["pref" + String(i).padStart(2, "0")] = i;
  assert.equal(Object.keys(parseAck({ epoch: 1, events: many }).events).length, 64);

  // Merge takes the maximum for events and day.
  const first = { epoch: 1, events: { k1f9c2: 100, bbbb: 50 }, day: 20778 };
  const merged = mergeMarks(first, { epoch: 1, events: { k1f9c2: 90, bbbb: 75, cccc: 12 }, day: 20775 }, { trimmed: true });
  assert.deepEqual(merged, { epoch: 1, events: { k1f9c2: 100, bbbb: 75, cccc: 12 }, day: 20778 });

  const mergedNewerDay = mergeMarks(merged, { epoch: 1, day: 20780 }, { trimmed: true });
  assert.deepEqual(mergedNewerDay, { epoch: 1, events: { k1f9c2: 100, bbbb: 75, cccc: 12 }, day: 20780 });

  // Malformed/absent ack leaves previous marks unchanged.
  assert.deepEqual(mergeMarks(mergedNewerDay, null, { trimmed: true }), mergedNewerDay);
  assert.deepEqual(mergeMarks(mergedNewerDay, { epoch: "bad", day: -1, events: "nope" }, { trimmed: true }), mergedNewerDay);

  // Epoch change after a trimmed upload leaves only the new epoch with no marks.
  const reset = mergeMarks(mergedNewerDay, { epoch: 2, events: { k1f9c2: 120 }, day: 20781 }, { trimmed: true });
  assert.deepEqual(reset, { epoch: 2, events: {} });
  assert.equal("day" in reset, false);
  // With those reset marks, trimExport sends everything once.
  assert.deepEqual(trimExport(EXAMPLE_V3, reset), EXAMPLE_V3);

  // Next (untrimmed) upload under epoch 2 populates marks again.
  const rebuilt = mergeMarks(reset, { epoch: 2, events: { k1f9c2: 125 }, day: 20781 }, { trimmed: false });
  assert.deepEqual(rebuilt, { epoch: 2, events: { k1f9c2: 125 }, day: 20781 });
});

test("state file & context: binds to origin, username, file list, schemaVersion and companionVersion; tolerates missing/corrupt file", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kutz-ack-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "inventory.json.ack.json");

  const baseCtx = {
    origin: "https://wow.cr0m.com",
    username: "PlayerOne",
    files: ["/a/KutzInventory.lua", "/b/KutzInventory.lua"],
    schemaVersion: "3.15.0",
    companionVersion: "0.12.7",
  };
  const ctx = ackContext(baseCtx);
  assert.match(ctx, /^[0-9a-f]{64}$/);
  // Reordered files and trailing slash / case in origin produce the same context.
  assert.equal(ackContext({ ...baseCtx, origin: "HTTPS://WOW.CR0M.COM/", files: ["/b/KutzInventory.lua", "/a/KutzInventory.lua"] }), ctx);

  // Missing file -> null.
  assert.equal(readAckState(file, ctx), null);

  writeAckState(file, ctx, { epoch: 1, events: { k1f9c2: 4711 }, day: 20778 });
  const stored = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(stored.v, STATE_VERSION);
  assert.equal(stored.context, ctx);
  assert.deepEqual(readAckState(file, ctx), { epoch: 1, events: { k1f9c2: 4711 }, day: 20778 });

  // Any context change yields no marks.
  assert.equal(readAckState(file, ackContext({ ...baseCtx, username: "PlayerTwo" })), null);
  assert.equal(readAckState(file, ackContext({ ...baseCtx, origin: "https://other.example.com" })), null);
  assert.equal(readAckState(file, ackContext({ ...baseCtx, files: ["/a/KutzInventory.lua"] })), null);
  assert.equal(readAckState(file, ackContext({ ...baseCtx, files: [...baseCtx.files, "/c/KutzInventory.lua"] })), null);
  assert.equal(readAckState(file, ackContext({ ...baseCtx, schemaVersion: "3.16.0" })), null);
  assert.equal(readAckState(file, ackContext({ ...baseCtx, companionVersion: "0.12.8" })), null);

  // Corrupt or wrong-version state file yields no marks.
  fs.writeFileSync(file, "{not valid json");
  assert.equal(readAckState(file, ctx), null);
  fs.writeFileSync(file, JSON.stringify({ v: 2, context: ctx, epoch: 1, events: { k1f9c2: 1 }, day: 20778 }));
  assert.equal(readAckState(file, ctx), null);
});

test("size: 30-day export trimmed with marks from the day before is under one fifth of the full gzipped upload", () => {
  const startDay = 20749;
  const days = 30;
  const lastDay = startDay + days - 1; // 20778
  const full = clone(EXAMPLE_V3);
  const events = [];
  const npcs = [];
  const items = [];
  const kills = [];

  let counter = 0;
  let lastCounterBeforeFinalDay = 0;
  for (let d = 0; d < days; d++) {
    const day = startDay + d;
    const dayStartUnix = day * 86400;
    // 45 events/day (~1,350 total across 30 days) using schema example shapes.
    for (let i = 0; i < 45; i++) {
      counter++;
      const id = `k1f9c2-${String(counter).padStart(6, "0")}`;
      const t = dayStartUnix + i * 300;
      const mod = i % 3;
      if (mod === 0) {
        events.push({
          id, t, b: "1.60.1.70888", type: "loot",
          src: { kind: "mob", npc: 2000 + d * 20 + (i % 15), guid: `Creature-0-4170-0-1234-${2000 + d * 20 + (i % 15)}-${String(counter).padStart(10, "0")}`, level: 10 + (i % 50), via: "slot" },
          where: { map: 0, uiMap: 1429 + (d % 5), x: Number((0.1 + ((i * 17) % 80) / 100).toFixed(4)), y: Number((0.1 + ((d * 13 + i) % 80) / 100).toFixed(4)) },
          who: { level: 60, class: 4, faction: "Alliance", name: "Exampleobserver", surname: "Examplefamily" },
          items: [
            { id: 3000 + ((d * 31 + i) % 400), n: 1 + (i % 3), link: `|cff1eff00|Hitem:${3000 + ((d * 31 + i) % 400)}|h[Generated Loot Item ${d}-${i}]|h|r` },
            { id: 4000 + ((d * 19 + i) % 200), n: 2 },
          ],
        });
      } else if (mod === 1) {
        events.push({
          id, t, b: "1.60.1.70888", type: "gossip",
          npc: 5000 + d * 10 + (i % 10), kind: "gossip",
          text: `Generated watcher report ${counter} for day ${day}: the northern watchtower reports ${i + 2} patrols along sector ${d + 1}, $N.`,
          where: { uiMap: 1453, x: Number((0.2 + (i % 60) / 100).toFixed(4)), y: Number((0.2 + (d % 60) / 100).toFixed(4)) },
          who: { level: 60, class: 8, faction: "Alliance", name: "Exampleobserver", surname: "Examplefamily" },
        });
      } else {
        events.push({
          id, t, b: "1.60.1.70888", type: "quest", act: "accept",
          quest: 8000 + d * 20 + i, npc: 6000 + d * 10 + (i % 10),
          where: { map: 1, uiMap: 1449, x: 0.5012, y: 0.3301 },
          who: { level: 58, class: 4, faction: "Alliance" },
          lv: 58, rows: 1,
          obj: [{ t: "monster", n: 4, text: `Defeat ${4 + (i % 5)} generated scouts in camp ${d + 1}.` }],
          text: { title: `Generated Errand ${d}-${i}`, details: `Carry word from outpost ${d} to sentry ${i}, $N.`, objectives: `Speak with sentry ${i}.` },
        });
      }
    }
    if (day === lastDay - 1) lastCounterBeforeFinalDay = counter;

    // 25 NPCs/day (750 total across 30 days).
    for (let j = 0; j < 25; j++) {
      const npc = 10000 + d * 30 + j;
      npcs.push({
        npc, name: `Generated Creature ${d}-${j}`, lv: [10 + (j % 40), 12 + (j % 40)],
        cls: "normal", ct: 1, rxA: 2, day,
        cells: [[1429 + (d % 5), (j * 3) % 95, (d * 3 + j) % 95, 1 + (j % 5)]],
      });
    }

    // 25 item facts/day (750 total across 30 days).
    for (let j = 0; j < 25; j++) {
      const itemId = 20000 + d * 30 + j;
      items.push({
        id: itemId, day, build: "1.60.1.70888", name: `Generated Relic ${d}-${j}`,
        q: 2, bind: 2, cls: 4, sub: 1, ilvl: 20 + (j % 40), req: 15 + (j % 40),
        slot: "INVTYPE_CHEST", durability: 80,
        stats: { ITEM_MOD_STAMINA_SHORT: 4 + (j % 10), RESISTANCE0_NAME: 120 + j * 5 },
        tip: [`Generated Relic ${d}-${j}`, "Binds when equipped", ["Chest", "Cloth"], `${120 + j * 5} Armor`, `+${4 + (j % 10)} Stamina`, `Requires Level ${15 + (j % 40)}`],
      });
    }

    // 25 kills/day (750 total across 30 days).
    for (let j = 0; j < 25; j++) {
      kills.push({ day, npc: 10000 + d * 30 + j, lv: 10 + (j % 40), n: 1 + ((d + j) % 8) });
    }
  }

  full.observations = {
    v: 1,
    addon: "1.21.0",
    install: "k1f9c2",
    events,
    npcs: npcs.sort((a, b) => a.npc - b.npc),
    items: items.sort((a, b) => a.id - b.id),
    killsInstall: "k1f9c2",
    kills,
  };

  // Marks from the end of the day before (day = lastDay - 1, or lastDay after yesterday's upload ->
  // wait: day before is lastDay - 1, or marks from yesterday have day = lastDay - 1 which drops < lastDay - 1
  // and keeps lastDay - 1 and lastDay; let's check both!).
  const marks = { epoch: 1, events: { k1f9c2: lastCounterBeforeFinalDay }, day: lastDay - 1 };
  const trimmed = trimExport(full, marks);

  assert.deepEqual(validateExport(full), [], "generated 30-day export must match schema");
  assert.deepEqual(validateExport(trimmed), [], "trimmed 30-day export must match schema");

  const fullGzip = zlib.gzipSync(Buffer.from(JSON.stringify(full), "utf8"));
  const trimmedGzip = zlib.gzipSync(Buffer.from(JSON.stringify(trimmed), "utf8"));
  console.log(`30-day gzipped upload sizes: full=${fullGzip.length} B, trimmed=${trimmedGzip.length} B (${((trimmedGzip.length / fullGzip.length) * 100).toFixed(1)}%)`);
  assert.ok(trimmedGzip.length < fullGzip.length / 5, `expected trimmed (${trimmedGzip.length} B) < full/5 (${Math.floor(fullGzip.length / 5)} B)`);
});

test("end-to-end with Facts.lua and trimExport: meeting unchanged bag items on D+1 after ack day D exports no items; new item on D+1 is exported", () => {
  const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");
  const convert = require("./convert");
  const factsSrc = fs.readFileSync(path.join(__dirname, "..", "KutzInventory", "Facts.lua"), "utf8").replace(/\r\n/g, "\n");

  const DAY_READ = 20453; // D - 1: bag items first read
  const DAY_ACK = 20454;  // D: server acknowledged up to D (drops < D, keeps >= D)
  const DAY_NEXT = 20455; // D + 1: bag items met again unchanged, then one new item met

  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  lua.lua_pushstring(L, to_luastring(factsSrc));
  lua.lua_setglobal(L, to_luastring("FACTS_SRC"));

  const driver = `
    local function serialize(v)
      if type(v) == "string" then
        return '"' .. v:gsub('[\\\\"]', "\\\\%0"):gsub("\\n", "\\\\n"):gsub("\\r", "\\\\r") .. '"'
      end
      if type(v) ~= "table" then return tostring(v) end
      local out = { "{" }
      for k, x in pairs(v) do
        local ks = type(k) == "string" and ('"' .. k .. '"') or tostring(k)
        out[#out + 1] = "[" .. ks .. "] = " .. serialize(x) .. ","
      end
      out[#out + 1] = "}"
      return table.concat(out, "\\n")
    end

    local function session(db, day)
      local timers, clock = {}, 100
      local G = setmetatable({}, { __index = _G })
      G._G = G
      G.time = function() return day * 86400 + 3600 end
      G.GetTime = function() return clock end
      G.GetBuildInfo = function() return "1.60.1", "71037", "Nov 1 2026", 16001 end
      G.InCombatLockdown = function() return false end
      G.UnitAffectingCombat = function() return false end
      G.GetFramerate = function() return 60 end
      G.debugprofilestop = function() return 0 end
      G.C_Timer = { After = function(delay, fn) timers[#timers + 1] = { delay = delay, fn = fn } end }
      local catalog = {
        [2589] = { name = "Linen Cloth", q = 1, ilvl = 5, req = 0, cls = 7, sub = 5, bind = 0, tip = { { leftText = "Linen Cloth" }, { leftText = "Crafting Reagent" } } },
        [4306] = { name = "Silk Cloth", q = 1, ilvl = 25, req = 0, cls = 7, sub = 5, bind = 0, tip = { { leftText = "Silk Cloth" }, { leftText = "Crafting Reagent" } } },
        [6560] = { name = "Soldier's Shield", q = 2, ilvl = 25, req = 20, cls = 4, sub = 6, bind = 2, slot = "INVTYPE_SHIELD",
                   tip = { { leftText = "Soldier's Shield" }, { leftText = "Off Hand", rightText = "Shield" }, { leftText = "Durability 85 / 85" } },
                   stats = { ITEM_MOD_STAMINA_SHORT = 3, RESISTANCE0_NAME = 478 } },
        [9999] = { name = "Fresh Drop", q = 3, ilvl = 40, req = 35, cls = 4, sub = 1, bind = 2, slot = "INVTYPE_HEAD",
                   tip = { { leftText = "Fresh Drop" }, { leftText = "Binds when equipped" } },
                   stats = { ITEM_MOD_INTELLECT_SHORT = 7 } },
      }
      G.C_Item = {
        GetItemInfo = function(link)
          local x = catalog[tonumber(link:match("^item:(%d+)"))]
          if not x then return nil end
          return x.name, nil, x.q, x.ilvl, x.req, "Type", "Sub", 1, x.slot or "", 1, 100, x.cls, x.sub, x.bind, 0, x.set
        end,
        GetItemStats = function(link)
          local x = catalog[tonumber(link:match("^item:(%d+)"))]
          return x and x.stats or nil
        end,
        RequestLoadItemDataByID = function() end,
      }
      G.C_TooltipInfo = {
        GetHyperlink = function(link)
          local x = catalog[tonumber(link:match("^item:(%d+)"))]
          return x and { lines = x.tip } or nil
        end,
      }
      G.KutzInventoryObsDB = db
      local ns = {}
      assert(load(FACTS_SRC, "@Facts.lua", "t", G))("KutzInventory", ns)
      local function run()
        while #timers > 0 do
          local t = table.remove(timers, 1)
          clock = clock + t.delay
          t.fn()
        end
      end
      return ns.Facts, run
    end

    local db = { v = 1, on = true, agreed = true, addon = "1.21.0", prefix = "k1f9c2", events = {} }
    -- Day D-1: bag items first met and read
    local F1, run1 = session(db, ${DAY_READ})
    F1.Meet("|cffffffff|Hitem:2589::::::::60:::::|h[Linen Cloth]|h|r")
    F1.Meet("|cffffffff|Hitem:4306::::::::60:::::|h[Silk Cloth]|h|r")
    F1.Meet("|cff1eff00|Hitem:6560::::::::60:::::|h[Soldier's Shield]|h|r")
    run1()
    SAVED_READ = "KutzInventoryDB = { chars = {} }\\nKutzInventoryObsDB = " .. serialize(db)

    -- Day D+1: fresh session, all bag items met again, none changed
    local F2, run2 = session(db, ${DAY_NEXT})
    F2.Meet("|cffffffff|Hitem:2589::::::::60:::::|h[Linen Cloth]|h|r")
    F2.Meet("|cffffffff|Hitem:4306::::::::60:::::|h[Silk Cloth]|h|r")
    F2.Meet("|cff1eff00|Hitem:6560::::::::60:::::|h[Soldier's Shield]|h|r")
    run2()
    SAVED_REMET = "KutzInventoryDB = { chars = {} }\\nKutzInventoryObsDB = " .. serialize(db)

    -- Still on Day D+1: one brand-new item is met
    F2.Meet("|cff0070dd|Hitem:9999::::::::60:::::|h[Fresh Drop]|h|r")
    run2()
    SAVED_WITH_NEW = "KutzInventoryDB = { chars = {} }\\nKutzInventoryObsDB = " .. serialize(db)
  `;

  assert.equal(lauxlib.luaL_loadbuffer(L, to_luastring(driver), null, to_luastring("@e2e")), 0);
  assert.equal(lua.lua_pcall(L, 0, 0, 0), 0, () => to_jsstring(lua.lua_tostring(L, -1)));

  const getGlobal = name => {
    lua.lua_getglobal(L, to_luastring(name));
    const s = to_jsstring(lua.lua_tostring(L, -1));
    lua.lua_pop(L, 1);
    return s;
  };

  const marks = { epoch: 1, events: {}, day: DAY_ACK };

  // Save on D+1 after re-meeting all bag items unchanged: full export still has all 3 at day D-1 (and no m);
  // trimmed export has no items (and omits observations altogether).
  const remetFull = convert.convertSavedVariables([getGlobal("SAVED_REMET")]).inventory;
  assert.deepEqual(validateExport(remetFull), []);
  assert.equal(remetFull.observations.items.length, 3);
  for (const it of remetFull.observations.items) {
    assert.equal(it.day, DAY_READ);
    assert.equal("m" in it, false);
  }
  const remetTrimmed = trimExport(remetFull, marks);
  assert.deepEqual(validateExport(remetTrimmed), []);
  assert.equal("observations" in remetTrimmed, false, "all unchanged bag items are trimmed away");

  // Save on D+1 after also meeting one new item: trimmed export carries only the new item (day = D+1, no m).
  const withNewFull = convert.convertSavedVariables([getGlobal("SAVED_WITH_NEW")]).inventory;
  assert.deepEqual(validateExport(withNewFull), []);
  assert.equal(withNewFull.observations.items.length, 4);
  const withNewTrimmed = trimExport(withNewFull, marks);
  assert.deepEqual(validateExport(withNewTrimmed), []);
  assert.deepEqual(withNewTrimmed.observations.items.map(i => [i.id, i.day]), [[9999, DAY_NEXT]]);
  assert.equal("m" in withNewTrimmed.observations.items[0], false);
});
