// The pure half of the exporter: KutzInventory's saved file (the Lua the game writes into SavedVariables) in,
// inventory JSON and auction-scan documents out. No file system, network, process or Node APIs, so the same file runs
//   - in Node:    const { convertSavedVariables } = require("./convert");   (tools/inventory_export.js, the Companion)
//   - in a page:  <script src="convert.js"></script> defines one global, KutzConvert   (cr0m's upload box)
// It never runs the saved file; it only reads values from it. Browser consumers can use this same module.
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module && module.exports) module.exports = factory();
  else root.KutzConvert = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
"use strict";

// The export format's version (schema/inventory-export.schema.json, rules in schema/README.md).
// A new optional field bumps the minor; renaming, removing or retyping a field bumps the major.
// 2.0.0: no characters[].crafting, no AH prices (those are auction-scan documents now).
// 2.0.1 / 3.7.1 clarify stable character keys; the existing pattern already permits surname/GUID disambiguation.
const SCHEMA_VERSION = "2.1.0";
// 3.0.0 (schema/inventory-export.v3.schema.json, written with --format 3): drops what cr0m reads from the Battle.net
// API: stats, sheet, talents, spec, role, reputation, statistics, PvP, achievement points; equipped
// items keep only slotId, id and link. The default since cr0m's 3.x reader was deployed.
// 3.1.0 adds raids[]: the cr0m raids tracked with /kinv raid that recorded something (KutzInventoryDB.raids).
// 3.2.0 adds observations: drop / quest / vendor events (trainer events since 3.9.0) (KutzInventoryObsDB, /kinv track; default-on for new installs since addon 1.13.0).
// 3.3.0: observation items may carry a short item `link` (colour, id, name) and `who` the recording character's own
// `name` and `surname`.
// 3.4.0 adds characters[].crafted: the items the character created, counted as they are made (Crafts.lua).
// 3.5.0 adds characters[].hearth: where the Hearthstone is set (the game's GetBindLocation).
// 3.6.0: quest observations may carry `text`: the quest's title, description, objectives, progress and completion text
// as the game showed them, the character's own name as "$N" (KutzInventory 1.12.0).
// 3.7.0: a loot observation's src may say via "roll" (a corpse's group-loot roll list, with `threshold` the loot
// threshold quality 0-7) and `encounter` (the DungeonEncounter id of a boss); its items may carry won: true, the item
// this character won by roll (KutzInventory 1.14.0).
// 2.1.0 / 3.8.0 add characters[].legacyTree: the current character's three Legacy trait trees.
// 3.9.0: observations may be of type "trainer" (a class or profession trainer's list with costs, spell ids and the
// trainer's reaction rx); vendor observations may carry rx and filtered (KutzInventory 1.16.0). observations.v stays 1.
// 3.10.0: observations may carry npcs, a cumulative per-install summary of the creatures the player looked at (level
// range, classification, type, family, reaction per side, subtitle, beast attack speed, last day seen, map squares
// stood beside it), and install, the id of the install(s) it summarises (KutzInventory 1.17.0). observations.v stays 1.
// 3.11.0: observations may be of type "taxi" (a flight master's reachable nodes with their prices) and "flight" (how many
// seconds a flight from one node to another took); npcs entries may carry svc, the services an NPC was seen to offer;
// quest observations may carry lv, group, freq, timed and startItem (accept) and xp and rep (turnin, reputation changes
// only) (KutzInventory 1.18.0). observations.v stays 1.
// 3.12.0: game text observations and quest objective and map data (KutzInventory 1.19.0). observations.v stays 1.
// 3.13.0: hunter tame events (KutzInventory 1.20.0).
const SCHEMA_VERSION_3 = "3.13.0";
const FORMATS = { 2: SCHEMA_VERSION, 3: SCHEMA_VERSION_3 };
// schema/auction-scan.schema.json: one document per auction house, sent to POST /api/wow/auctions.
// 1.1.0 adds scope ("all" = the whole AH: an item missing is not listed) and items[].c / .s (item class / subclass).
const AUCTION_SCHEMA_VERSION = "1.2.0";
const REGIONS = { 1: "us", 2: "kr", 3: "eu", 4: "tw", 5: "cn" };   // GetCurrentRegion()

// ---------------------------------------------------------------------------
// A reader for the Lua the game writes into SavedVariables (tables, strings, numbers, booleans, nil).
// It never runs the file, it only reads values. Tables nested deeper than MAX_TABLE_DEPTH are refused, so a crafted
// file cannot exhaust the stack (the addon's deepest table, a recipe reagent's alternatives, is about 12 levels down).
// ---------------------------------------------------------------------------
const MAX_TABLE_DEPTH = 64;
function parseSavedVariables(src) {
  let i = 0;
  let depth = 0;
  const n = src.length;
  const err = (m) => { throw new Error(`${m} at character ${i}: ${JSON.stringify(src.slice(i, i + 40))}`); };

  function skip() {
    for (;;) {
      while (i < n && /\s/.test(src[i])) i++;
      if (src.startsWith("--[[", i)) { const e = src.indexOf("]]", i); i = e < 0 ? n : e + 2; continue; }
      if (src.startsWith("--", i)) { while (i < n && src[i] !== "\n") i++; continue; }
      break;
    }
  }
  function str() {
    const q = src[i++];
    let out = "";
    while (i < n && src[i] !== q) {
      let c = src[i++];
      if (c === "\\") {
        c = src[i++];
        if (c === "n" || c === "\n") out += "\n";
        else if (c === "r") out += "\r";
        else if (c === "t") out += "\t";
        else if (c === "a") out += "\x07";
        else if (c === "b") out += "\b";
        else if (c === "f") out += "\f";
        else if (c === "v") out += "\v";
        else if (c === "\r") { out += "\n"; if (src[i] === "\n") i++; }
        else if (/[0-9]/.test(c)) {
          let d = c;
          while (d.length < 3 && /[0-9]/.test(src[i])) d += src[i++];
          out += String.fromCharCode(parseInt(d, 10));
        } else out += c;                                // \\ \" \'
      } else out += c;
    }
    if (src[i] !== q) err("unfinished string");
    i++;
    return out;                                         // the file is read as UTF-8, so names with accents are fine
  }
  function num() {
    const m = /^-?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|inf|nan)/.exec(src.slice(i, i + 64));
    if (!m) err("bad number");
    i += m[0].length;
    if (/inf/.test(m[0])) return m[0][0] === "-" ? -Infinity : Infinity;
    if (/nan/.test(m[0])) return NaN;
    return Number(m[0]);
  }
  function value() {
    skip();
    const c = src[i];
    if (c === "{") return table();
    if (c === '"' || c === "'") return str();
    if (src.startsWith("true", i)) { i += 4; return true; }
    if (src.startsWith("false", i)) { i += 5; return false; }
    if (src.startsWith("nil", i)) { i += 3; return null; }
    return num();
  }
  function table() {
    if (++depth > MAX_TABLE_DEPTH) throw new Error(`table nested too deep at character ${i}`);
    i++;                                                // {
    const map = new Map();
    let next = 1;
    for (;;) {
      skip();
      if (src[i] === "}") { i++; break; }
      let key;
      if (src[i] === "[") {
        i++; key = value(); skip();
        if (src[i] !== "]") err("expected ]");
        i++; skip();
        if (src[i] !== "=") err("expected =");
        i++;
        map.set(key, value());
      } else if (/[A-Za-z_]/.test(src[i]) && /^[A-Za-z_][A-Za-z0-9_]*\s*=(?!=)/.test(src.slice(i, i + 80))) {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(src.slice(i, i + 80));
        i += m[0].length;
        map.set(m[1], value());
      } else {
        map.set(next++, value());
      }
      skip();
      if (src[i] === "," || src[i] === ";") i++;
    }
    depth--;
    return map;
  }

  const result = {};
  for (;;) {
    skip();
    if (i >= n) break;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(src.slice(i, i + 200));
    if (!m) err("expected NAME =");
    i += m[0].length;
    result[m[1]] = value();
  }
  return result;
}

// Lua table (Map) -> plain JS object with the Lua keys kept as they are (so slot 1 stays slot 1,
// even when the slots happen to run 1..n with no gaps). Real lists are turned into arrays by asList().
function plain(v) {
  if (!(v instanceof Map)) return v;
  const o = {};
  for (const [k, x] of v) o[String(k)] = plain(x);
  return o;
}
const asList = (o) => (Array.isArray(o) ? o : Object.entries(o || {})
  .sort((a, b) => Number(a[0]) - Number(b[0])).map(([, x]) => x)).filter((x) => x !== null && x !== undefined);

// ---------------------------------------------------------------------------
// clean-up: slot tables -> lists with the slot number inside each entry
// ---------------------------------------------------------------------------
const LOCATION_BY_BAG = (bag) => (bag <= 5 ? "bags" : bag <= 14 ? "bank" : "warband");

function containers(boxes, location) {
  const out = [];
  for (const [bagKey, box] of Object.entries(boxes || {})) {
    if (!box || typeof box !== "object") continue;
    const bag = Number(bagKey);
    const items = Object.entries(box.items || {})
      .filter(([, it]) => it && typeof it === "object")       // the game writes empty slots as nil
      .map(([slot, it]) => ({ slot: Number(slot), ...it }))
      .sort((a, b) => a.slot - b.slot);
    out.push({ location: location || LOCATION_BY_BAG(bag), bag, name: box.name ?? null, size: box.size ?? null,
               used: box.used ?? items.length, bagLink: box.link ?? null, updated: box.updated ?? null, items });
  }
  return out.sort((a, b) => a.bag - b.bag);
}

function equippedList(eq) {
  return Object.entries(eq || {})
    .filter(([, it]) => it && typeof it === "object")
    .map(([slotId, it]) => ({ slotId: Number(slotId), ...it }))
    .sort((a, b) => a.slotId - b.slotId);
}

const iso = (t) => (typeof t === "number" ? new Date(t * 1000).toISOString() : null);

// ---------------------------------------------------------------------------
// prices and crafting profit (all money in copper)
// ---------------------------------------------------------------------------
const AH_CUT = 0.05;                                       // the auction house keeps 5% of a sale
const DIFFICULTY = ["orange", "yellow", "green", "gray"];  // the recipe's colour in the profession window

// one price book from every saved file.
//   vendor / sell: what vendors charge and pay (exported).
//   houses["<realm>|<house>"] = { items: { id: newest reading }, scan: newest scan record } (auction-scan documents).
//   ah: the newest AH reading of each item over every house, only for the local profit report.
// Saved files from before KutzInventory 1.3.0 have prices.ah keyed by item ID with no house: those only feed the
// local report (the addon moves them to their house the next time it loads).
function mergePrices(dbs) {
  const book = { vendor: {}, sell: {}, ah: {}, houses: {} };
  const newer = (a, b) => !a || (b.t || 0) > (a.t || 0);
  for (const db of dbs) {
    const p = db.prices || {};
    for (const [id, v] of Object.entries(p.vendor || {})) {
      const old = book.vendor[id];
      if (!old || (v.price ?? Infinity) < old.price) book.vendor[id] = v;     // the cheapest vendor anywhere
    }
    for (const [id, v] of Object.entries(p.sell || {})) book.sell[id] = v;
    for (const [key, v] of Object.entries(p.ah || {})) {
      if (/^\d+$/.test(key)) { if (v && typeof v === "object" && newer(book.ah[key], v)) book.ah[key] = v; continue; }
      if (!key.includes("|") || !v || typeof v !== "object") continue;
      const house = book.houses[key] || (book.houses[key] = { items: {}, scan: null });
      for (const [id, r] of Object.entries(v)) {
        if (!r || typeof r !== "object") continue;
        if (newer(house.items[id], r)) house.items[id] = r;
        if (newer(book.ah[id], r)) book.ah[id] = r;
      }
    }
    for (const [key, s] of Object.entries(p.scans || {})) {
      if (!s || typeof s !== "object" || !book.houses[key]) continue;
      const old = book.houses[key].scan;
      if (!old || (s.finishedAt || 0) > (old.finishedAt || 0)) book.houses[key].scan = s;
    }
  }
  return book;
}

// an item name as plain text (1-120 characters, no WoW colour / link codes or control characters), else null
const plainName = (v) => (typeof v === "string" && v.trim().length >= 1 && v.trim().length <= 120 && !/[|\x00-\x1f]/.test(v) ? v.trim() : null);

// One auction-scan document per house that has a scan record: the items read by that scan (t within it).
// No character name, GUID or account is in it.
function auctionScans(book) {
  const docs = [];
  for (const [key, house] of Object.entries(book.houses)) {
    const s = house.scan;
    const split = key.lastIndexOf("|");
    const realm = key.slice(0, split), side = key.slice(split + 1);
    if (!s || !realm || !["alliance", "horde", "neutral"].includes(side)) continue;
    const from = Number(s.startedAt) || 0, to = Number(s.finishedAt) || Infinity;
    const items = {};
    for (const [id, r] of Object.entries(house.items)) {
      const t = Number(r.t) || 0;
      if (t < from || t > to) continue;                      // an older scan's reading: not part of this document
      // cr0m's contract: p and q are the same length, positive integers (copper / counts), at most 3.
      const pairs = asList(r.p).map((v, i) => [Math.round(Number(v)), Math.round(Number(asList(r.q)[i]))])
        .filter(([v, n]) => Number.isFinite(v) && v >= 1 && Number.isFinite(n) && n >= 1).slice(0, 3);
      const p = pairs.map(([v]) => v), q = pairs.map(([, n]) => n);
      if (pairs.length === 0 && asList(r.p).length > 0) continue;   // prices without usable quantities: unknown, not "none listed"
      // Before 1.3.0 a search that got no answer was saved as "none listed", so an empty legacy reading may be a
      // timeout: leave it out (missing = unknown) rather than tell everyone the item is not for sale.
      if (s.method === "legacy" && p.length === 0) continue;
      items[id] = { p, q, n: Math.max(0, Math.round(Number(r.n) || 0)), t: iso(t),
                    ...(r.supply ? { supply: { complete: r.supply.complete === true && s.complete === true,
                      lots: asList(r.supply.lots).map(lot => asList(lot)) } } : {}),
                    ...(Number.isInteger(r.c) && r.c >= 0 ? { c: r.c } : {}), ...(Number.isInteger(r.s) && r.s >= 0 ? { s: r.s } : {}), ...(plainName(r.name) ? { name: plainName(r.name) } : {}),
                    ...(typeof r.e === "string" && /^INVTYPE_[A-Z0-9_]+$/.test(r.e) && r.e !== "INVTYPE_NON_EQUIP_IGNORE" ? { e: r.e } : {}) };
    }
    if (!Object.keys(items).length) continue;
    docs.push({
      schemaVersion: AUCTION_SCHEMA_VERSION,
      region: REGIONS[s.region] || "us",
      realm, house: side,
      startedAt: iso(s.startedAt) ?? iso(to), scannedAt: iso(to),
      complete: s.complete === true,
      // unknown for prices from before 1.3.0 (the addon records those as "legacy"): left out, as cr0m allows
      ...(["full", "search"].includes(s.method) ? { method: s.method } : {}),
      houseSource: ["npc", "zone", "player"].includes(s.houseSource) ? s.houseSource : "player",
      queued: Number(s.queued) || 0, answered: Number(s.answered) || 0,
      ...(s.scope === "all" || s.scope === "crafting" ? { scope: s.scope } : {}),
      addon: { name: "KutzInventory", version: typeof s.addonVersion === "string" ? s.addonVersion : "unknown" },
      items,
    });
  }
  return docs.sort((a, b) => (a.realm + "|" + a.house).localeCompare(b.realm + "|" + b.house));
}

function itemPrice(book, id) {
  const vendor = book.vendor[id];
  const ahRaw = book.ah[id];
  const lowest = ahRaw ? asList(ahRaw.p) : [];
  const ah = ahRaw ? {
    lowest, quantities: asList(ahRaw.q), listings: ahRaw.n ?? null, scanned: iso(ahRaw.t),
    avg3: lowest.length ? Math.round(lowest.reduce((a, b) => a + b, 0) / lowest.length) : null,
  } : null;
  // buying it: the vendor if it sells it, else the average of the 3 cheapest AH listings
  let buy = null, buyFrom = null;
  if (vendor && typeof vendor.price === "number") { buy = vendor.price; buyFrom = "vendor"; }
  if (ah && ah.avg3 != null && (buy == null || ah.avg3 < buy)) { buy = ah.avg3; buyFrom = "ah"; }
  return { vendorBuy: vendor ? vendor.price : null, vendor: vendor ? vendor.vendor ?? null : null,
           vendorSell: book.sell[id] ?? null, ah, buy, buyFrom };
}

// what the inventory export carries per item since 2.0.0: vendor observations only
function vendorPrice(book, id) {
  const vendor = book.vendor[id];
  return { vendorBuy: vendor ? vendor.price : null, vendor: vendor ? vendor.vendor ?? null : null, vendorSell: book.sell[id] ?? null };
}

// one recipe's numbers: what the materials cost and what the product is worth
function recipeValue(book, r, learned) {
  const makes = ((r.makesMin || 1) + (r.makesMax || r.makesMin || 1)) / 2;
  let cost = 0, complete = true;
  const materials = asList(r.reagents).filter((x) => x && x.itemID).map((x) => {
    const p = itemPrice(book, x.itemID);
    const qty = x.quantity || 1;
    if (p.buy == null) complete = false;
    else cost += p.buy * qty;
    return { itemID: x.itemID, name: x.name ?? null, quantity: qty, unitPrice: p.buy, from: p.buyFrom,
             total: p.buy == null ? null : Math.round(p.buy * qty) };
  });
  if (materials.length === 0) complete = false;
  const out = r.outputItemID ? itemPrice(book, r.outputItemID) : null;
  const vendorValue = out && out.vendorSell != null ? Math.round(out.vendorSell * makes) : null;
  const ahValue = out && out.ah && out.ah.avg3 != null ? Math.round(out.ah.avg3 * makes * (1 - AH_CUT)) : null;
  cost = Math.round(cost);
  return {
    recipeID: r.recipeID, name: r.name ?? null, learned, source: r.source ?? undefined,
    difficulty: learned ? (DIFFICULTY[r.difficulty] ?? null) : null, skillUps: r.skillUps ?? null,
    outputItemID: r.outputItemID ?? null, outputName: r.outputName ?? r.name ?? null, makes,
    materialCost: complete ? cost : null, materialsPriced: complete, materials,
    vendorSellValue: vendorValue, vendorProfit: complete && vendorValue != null ? vendorValue - cost : null,
    ahValue, ahProfit: complete && ahValue != null ? ahValue - cost : null,
  };
}

// per profession: every recipe priced, best vendor profit first, and a levelling list (cheapest skill-up first)
function crafting(book, c) {
  return Object.entries(c.recipes || {}).map(([profession, p]) => {
    const recipes = [
      ...asList(p.recipes).map((r) => recipeValue(book, r, true)),
      ...asList(p.unlearned).map((r) => recipeValue(book, r, false)),
    ].sort((a, b) => (b.vendorProfit ?? -Infinity) - (a.vendorProfit ?? -Infinity));
    // net cost of one craft = materials minus the better of selling the product to a vendor or on the AH
    const net = (r) => r.materialCost - Math.max(r.vendorSellValue ?? 0, r.ahValue ?? 0);
    const levelling = recipes
      .filter((r) => r.learned && r.materialsPriced && r.difficulty && r.difficulty !== "gray")
      .map((r) => ({ recipeID: r.recipeID, name: r.name, difficulty: r.difficulty, materialCost: r.materialCost,
                     netCostPerCraft: net(r) }))
      .sort((a, b) => (a.difficulty === "orange" ? 0 : 1) - (b.difficulty === "orange" ? 0 : 1) || a.netCostPerCraft - b.netCostPerCraft);
    return { profession, skill: p.skill ?? null, max: p.max ?? null, recipes, levelling };
  });
}

// Inventory 3.x: the 2.x document without what the Battle.net API supplies. The API serves these
// as of the character's last logout; the addon still records them in SavedVariables, they are just not exported.
const DROPPED_IN_3 = ["spec", "role", "stats", "sheet", "talents", "reputation", "statistics", "achievementPoints", "pvp"];
const DROPPED_SECTIONS_IN_3 = ["sheet", "stats", "talents", "reputation", "statistics", "pvp"];   // keys of characters[].updated
function toFormat3(inventory, raids, observations, crafted, hearths) {
  const characters = inventory.characters.map((c) => {
    const out = { ...c };
    for (const k of DROPPED_IN_3) delete out[k];
    out.updated = Object.fromEntries(Object.entries(c.updated || {}).filter(([k]) => !DROPPED_SECTIONS_IN_3.includes(k)));
    // Gear between logouts: the slot and the item (its link carries enchant and suffix); the API has the details.
    out.equipped = (c.equipped || []).filter((it) => Number.isInteger(it.id) && it.id > 0)
      .map((it) => ({ slotId: it.slotId, id: it.id, ...(typeof it.link === "string" && it.link ? { link: it.link } : {}) }));
    const made = crafted && crafted.get(c.key);
    if (made) out.crafted = made;
    const hearth = hearths && hearths.get(c.key);
    if (hearth) out.hearth = hearth;
    return out;
  });
  return { ...inventory, schemaVersion: SCHEMA_VERSION_3, characters, raids: raids || [], ...(observations ? { observations } : {}) };
}

// ---------------------------------------------------------------------------
// Raids (inventory 3.1.0+): KutzInventoryDB.raids[CODE] = { string, events = { { t, kind, ... } } } from /kinv raid.
// Exported as raids[] = { string, events[] }: only raids whose string has the right shape and that recorded at least
// one usable event. The string is kept exactly as cr0m issued it (cr0m checks its signature, the addon can't).
// Each event keeps only the fields its kind has, with the right types; times become ISO strings.
// ---------------------------------------------------------------------------
const RAID_STRING = /^KR1\.[A-Z2-9]{6}\.[0-9]{1,10}\.[0-9]{1,12}\.[A-Z0-9]{12}$/;
const RAID_EVENT_FIELDS = {          // field: type ("!" = the event is dropped without it)
  start: { instanceId: "int", instanceName: "text", instanceType: "text", difficultyId: "int", by: "text" },
  end: { instanceId: "int", instanceName: "text" },
  encounter_start: { encounterId: "int!", encounterName: "text", difficultyId: "int", groupSize: "int" },
  encounter_end: { encounterId: "int!", encounterName: "text", difficultyId: "int", groupSize: "int", success: "bool!" },
  loot: { itemId: "int!", itemLink: "link", count: "int", looter: "text!" },
  roster: { members: "names!" },
};
const RAID_FIELD = {
  int: (v) => (Number.isInteger(v) && v >= 0 ? v : undefined),
  text: (v) => (typeof v === "string" && v.length >= 1 && v.length <= 120 ? v : undefined),
  link: (v) => (typeof v === "string" && v.length >= 1 && v.length <= 1000 ? v : undefined),
  bool: (v) => (typeof v === "boolean" ? v : undefined),
  names: (v) => (v && typeof v === "object" ? asList(v).filter((n) => typeof n === "string" && n.length >= 1 && n.length <= 120).slice(0, 40) : undefined),
};
function raidEvent(e) {
  const fields = e && typeof e === "object" ? RAID_EVENT_FIELDS[e.kind] : null;
  if (!fields || !Number.isInteger(e.t) || e.t < 0 || e.t > 1e11) return null;   // 1e11 s: year 5138, a valid Date
  const out = { t: iso(e.t), kind: e.kind };
  for (const [k, type] of Object.entries(fields)) {
    const v = RAID_FIELD[type.replace("!", "")](e[k]);
    if (v !== undefined) out[k] = v;
    else if (type.endsWith("!")) return null;
  }
  return out;
}
// every saved file's raids, merged by string (two accounts in the same raid), events in time order, duplicates once
function exportRaids(dbs) {
  const byString = new Map();
  for (const db of dbs) {
    for (const r of Object.values(db.raids && typeof db.raids === "object" ? db.raids : {})) {
      if (!r || typeof r.string !== "string" || !RAID_STRING.test(r.string)) continue;
      const events = byString.get(r.string) || new Map();
      for (const e of asList(r.events).map(raidEvent).filter(Boolean)) events.set(JSON.stringify(e), e);
      byString.set(r.string, events);
    }
  }
  const start = (str) => Number(str.split(".")[3]);
  return [...byString.entries()].filter(([, events]) => events.size > 0)
    .sort((a, b) => start(a[0]) - start(b[0]) || a[0].localeCompare(b[0]))
    .map(([string, events]) => ({ string, events: [...events.values()].sort((a, b) => a.t.localeCompare(b.t)).slice(0, 4000) }));
}

// ---------------------------------------------------------------------------
// Observations (inventory 3.2.0+; trainer events 3.9.0; taxi and flight events 3.11.0; tame events 3.13.0): KutzInventoryObsDB.events from Observations.lua, recorded while
// drop tracking is on (/kinv track; on by default since KutzInventory 1.13.0). Exported as observations = { v: 1, addon, events[] } only when there is
// at least one usable event. Each event keeps only the fields its type has, with the right types; everything else
// (anything about money, other players, unknown keys) is dropped. Ids are unique per install, so several saved files
// merge by id. At most 5000 events and about 2 MB of JSON, the newest kept.
// ---------------------------------------------------------------------------
const OBSERVATIONS_VERSION = 1;
const OBS_MAX_EVENTS = 5000;
const OBS_MAX_CHARS = 2000000;
const OBS_ID = /^[0-9a-z]{4,16}-[0-9]{1,12}$/;
const OBS_SRC_KINDS = ["mob", "boss", "chest", "fishing", "herb", "mine", "skin", "container", "quest", "vendor", "other"];
const OBS_GUID = /^(Creature|Vehicle|GameObject)-[0-9]+-[0-9]+-[0-9]+-[0-9]+-([0-9]+)-[0-9A-Fa-f]+$/;
const obsInt = (v, min = 0) => (Number.isInteger(v) && v >= min && v <= 2147483647 ? v : undefined);
const obsText = (v, re) => (typeof v === "string" && v.length >= 1 && v.length <= 64 && (!re || re.test(v)) ? v : undefined);
const obsCoord = (v) => (typeof v === "number" && v >= 0 && v <= 1 ? Math.round(v * 10000) / 10000 : undefined);
const pick = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));   // the defined values, in order

function obsWhere(w) {
  w = w && typeof w === "object" ? w : {};
  const itype = obsText(w.itype, /^[a-z]{1,20}$/);
  return pick({ map: obsInt(w.map), uiMap: obsInt(w.uiMap), itype, difficulty: itype ? obsInt(w.difficulty) : undefined,
                x: itype ? undefined : obsCoord(w.x), y: itype ? undefined : obsCoord(w.y) });
}
// who: level, class id, faction, and (3.3.0) the recording character's own name and surname. Never anyone else's.
const OBS_NAME = /^[^|\n\r\t]{1,40}$/;
function obsWho(w) {
  w = w && typeof w === "object" ? w : {};
  const name = obsText(w.name, OBS_NAME);
  return pick({ level: obsInt(w.level, 1), class: obsInt(w.class, 1), faction: obsText(w.faction, /^(Alliance|Horde|Neutral)$/),
                name, surname: name ? obsText(w.surname, OBS_NAME) : undefined });
}
// An item's short link (3.3.0): exactly "|cffRRGGBB|Hitem:<id>|h[<name>]|h|r" for this item's own id, else nothing.
const OBS_LINK = /^\|cff[0-9a-f]{6}\|Hitem:([0-9]{1,10})\|h\[[^\]|]{1,120}\]\|h\|r$/;
const obsLink = (link, id) => {
  const m = typeof link === "string" && link.length <= 200 ? OBS_LINK.exec(link) : null;
  return m && Number(m[1]) === id ? link : undefined;
};
// loot items only (3.7.0): won = true, this character won it by roll
const obsItems = (list, loot) => asList(list).map((it) => (it && typeof it === "object"
  ? pick({ id: obsInt(it.id, 1), n: obsInt(it.n, 1), link: obsLink(it.link, it.id), won: loot && it.won === true ? true : undefined })
  : {}))
  .filter((it) => it.id !== undefined && it.n !== undefined).slice(0, 2000);
// src: the GUID is kept only when it is a creature's or object's and agrees with the id; never a player's, pet's or item's
function obsSrc(s) {
  if (!s || typeof s !== "object" || !OBS_SRC_KINDS.includes(s.kind)) return null;
  const m = typeof s.guid === "string" ? OBS_GUID.exec(s.guid) : null;
  const what = m ? (m[1] === "GameObject" ? "object" : "npc") : null;
  const guidOk = m && s[what] === Number(m[2]);
  return pick({ kind: s.kind,
                npc: guidOk ? (what === "npc" ? s.npc : undefined) : obsInt(s.npc, 1),
                object: guidOk ? (what === "object" ? s.object : undefined) : (obsInt(s.npc, 1) === undefined ? obsInt(s.object, 1) : undefined),
                item: obsInt(s.item, 1), guid: guidOk ? s.guid : undefined, level: obsInt(s.level, 1),
                via: obsText(s.via, /^(slot|target|roll)$/), encounter: obsInt(s.encounter, 1),
                threshold: s.via === "roll" && Number.isInteger(s.threshold) && s.threshold >= 0 && s.threshold <= 7 ? s.threshold : undefined });
}
// A quest's words (3.6.0): accept carries title / details / objectives, turnin title / progress / completion. Strings
// only, trimmed, within each field's limit; anything else is dropped. Nothing when no field is left.
const OBS_CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/g;   // every control character but the line break
const OBS_TEXT = { accept: { title: 200, details: 8000, objectives: 4000 }, turnin: { title: 200, progress: 4000, completion: 8000 } };
function obsQuestText(t, act) {
  if (!t || typeof t !== "object") return undefined;
  const out = {};
  for (const [key, max] of Object.entries(OBS_TEXT[act])) {
    const s = typeof t[key] === "string" ? t[key].replace(OBS_CONTROL, "").trim() : "";
    if (s && s.length <= max) out[key] = s;
  }
  return Object.keys(out).length ? out : undefined;
}
// Quest extras (3.11.0). accept: the quest log's facts and the item that started it, each dropped alone when it fails its
// check. turnin: the reward window's XP, and rep, the reputation changes { f, d } (never a standing): all or nothing, so
// one bad entry, a repeated faction, a change of 0 or over 100000, or more than 6 entries drops rep; sorted by f.
const OBS_QUEST_FREQ = ["daily", "weekly"];
const OBS_REP = { max: 6, d: 100000 };
function obsQuestFacts(e) {
  const lv = obsInt(e.lv, 1), group = obsInt(e.group, 2);
  return pick({ lv: lv <= 255 ? lv : undefined, group: group <= 40 ? group : undefined,
                freq: OBS_QUEST_FREQ.includes(e.freq) ? e.freq : undefined, timed: e.timed === true ? true : undefined,
                startItem: obsInt(e.startItem, 1) });
}
const OBS_OBJECTIVE_TYPE = /^[a-z][a-z0-9_-]{0,39}$/;
const OBS_PROGRESS = /\d+\s*\/\s*\d+|\d+[.,]?\d*\s*%/;
function obsQuestObjectives(list) {
  const out = [];
  for (const row of asList(list)) {
    if (!row || typeof row !== "object") continue;
    const t = obsText(row.t, OBS_OBJECTIVE_TYPE), n = obsInt(row.n), text = obsProse(row.text, 400);
    if (t && n !== undefined && text && !OBS_PROGRESS.test(text)) out.push({ t, n, text });
    if (out.length === 12) break;
  }
  return out.length ? out : undefined;
}
const obsPercent = (v) => (typeof v === "number" && v >= 0 && v <= 100 ? Math.round(v * 100) / 100 : undefined);
function obsQuestPoi(list, map) {
  if (!obsInt(map, 1)) return undefined;
  const out = [], seen = new Set();
  for (const row of asList(list)) {
    if (!row || typeof row !== "object" || row.map !== map) continue;
    const x = obsPercent(row.x), y = obsPercent(row.y);
    if (x === undefined || y === undefined || (x === 0 && y === 0)) continue;
    const key = x + ":" + y;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ map, x, y });
    if (out.length === 8) break;
  }
  return out.length ? out : undefined;
}
function obsQuestRep(list) {
  if (!Array.isArray(list) && !(list && typeof list === "object")) return undefined;
  const rows = asList(list);
  if (!rows.length || rows.length > OBS_REP.max) return undefined;
  const seen = new Set(), out = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") return undefined;
    const f = obsInt(r.f, 1), d = r.d;
    if (f === undefined || seen.has(f) || !Number.isInteger(d) || d === 0 || Math.abs(d) > OBS_REP.d) return undefined;
    seen.add(f);
    out.push({ f, d });
  }
  return out.sort((a, b) => a.f - b.f);
}
function obsCost(list) {
  return asList(list).map((c) => {
    if (!c || typeof c !== "object") return {};
    return obsInt(c.item, 1) !== undefined ? { item: c.item, n: obsInt(c.n, 1) } : { currency: obsInt(c.currency, 1), n: obsInt(c.n, 1) };
  }).filter((c) => (c.item !== undefined || c.currency !== undefined) && c.n !== undefined).slice(0, 10);
}
// The trainer's reaction to the recording character (UnitReaction, 1 hated .. 8 exalted): prices already include its
// reputation discount, so rx tells a list price from a discounted one (3.9.0)
const obsReaction = (v) => (Number.isInteger(v) && v >= 1 && v <= 8 ? v : undefined);
// A short game label (spell, rank, skill or required ability name): no UI markup, no control characters, and nothing
// shaped like a GUID, so no player or creature GUID can ride in a name
const OBS_LABEL = /^[^|\u0000-\u001f\u007f]+$/;
const OBS_GUIDISH = /(Player|Creature|Pet|GameObject|Vehicle|Item|Vignette|BattlePet)-[0-9]+-[0-9]+/;
const obsLabel = (v, max) =>
  (typeof v === "string" && v.length >= 1 && v.length <= max && OBS_LABEL.test(v) && !OBS_GUIDISH.test(v) ? v : undefined);
const OBS_PROSE_UNSAFE = /[|\u0000-\u0009\u000b-\u001f\u007f]|[a-z]+-[0-9]+-[0-9]+/i;
const obsProse = (v, max) =>
  (typeof v === "string" && v.length <= max && v.trim() && !OBS_PROSE_UNSAFE.test(v) ? v : undefined);
const OBS_GOSSIP_KINDS = ["gossip", "greeting"];
const OBS_LINE_KINDS = ["say", "yell", "whisper", "emote", "boss"];
const OBS_TRAINER_KINDS = ["class", "profession"];
const OBS_TRAINER_STATES = ["a", "u", "k"];
const OBS_TRAINER_ROWS = 400;
// One service: a row without a usable name, cost or state is dropped; optional fields that fail their checks go
function obsTrainerRow(r) {
  if (!r || typeof r !== "object") return null;
  const name = obsLabel(r.name, 120), cost = obsInt(r.cost);
  if (name === undefined || cost === undefined || !OBS_TRAINER_STATES.includes(r.st)) return null;
  const needs = asList(r.needs).map((x) => obsLabel(x, 120)).filter((x) => x !== undefined).slice(0, 5);
  return pick({ s: obsInt(r.s, 1), name, rank: obsLabel(r.rank, 40), lv: obsInt(r.lv, 1), skill: obsLabel(r.skill, 64),
                skillReq: obsInt(r.skillReq, 1), needs: needs.length ? needs : undefined, cost, st: r.st });
}
// Hunter tames (3.13.0): the new pet's spellbook, [{ s, name, rank? }] by spell id, each id once, at most 24; its diet, the
// client's labels, each once, sorted, at most 8. A row or label that fails its check is dropped alone; nothing left: absent.
const OBS_TAME = { spells: 24, diet: 8 };
function obsTameSpells(list) {
  const out = [], seen = new Set();
  for (const r of asList(list)) {
    if (!r || typeof r !== "object") continue;
    const s = obsInt(r.s, 1), name = obsLabel(r.name, 120);
    if (s === undefined || name === undefined || seen.has(s)) continue;
    seen.add(s);
    out.push(pick({ s, name, rank: obsLabel(r.rank, 40) }));
  }
  return out.length ? out.sort((a, b) => a.s - b.s).slice(0, OBS_TAME.spells) : undefined;
}
function obsTameDiet(list) {
  const out = [...new Set(asList(list).map((x) => obsLabel(x, 40)).filter((x) => x !== undefined))].sort();
  return out.length ? out.slice(0, OBS_TAME.diet) : undefined;
}
function observationEvent(e) {
  if (!e || typeof e !== "object" || !obsText(e.id, OBS_ID) || obsInt(e.t, 1) === undefined || e.t > 1e11) return null;
  const base = { id: e.id, t: e.t, ...(obsText(e.b, /^[0-9][0-9.]{0,39}$/) ? { b: e.b } : {}), type: e.type };
  const place = () => ({ where: obsWhere(e.where), who: obsWho(e.who) });
  if (e.type === "loot") {
    const src = obsSrc(e.src);
    return src ? { ...base, src, ...place(), items: obsItems(e.items, true) } : null;
  }
  if (e.type === "quest") {
    if ((e.act !== "accept" && e.act !== "turnin") || obsInt(e.quest, 1) === undefined) return null;
    const giver = obsInt(e.npc, 1) !== undefined ? { npc: e.npc } : obsInt(e.object, 1) !== undefined ? { object: e.object } : {};
    const out = { ...base, act: e.act, quest: e.quest, ...giver, ...place() };
    if (e.act === "accept") {
      Object.assign(out, obsQuestFacts(e), pick({ obj: obsQuestObjectives(e.obj), poi: obsQuestPoi(e.poi, out.where.uiMap) }));
    }
    const text = obsQuestText(e.text, e.act);
    if (text) out.text = text;
    if (e.act === "turnin" && e.rewards && typeof e.rewards === "object") {
      const choices = asList(e.rewards.choices).filter((c) => obsInt(c, 1) !== undefined).slice(0, 20);
      out.rewards = { items: obsItems(e.rewards.items), choices, ...(choices.includes(e.rewards.chose) ? { chose: e.rewards.chose } : {}) };
    }
    if (e.act === "turnin") Object.assign(out, pick({ xp: obsInt(e.xp, 1), rep: obsQuestRep(e.rep) }));   // never the money
    return out;
  }
  if (e.type === "vendor") {
    if (obsInt(e.npc, 1) === undefined) return null;
    const items = asList(e.items).filter((it) => it && typeof it === "object" && obsInt(it.id, 1) !== undefined).slice(0, 500)
      .map((it) => {
        const cost = obsCost(it.cost);
        const link = obsLink(it.link, it.id);
        return { id: it.id, n: obsInt(it.n, 1) ?? 1, ...(link ? { link } : {}), price: obsInt(it.price) ?? 0, ...(cost.length ? { cost } : {}),
                 limited: obsInt(it.limited) ?? null };
      });
    const rx = obsReaction(e.rx);
    return { ...base, npc: e.npc, ...(rx ? { rx } : {}), ...(e.filtered === true ? { filtered: true } : {}), ...place(), items };
  }
  if (e.type === "trainer") {
    if (obsInt(e.npc, 1) === undefined || !OBS_TRAINER_KINDS.includes(e.kind)) return null;
    const rows = asList(e.rows).map(obsTrainerRow).filter(Boolean).slice(0, OBS_TRAINER_ROWS);
    if (!rows.length) return null;
    const rx = obsReaction(e.rx);
    return { ...base, npc: e.npc, kind: e.kind, ...(rx ? { rx } : {}), ...place(), rows };
  }
  if (e.type === "taxi") {
    if (obsInt(e.npc, 1) === undefined || obsInt(e.node, 1) === undefined) return null;
    const to = obsTaxiTo(e.to, e.node);
    if (!to) return null;
    const rx = obsReaction(e.rx);
    return { ...base, npc: e.npc, node: e.node, ...(rx ? { rx } : {}), ...place(), to };
  }
  if (e.type === "gossip") {
    const npc = obsInt(e.npc, 1), object = obsInt(e.object, 1), text = obsProse(e.text, 4000);
    if ((npc === undefined) === (object === undefined) || !text || !OBS_GOSSIP_KINDS.includes(e.kind)) return null;
    return { ...base, ...pick({ npc, object }), kind: e.kind, text, ...place() };
  }
  if (e.type === "read") {
    const item = obsInt(e.item, 1), object = obsInt(e.object, 1), page = obsInt(e.page, 1);
    const title = obsLabel(e.title, 200), text = obsProse(e.text, 8000);
    const material = obsLabel(e.material, 40);
    if ((item !== undefined && object !== undefined) || page === undefined || !title?.trim() || !text) return null;
    if (e.creator != null || ["author", "sender", "mail"].some((key) => e[key] != null && e[key] !== "" && e[key] !== false)
        || (typeof e.material === "string" && /mail|letter|stationery/i.test(e.material))) return null;
    return { ...base, ...pick({ item, object }), title, page, ...(e.last === true ? { last: true } : {}),
             ...(material?.trim() ? { material } : {}), text, ...place() };
  }
  if (e.type === "line") {
    const npc = obsInt(e.npc, 1), text = obsProse(e.text, 2000);
    if (npc === undefined || !text || /[^\x00-\x7f]/.test(text) || !OBS_LINE_KINDS.includes(e.kind)) return null;
    return { ...base, npc, kind: e.kind, text, ...place() };
  }
  if (e.type === "tame") {
    const npc = obsInt(e.npc, 1), lv = obsInt(e.lv, 1);
    if (npc === undefined) return null;                  // the creature id is never guessed: no id, no event
    const spd = Number.isInteger(e.spd) && e.spd >= 10 && e.spd <= 2000 ? e.spd : undefined;
    return { ...base, npc, ...pick({ lv: lv <= 255 ? lv : undefined, fam: obsNpcKind(e.fam), spells: obsTameSpells(e.spells), spd,
             spdAura: spd !== undefined && e.spdAura === true ? true : undefined, diet: obsTameDiet(e.diet) }), ...place() };
  }
  if (e.type === "flight") {
    if (obsInt(e.from, 1) === undefined || obsInt(e.to, 1) === undefined || e.from === e.to) return null;
    if (!Number.isInteger(e.sec) || e.sec < OBS_FLIGHT_SEC[0] || e.sec > OBS_FLIGHT_SEC[1]) return null;
    return { ...base, from: e.from, to: e.to, sec: e.sec, who: obsWho(e.who) };   // never a where: no position trail
  }
  return null;
}
// A flight master's list (3.11.0): every node reachable from its own, { node, cost (copper, a game price), hops? }, sorted
// by node. One bad entry (no node id, a node twice or the master's own, no cost) drops the whole list: a list with a
// node missing would read as that node unreachable. A bad hops only drops hops. At most 200 nodes.
const OBS_TAXI_NODES = 200;
const OBS_FLIGHT_SEC = [5, 3600];
function obsTaxiTo(list, own) {
  if (!Array.isArray(list) && !(list && typeof list === "object")) return null;
  const rows = asList(list);
  if (rows.length > OBS_TAXI_NODES) return null;
  const seen = new Set(), out = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") return null;
    const node = obsInt(r.node, 1), cost = obsInt(r.cost);
    if (node === undefined || cost === undefined || node === own || seen.has(node)) return null;
    seen.add(node);
    out.push(pick({ node, cost, hops: Number.isInteger(r.hops) && r.hops >= 1 && r.hops <= 100 ? r.hops : undefined }));
  }
  return out.sort((a, b) => a.node - b.node);
}
// ---------------------------------------------------------------------------
// The npcs summary (3.10.0, KutzInventory 1.17.0; svc 3.11.0): KutzInventoryObsDB.npcs[npcId] = { name, lv = { min, max }, boss,
// cls, ct, fam, rxA, rxH, sub, svc = { [service] = true }, spd, day, cells = { ["uiMap:cx:cy"] = n } }: one entry per creature
// the player looked at, updated in place (not events), cumulative per install. Exported as observations.npcs = [{ npc, name?,
// lv?, boss?, cls?, ct?, fam?, rxA?, rxH?, sub?, svc?, spd?, day, cells? }] sorted by npc, with observations.install naming the install(s) it summarises
// (the saved file's random prefix; several, sorted and joined by "+", when several saved files have one). An entry
// without a valid npc id or day is dropped; any other field that fails its check is left out. At most 3000 npcs, 40
// cells each and about 1 MB of JSON, the most recently seen kept.
// ---------------------------------------------------------------------------
const OBS_NPC_MAX = 3000;
const OBS_NPC_CELLS = 40;
const OBS_NPC_MAX_CHARS = 1000000;
const OBS_NPC_CLASSES = ["normal", "elite", "rare", "rareelite", "worldboss", "trivial", "minus"];
const OBS_NPC_DAY_MAX = 1157407;                       // 1e11 seconds (the events' time limit) in days
const OBS_PREFIX = /^[0-9a-z]{4,16}$/;
const OBS_CELL = /^([0-9]{1,10}):([0-9]{1,2}):([0-9]{1,2})$/;
const OBS_NPC_KEYS = ["npc", "name", "lv", "boss", "cls", "ct", "fam", "rxA", "rxH", "sub", "svc", "spd", "day", "cells"];
// svc (3.11.0): the services the NPC was seen to offer, a set; exported as a sorted list of these values
const OBS_NPC_SVC = ["vendor", "repair", "flight", "trainer", "bank", "guildbank", "inn", "auction", "stable", "battlemaster", "spirit",
  "guild", "tabard"];
// from the addon's { vendor = true, ... } set (only true values count) or an exported list; unknown values left out
function obsNpcSvc(v) {
  const list = Array.isArray(v) ? v : v && typeof v === "object" ? Object.entries(v).filter(([, on]) => on === true).map(([k]) => k) : [];
  const out = [...new Set(list.filter((x) => OBS_NPC_SVC.includes(x)))].sort();
  return out.length ? out : undefined;
}
// a creature type or family: the client's id, or its name when the client gave no id
const obsNpcKind = (v) => (Number.isInteger(v) ? (v >= 1 && v <= 100000 ? v : undefined) : obsLabel(v, 40));
const obsCellTotal = (cells) => (cells || []).reduce((n, c) => n + c[3], 0);
// cells: [[uiMap, cx, cy, n]] from a "uiMap:cx:cy" -> n map (or an exported list); the 40 most counted, sorted by place
function obsNpcCells(v) {
  const byKey = new Map();
  const add = (uiMap, cx, cy, n) => {
    if (obsInt(uiMap, 1) === undefined || !(Number.isInteger(cx) && cx >= 0 && cx <= 99) || !(Number.isInteger(cy) && cy >= 0 && cy <= 99)
        || obsInt(n, 1) === undefined) return;
    const key = `${uiMap}:${cx}:${cy}`;
    byKey.set(key, [uiMap, cx, cy, Math.min(2147483647, (byKey.get(key)?.[3] || 0) + n)]);
  };
  if (Array.isArray(v)) for (const c of v) { if (Array.isArray(c) && c.length === 4) add(...c); }
  else if (v && typeof v === "object") {
    for (const [key, n] of Object.entries(v)) {
      const m = OBS_CELL.exec(key);
      if (m) add(Number(m[1]), Number(m[2]), Number(m[3]), n);
    }
  }
  return [...byKey.values()].sort((a, b) => b[3] - a[3] || a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).slice(0, OBS_NPC_CELLS)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}
// the name and the subtitle: a label, never anything with "'s " (an owner's title such as "X's Pet"; the addon refuses it too)
const obsNpcText = (v) => { const s = obsLabel(v, 80); return s !== undefined && !s.includes("'s ") ? s : undefined; };
function obsNpc(id, n) {
  const npc = typeof id === "string" && /^[1-9][0-9]{0,9}$/.test(id) ? obsInt(Number(id), 1) : obsInt(id, 1);
  if (npc === undefined || !n || typeof n !== "object" || !Number.isInteger(n.day) || n.day < 1 || n.day > OBS_NPC_DAY_MAX) return null;
  const lv = asList(n.lv);
  const lvOk = lv.length === 2 && lv.every((x) => Number.isInteger(x) && x >= 1 && x <= 255) && lv[0] <= lv[1];
  const cells = obsNpcCells(n.cells);
  return pick({ npc, name: obsNpcText(n.name), lv: lvOk ? [lv[0], lv[1]] : undefined, boss: n.boss === true ? true : undefined,
                cls: OBS_NPC_CLASSES.includes(n.cls) ? n.cls : undefined, ct: obsNpcKind(n.ct), fam: obsNpcKind(n.fam),
                rxA: obsReaction(n.rxA), rxH: obsReaction(n.rxH), sub: obsNpcText(n.sub), svc: obsNpcSvc(n.svc),
                spd: Number.isInteger(n.spd) && n.spd >= 10 && n.spd <= 2000 ? n.spd : undefined, day: n.day,
                cells: cells.length ? cells : undefined });
}
// The same creature in two installs: the level range, services and cells add up; the rest comes from the one seen last
function mergeNpc(a, b) {
  const [newer, older] = b.day > a.day ? [b, a] : [a, b];
  const lv = a.lv && b.lv ? [Math.min(a.lv[0], b.lv[0]), Math.max(a.lv[1], b.lv[1])] : a.lv || b.lv;
  const cells = obsNpcCells([...(a.cells || []), ...(b.cells || [])]);
  const out = { ...older, ...newer, lv, boss: a.boss || b.boss, svc: obsNpcSvc([...(a.svc || []), ...(b.svc || [])]), day: newer.day,
                cells: cells.length ? cells : undefined };
  return pick(Object.fromEntries(OBS_NPC_KEYS.map((k) => [k, out[k]])));
}
const byRecent = (a, b) => b.day - a.day || obsCellTotal(b.cells) - obsCellTotal(a.cells) || a.npc - b.npc;
// -> { install, npcs } or null when no saved file has a usable summary
function exportNpcs(obsDbs) {
  const byPrefix = new Map();
  for (const db of obsDbs || []) {
    if (!db || typeof db !== "object" || !db.npcs || typeof db.npcs !== "object" || typeof db.prefix !== "string" || !OBS_PREFIX.test(db.prefix)) continue;
    const entries = Object.entries(db.npcs).map(([id, n]) => obsNpc(id, n)).filter(Boolean);
    if (!entries.length) continue;
    const latest = entries.reduce((m, e) => Math.max(m, e.day), 0);
    // the same install twice (a copied saved file): its newest copy, else the larger one, never both added up
    const prev = byPrefix.get(db.prefix);
    if (!prev || latest > prev.latest || (latest === prev.latest && entries.length > prev.entries.length)) byPrefix.set(db.prefix, { entries, latest });
  }
  if (!byPrefix.size) return null;
  const installs = [...byPrefix.keys()].sort();
  const merged = new Map();
  for (const p of installs) for (const e of byPrefix.get(p).entries) merged.set(e.npc, merged.has(e.npc) ? mergeNpc(merged.get(e.npc), e) : e);
  let npcs = [...merged.values()].sort(byRecent).slice(0, OBS_NPC_MAX);
  let chars = npcs.reduce((n, e) => n + JSON.stringify(e).length + 1, 0);
  while (chars > OBS_NPC_MAX_CHARS && npcs.length) chars -= JSON.stringify(npcs.pop()).length + 1;
  npcs = npcs.sort((a, b) => a.npc - b.npc);
  return npcs.length ? { install: installs.join("+"), npcs } : null;
}

const versionKey = (v) => String(v).split(".").map((x) => String(Number(x) || 0).padStart(6, "0")).join(".");
// obsDbs: each saved file's KutzInventoryObsDB (plain objects). -> the observations section, or null when there is nothing
function exportObservations(obsDbs) {
  const byId = new Map();
  let addon = null;
  for (const db of obsDbs || []) {
    if (!db || typeof db !== "object") continue;
    const events = asList(db.events).map(observationEvent).filter(Boolean);
    for (const e of events) byId.set(e.id, e);
    const v = obsText(db.addon, /^[0-9]+(\.[0-9]+){0,3}$/);
    const npcs = db.npcs && typeof db.npcs === "object" && Object.entries(db.npcs).some(([id, n]) => obsNpc(id, n));
    if ((events.length || npcs) && v && (!addon || versionKey(v) > versionKey(addon))) addon = v;
  }
  let events = [...byId.values()].sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(-OBS_MAX_EVENTS);
  let chars = events.reduce((n, e) => n + JSON.stringify(e).length + 1, 0);
  let drop = 0;
  while (chars > OBS_MAX_CHARS && drop < events.length) chars -= JSON.stringify(events[drop++]).length + 1;
  events = events.slice(drop);
  const summary = exportNpcs(obsDbs);
  if (!events.length && !summary) return null;
  return { v: OBSERVATIONS_VERSION, addon: addon || "unknown", ...(summary ? { install: summary.install } : {}), events,
           ...(summary ? { npcs: summary.npcs } : {}) };
}

// ---------------------------------------------------------------------------
// Items crafted (inventory 3.4.0+): KutzInventoryDB.chars[key].crafted from Crafts.lua, counted at each "You create"
// line since KutzInventory 1.10.0. Exported on the character as
//   crafted = { since, total, items: [{ itemId, name, count, crafts, lastAt }], days: [{ date, items: [{ itemId, count }] }] }
// items by itemId, days by date. An entry that is not what the addon writes is dropped, never the export. At most
// 5000 items (the most recently made are kept) and the newest 120 days. null when nothing usable was recorded.
// ---------------------------------------------------------------------------
const CRAFTED_MAX_ITEMS = 5000;
const CRAFTED_MAX_DAYS = 120;
const CRAFTED_DAY = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const craftedInt = (v, min) => (Number.isInteger(v) && v >= min && v <= 2147483647 ? v : undefined);
const craftedTime = (t) => (Number.isInteger(t) && t >= 1 && t <= 1e11 ? iso(t) : null);
const craftedId = (key) => (/^[1-9][0-9]{0,9}$/.test(key) ? craftedInt(Number(key), 1) : undefined);
function exportCrafted(c) {
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const table = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const items = Object.entries(table(c.items)).map(([key, it]) => {
    const itemId = craftedId(key);
    if (itemId === undefined || !it || typeof it !== "object") return null;
    const count = craftedInt(it.count, 1), crafts = craftedInt(it.crafts, 1);
    if (count === undefined || crafts === undefined) return null;
    return { itemId, name: plainName(it.name), count, crafts, lastAt: craftedTime(it.lastAt) };
  }).filter(Boolean)
    .sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || "") || a.itemId - b.itemId).slice(0, CRAFTED_MAX_ITEMS)
    .sort((a, b) => a.itemId - b.itemId);
  const days = Object.entries(table(c.days)).filter(([date]) => CRAFTED_DAY.test(date)).map(([date, made]) => ({
    date,
    items: Object.entries(table(made)).map(([key, n]) => ({ itemId: craftedId(key), count: craftedInt(n, 1) }))
      .filter((it) => it.itemId !== undefined && it.count !== undefined)
      .sort((a, b) => a.itemId - b.itemId).slice(0, CRAFTED_MAX_ITEMS),
  })).filter((d) => d.items.length > 0)
    .sort((a, b) => a.date.localeCompare(b.date)).slice(-CRAFTED_MAX_DAYS);
  if (!items.length && !days.length) return null;
  // the addon's running total; if it is unusable, what the items add up to
  const total = craftedInt(c.total, 0) ?? Math.min(items.reduce((n, it) => n + it.count, 0), 2147483647);
  return { since: craftedTime(c.since), total, items, days };
}

// Only numeric Legacy data crosses the saved-file boundary; names, config ids and unknown keys stay out.
function exportLegacyTree(v) {
  const object = (x) => x && typeof x === "object" && !Array.isArray(x);
  const int = (x, min = 0) => typeof x === "number" && Number.isSafeInteger(x) && x >= min && x <= 2147483647;
  if (!object(v) || !object(v.currency) || !object(v.trees)) return undefined;
  const { available, spent, max } = v.currency;
  if (![available, spent, max].every(x => int(x))) return undefined;
  const numericMap = (map) => Object.fromEntries(Object.entries(object(map) ? map : {})
    .filter(([id, n]) => /^[0-9]+$/.test(id) && int(n, 1)));
  const trees = {};
  for (const [id, tree] of Object.entries(v.trees)) {
    if (!/^[0-9]+$/.test(id) || !object(tree) || !int(tree.spentInTree) || !object(tree.nodes)) continue;
    trees[id] = { spentInTree: tree.spentInTree, nodes: numericMap(tree.nodes) };
  }
  if (!Object.keys(trees).length) return undefined;
  return { currency: { available, spent, max }, trees, choices: numericMap(v.choices) };
}

// -> { inventory (inventory-export 2.x, or 3.x with { format: 3 }), auctions (auction-scan documents), report (local profit report per character) }
function buildAll(dbs, uiHealthRaw, options = {}) {
  const format = options.format == null ? 3 : Number(options.format);
  if (!FORMATS[format]) throw new Error(`Unknown export format ${options.format}. Known: ${Object.keys(FORMATS).join(", ")}.`);
  const characters = new Map();
  const guilds = new Map();
  let warband = null;
  for (const db of dbs) {
    for (const [key, c] of Object.entries(db.chars || {})) {
      const prev = characters.get(key);
      if (prev && (prev.lastSeen || 0) >= (c.lastSeen || 0)) continue;   // same character in two accounts: newest wins
      characters.set(key, c);
    }
    for (const [key, g] of Object.entries(db.guilds || {})) {
      const prev = guilds.get(key);
      if (!prev || (prev.updated || 0) < (g.updated || 0)) guilds.set(key, g);
    }
    if (db.warband && (!warband || (warband.updated || 0) < (db.warband.updated || 0))) warband = db.warband;
  }

  const book = mergePrices(dbs);
  const crafted = new Map();                                    // character key -> crafted (3.4.0+; 2.x does not carry it)
  for (const [key, c] of characters) {
    const made = exportCrafted(c.crafted);
    if (made) crafted.set(key, made);
  }
  // Where the Hearthstone is set (inventory 3.5.0+; KutzInventory 1.11.0 records it). Absent until the game has said; 2.x never carries it.
  const hearths = new Map();                                    // character key -> place name
  for (const [key, c] of characters) {
    const at = plainName(c.hearth);
    if (at) hearths.set(key, at);
  }
  const chars = [...characters.entries()].map(([key, c]) => {
    const u = c.updated || {};
    const legacyTree = exportLegacyTree(c.legacyTree);
    return {
      key, name: c.name,
      ...(typeof c.surname === "string" && c.surname.trim() ? { surname: c.surname.trim() } : {}),
      realm: c.realm, level: c.level, class: c.class, classFile: c.classFile, race: c.race,
      faction: c.faction, sex: c.sex, spec: c.spec, role: c.role, guild: c.guild, guid: c.guid,
      money: c.money ?? null,                                   // in copper: gold = Math.floor(money / 10000)
      // an "XP needed" of 0 is the old logout bug (or the level cap): no real XP reading
      xp: c.xpMax > 0 ? c.xp ?? null : null, xpMax: c.xpMax > 0 ? c.xpMax : null, restedXP: c.restedXP ?? null,
      itemLevel: c.ilvl ?? null, itemLevelEquipped: c.ilvlEquipped ?? null,
      lastSeen: iso(c.lastSeen),
      recording: c.recording ? { savedAt: iso(c.recording.savedAt), checkpointAt: iso(c.recording.checkpointAt), checkpoint: c.recording.checkpoint, pending: asList(c.recording.pending), failed: asList(c.recording.failed), deferredStats: !!c.recording.deferredStats } : undefined,
      // Last good live/pre-leave location. In a dungeon / raid only { zone: instance name, instance: "dungeon" | "raid" }.
      location: c.location || null,
      // per profession (or "class"): what that trainer teaches, { name, skillReq, cost, reqLevel, status }
      trainers: c.trainers ? Object.fromEntries(Object.entries(c.trainers).map(([k, v]) => [k, asList(v)])) : undefined,
      updated: Object.fromEntries(Object.entries(u).map(([k, t]) => [k, iso(t)])),
      containers: [...containers(c.bags, "bags"), ...containers(c.bank, "bank")],
      equipped: equippedList(c.equipped),
      stats: c.stats || {},
      // the character pane, section by section: general, primary, weapons, modifiers, defense, resistances
      sheet: c.sheet || null,
      talents: c.talents ? { ...c.talents, trees: asList(c.talents.trees).map((t) => ({ ...t, points: asList(t.points) })),
                              tabs: c.talents.tabs ? asList(c.talents.tabs) : undefined,
                              groups: c.talents.groups ? asList(c.talents.groups) : undefined,
                              taken: asList(c.talents.taken), pvp: asList(c.talents.pvp) } : null,
      ...(legacyTree ? { legacyTree } : {}),
      professions: asList(c.professions),
      currencies: asList(c.currencies),
      skills: asList(c.skills),
      spells: asList(c.spells),
      reputation: asList(c.reputation),
      statistics: asList(c.statistics),
      achievementPoints: c.achievementPoints ?? null,
      pvp: c.pvp ? { ...c.pvp, rated: asList(c.pvp.rated) } : null,
      // one entry per profession; each recipe has reagents[] = { itemID, name, quantity, alternatives[] }
      recipes: Object.entries(c.recipes || {}).map(([profession, p]) => ({
        profession, professionID: p.professionID ?? null, skill: p.skill ?? null, max: p.max ?? null, updated: iso(p.updated),
        recipes: asList(p.recipes).map((r) => ({
          ...r,
          reagents: asList(r.reagents).map((x) => ({ ...x, alternatives: x.alternatives ? asList(x.alternatives) : undefined })),
          optional: r.optional ? asList(r.optional).map((x) => ({ ...x, alternatives: x.alternatives ? asList(x.alternatives) : undefined })) : undefined,
        })),
        // recipes not learned yet (only the ones the profession window listed): { recipeID, name, outputItemID, source }
        unlearned: p.unlearned ? asList(p.unlearned).map((u) => ({ ...u, reagents: u.reagents ? asList(u.reagents) : undefined })) : undefined,
      })),
    };
  }).sort((a, b) => a.key.localeCompare(b.key));

  // Profit per recipe is no longer exported (cr0m works it out from its catalog and the shared AH prices).
  // It is still printed locally: per profession, every recipe with material cost, vendor / AH value and profit,
  // and the levelling list (recipes still giving skill-ups, orange first, cheapest net cost first).
  const report = [...characters.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, c]) => ({ key, name: c.name, crafting: crafting(book, c) }));

  // every item a vendor sells or buys that we have seen, with its vendor buy / sell price
  const ids = new Set([...Object.keys(book.vendor), ...Object.keys(book.sell)]);
  const prices = Object.fromEntries([...ids].sort((a, b) => a - b).map((id) => [id, vendorPrice(book, id)]));
  const inventory = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    uiHealth: exportUiHealth(uiHealthRaw),
    prices,
    characters: chars,
    warband: warband ? { money: warband.money ?? null, updated: iso(warband.updated), updatedBy: warband.updatedBy ?? null,
                         containers: containers(warband.bank, "warband") } : null,
    guildBanks: [...guilds.entries()].map(([key, g]) => ({
      key, money: g.money ?? null, updated: iso(g.updated),
      tabs: containers(g.tabs, "guild").map((t) => ({ ...t, tab: t.bag, updated: iso(t.updated) })),
    })),
  };
  const v3 = () => toFormat3(inventory, exportRaids(dbs), exportObservations(options.observations), crafted, hearths);
  return { inventory: format === 3 ? v3() : inventory, auctions: auctionScans(book), report,
           ahItems: Object.keys(book.ah).length };
}
const build = (dbs, uiHealthRaw, options) => buildAll(dbs, uiHealthRaw, options).inventory;

// ---------------------------------------------------------------------------
// Addon-monitor snapshot (KutzUIDB.monitor.findings, copied onto KutzInventoryDB.uiHealth).
// Unix times stay numbers until here; the JSON uses ISO strings. Missing data is null, not omitted,
// so a page can tell "no reading yet" from an old exporter.
// ---------------------------------------------------------------------------
function exportUiHealth(raw) {
  if (!raw || typeof raw !== "object") return null;
  const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const s = (v) => (typeof v === "string" ? v : null);
  const list = (v, fn) => asList(v).filter((x) => x && typeof x === "object").map(fn);
  const session = raw.session || {};
  return {
    updatedAt: iso(n(raw.updated)),
    game: s(raw.game),
    session: {
      startedAt: iso(n(session.started)),
      endedAt: iso(n(session.ended)),
      minutes: n(session.minutes),
      fps: n(session.fps),
      errors: n(session.errors),
      errorsOmitted: n(session.errorsOmitted),
      blocked: n(session.blocked),
      hitches: n(session.hitches),
      hitchesInCombat: n(session.hitchesInCombat),
      worstMs: n(session.worstMs),
      addonsLoaded: n(session.addonsLoaded),
      cpuProfiling: session.cpuProfiling === true,
    },
    findings: list(raw.findings, (f) => ({
      rank: n(f.rank), tag: s(f.tag), score: n(f.score), addon: s(f.addon), text: s(f.text),
    })),
    errors: list(raw.errors, (e) => ({
      addon: s(e.addon), count: n(e.count), message: s(e.message),
      throughBlizzard: e.throughBlizzard === true,
      firstAt: iso(n(e.first)), lastAt: iso(n(e.last)),
      inCombat: e.inCombat === true,
      stack: s(e.stack),
    })),
    blocked: list(raw.blocked, (t) => ({
      addon: s(t.addon), kind: s(t.kind), fn: s(t.fn), count: n(t.count),
    })),
    memoryGrowth: list(raw.memoryGrowth, (g) => ({
      addon: s(g.addon), kbPerHour: n(g.kbPerHour), kb: n(g.kb),
    })),
    history: list(raw.history, (h) => ({
      startedAt: iso(n(h.started)),
      minutes: n(h.minutes), fps: n(h.fps), errors: n(h.errors),
      errorAddons: s(h.errorAddons) || "",
      blocked: n(h.blocked), hitches: n(h.hitches), worstMs: n(h.worstMs),
      cpuTop: s(h.cpuTop) || "",
    })),
  };
}

function uiHealthStamp(raw) {
  return raw && typeof raw.updated === "number" && Number.isFinite(raw.updated) ? raw.updated : -Infinity;
}
function newerUiHealth(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return uiHealthStamp(b) >= uiHealthStamp(a) ? b : a;
}
// ---------------------------------------------------------------------------
// One or more saved files (one per WoW account) -> buildAll's result, merged the way the exporter merges them.
// texts: the files' contents as strings. The Kutz UI monitor's snapshot comes from each file's KutzInventoryDB.uiHealth
// (the exporter also reads a sibling KutzUI.lua when it has the folder; a page only has the file it was given).
// Throws when a file has no KutzInventoryDB: it is not KutzInventory's saved file. A file's KutzInventoryObsDB (drop
// tracking, /kinv track) is read from the same file when it is there.
// ---------------------------------------------------------------------------
function convertSavedVariables(texts, options) {
  const dbs = [];
  const observations = [];
  let health = null;
  texts.forEach((text, n) => {
    const parsed = parseSavedVariables(String(text));
    if (parsed.KutzInventoryObsDB instanceof Map) observations.push(plain(parsed.KutzInventoryObsDB));
    const db = parsed.KutzInventoryDB ? plain(parsed.KutzInventoryDB) : null;
    if (!db || typeof db !== "object") {
      throw Object.assign(new Error(`file ${n + 1} has no KutzInventoryDB`), { code: "not-kutz-inventory", file: n });
    }
    dbs.push(db);
    health = newerUiHealth(health, db.uiHealth || null);
  });
  return buildAll(dbs, health, { ...(options || {}), observations });
}

return { SCHEMA_VERSION, SCHEMA_VERSION_3, FORMATS, AUCTION_SCHEMA_VERSION, DROPPED_IN_3, MAX_TABLE_DEPTH,
  parseSavedVariables, plain, buildAll, build, toFormat3, auctionScans, exportRaids, RAID_STRING,
  exportObservations, exportNpcs, OBSERVATIONS_VERSION, exportCrafted, exportUiHealth, newerUiHealth, convertSavedVariables };
});
