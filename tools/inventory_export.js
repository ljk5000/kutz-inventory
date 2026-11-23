#!/usr/bin/env node
// Turns KutzInventory's saved file into one JSON file.
//
//   node tools/inventory_export.js [--upload] [--watch] [path\to\KutzInventory.lua] [output file]
//
// Defaults: every account's SavedVariables\KutzInventory.lua under the WoW Forever WTF folder (merged),
// written to <repo>\export\inventory.json. No npm packages needed.
//
// --upload POSTs that JSON to cr0m (or any server that accepts the same request). It needs two environment variables and never prints them:
//   WOW_IMPORT_TOKEN   bearer token (Authorization: Bearer ...)
//   WOW_IMPORT_URL     full URL of the import endpoint, for example https://<host>/api/wow/import
// --watch re-reads the saved file when the game rewrites it (/reload or logout) and exports again.
// With --upload, the game's quest cache (Cache\WDB\<locale>\questcache.wdb beside the WTF folder) is sent too, new or
// changed quests only (tools/quest_cache_sender.js); --no-quest-cache leaves it out.
// With both, a reload uploads. The request is described below; the JSON format is in schema/README.md.
// Writes inventory 3.x by default (only what the Battle.net API cannot see); --format 2 writes the older 2.x.
"use strict";
const fs = require("fs");
const path = require("path");
// Reading the saved file and building the JSON is pure (tools/convert.js); cr0m's upload page runs the same code.
const {
  SCHEMA_VERSION, SCHEMA_VERSION_3, FORMATS, AUCTION_SCHEMA_VERSION, DROPPED_IN_3,
  parseSavedVariables, plain, buildAll, build, toFormat3, exportUiHealth, newerUiHealth,
} = require("./convert");

const WTF = "C:\\Program Files (x86)\\World of Warcraft\\_forever_\\WTF\\Account";

function readGlobal(file, name) {
  const parsed = parseSavedVariables(fs.readFileSync(file, "utf8"));
  if (!parsed[name]) return null;
  return plain(parsed[name]);
}

// The monitor writes KutzUIDB.monitor.findings. KutzInventory copies that onto KutzInventoryDB.uiHealth
// at logout, but the two addons' logout handlers can run in either order, so the newer stamp wins.
function uiHealthFor(invFile, invDb) {
  let best = invDb && invDb.uiHealth;
  const sibling = path.join(path.dirname(invFile), "KutzUI.lua");
  if (fs.existsSync(sibling)) {
    const kutz = readGlobal(sibling, "KutzUIDB");
    const findings = kutz && kutz.monitor && kutz.monitor.findings;
    best = newerUiHealth(best, findings);
  }
  return best || null;
}

function redact(text) {
  const token = process.env.WOW_IMPORT_TOKEN;
  let out = String(text == null ? "" : text);
  if (token) out = out.split(token).join("[redacted]");
  return out;
}

// Uploads. Every request:
//   POST <url>
//   Authorization: Bearer <WOW_IMPORT_TOKEN>      (a personal kutz_ key from cr0m's settings page)
//   Content-Type: application/json
//   Content-Encoding: gzip
//   Body: gzipped JSON. cr0m detects gzip by its first two bytes, so it unpacks the body whether or not a proxy
//   keeps the header. About 10x smaller.
// Inventory goes to WOW_IMPORT_URL (the full snapshot, not a patch). Auction scans go to WOW_AUCTIONS_URL, or by
// default the same address with /api/wow/import replaced by /api/wow/auctions.
// Watch mode retries transient failures; permanent failures wait for a new save.
const gzipJson = (data) => require("zlib").gzipSync(Buffer.from(JSON.stringify(data), "utf8"));

function uploadTarget(name, url) {
  const token = process.env.WOW_IMPORT_TOKEN;
  if (!token) {
    throw Object.assign(new Error("Upload needs WOW_IMPORT_TOKEN (your cr0m upload key). Nothing was sent."), { retryable: false });
  }
  if (!url) {
    throw Object.assign(new Error("Upload needs WOW_IMPORT_URL (the full import URL, for example https://<host>/api/wow/import). Nothing was sent."), { retryable: false });
  }
  // The token is a bearer credential: never send it in clear text (plain http only to this PC, for tests).
  let target;
  try { target = new URL(url); } catch { target = null; }
  if (!target || !(target.protocol === "https:" || (target.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)))) {
    throw Object.assign(new Error(name + " must be an https:// URL. Nothing was sent."), { retryable: false });
  }
  if (typeof fetch !== "function") {
    throw new Error("This Node is too old for fetch. Use Node 18 or newer. Nothing was sent.");
  }
  return { token, url: target.href };
}

// -> the parsed JSON acknowledgement. A failure carries status, retryable, retryAfter (seconds) and detail.
async function postGzipJson(name, url, data) {
  const target = uploadTarget(name, url);
  let res;
  try {
    res = await fetch(target.url, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: "Bearer " + target.token,
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
        Accept: "application/json",
      },
      body: gzipJson(data),
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined,
    });
  } catch (e) {
    throw new Error("Upload was not acknowledged (" + redact(e && e.message) + "). The local export is saved; retrying it is safe.");
  }
  const body = redact(await res.text().catch(() => ""));
  if (res.status < 200 || res.status >= 300) {
    const snippet = body.replace(/\s+/g, " ").slice(0, 500);
    let detail = null;
    try { detail = JSON.parse(body).error || null; } catch { detail = null; }
    throw Object.assign(new Error("The server rejected the upload (HTTP " + res.status + ")" + (snippet ? ": " + snippet : "") + "."), {
      status: res.status, detail, retryAfter: Number(res.headers.get("retry-after")) || null,
      retryable: res.status === 408 || res.status === 429 || res.status >= 500,
    });
  }
  try { return JSON.parse(body); } catch { return {}; }
}

async function uploadExport(data) {
  await postGzipJson("WOW_IMPORT_URL", process.env.WOW_IMPORT_URL, data);
  console.log("Uploaded (" + new Date().toISOString() + ").");
}

function auctionsUrl() {
  if (process.env.WOW_AUCTIONS_URL) return process.env.WOW_AUCTIONS_URL;
  const imp = process.env.WOW_IMPORT_URL;
  if (!imp) return imp;
  try { const u = new URL(imp); u.pathname = u.pathname.replace(/\/import\/?$/, "/auctions"); return u.href; } catch { return imp; }
}
const uploadAuctionScan = (doc) => postGzipJson("WOW_AUCTIONS_URL", auctionsUrl(), doc);

// Quest-cache documents go to WOW_QUEST_CACHE_URL, or by default the import address with /import replaced by /quest-cache.
function questCacheUrl() {
  if (process.env.WOW_QUEST_CACHE_URL) return process.env.WOW_QUEST_CACHE_URL;
  const imp = process.env.WOW_IMPORT_URL;
  if (!imp) return imp;
  try { const u = new URL(imp); u.pathname = u.pathname.replace(/\/import\/?$/, "/quest-cache"); return u.href; } catch { return imp; }
}
const uploadQuestCache = (doc) => postGzipJson("WOW_QUEST_CACHE_URL", questCacheUrl(), doc);

// The game client folder of a saved file: <game>\WTF\Account\<account>\SavedVariables\KutzInventory.lua. null otherwise.
function gameFolderOf(savedFile) {
  const saved = path.dirname(path.resolve(savedFile)), account = path.dirname(saved), accounts = path.dirname(account), wtf = path.dirname(accounts);
  if (path.basename(saved).toLowerCase() !== "savedvariables" || path.basename(accounts).toLowerCase() !== "account" || path.basename(wtf).toLowerCase() !== "wtf") return null;
  return path.dirname(wtf);
}

function parseArgs(argv) {
  const flags = { upload: false, watch: false, help: false, noInventory: false, noAuctions: false, noQuestCache: false, format: 3 };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--format" || a.startsWith("--format=")) {
      const v = a === "--format" ? argv[++i] : a.slice("--format=".length);
      if (!FORMATS[v]) {
        console.error(`--format must be one of ${Object.keys(FORMATS).join(", ")} (got ${v === undefined ? "nothing" : JSON.stringify(v)}).`);
        process.exit(2);
      }
      flags.format = Number(v);
    }
    else if (a === "--upload") flags.upload = true;
    else if (a === "--watch") flags.watch = true;
    else if (a === "--no-inventory") flags.noInventory = true;     // with --upload: auction prices only (a "service" character)
    else if (a === "--no-auctions") flags.noAuctions = true;       // with --upload: characters only
    else if (a === "--no-quest-cache") flags.noQuestCache = true;  // with --upload: not the game's quest cache
    else if (a === "--help" || a === "-h") flags.help = true;
    else if (a.startsWith("-")) {
      console.error("Unknown option " + a + ". Known options: --upload, --watch, --no-inventory, --no-auctions, --no-quest-cache, --format, --help.");
      process.exit(2);
    } else pos.push(a);
  }
  return { ...flags, input: pos[0], output: pos[1] };
}

function help() {
  console.log(`Writes export/inventory.json from KutzInventory's saved file.

  node tools/inventory_export.js [--upload] [--watch] [KutzInventory.lua] [output.json]

  --upload   POST the JSON to WOW_IMPORT_URL with Authorization: Bearer WOW_IMPORT_TOKEN
  --watch    after the first export, export again whenever the saved file changes
  --no-inventory   with --upload: send auction house prices only (a price-gathering "service" character)
  --no-auctions    with --upload: send your characters only
  --no-quest-cache with --upload: don't send the game's quest cache (quest facts from Cache\\WDB, new or changed
                   quests only, to WOW_QUEST_CACHE_URL or the import URL's /quest-cache)
  --format 2       write the older inventory 2.x (everything the addon records). The default is 3: only what the
                   Battle.net API can't see; cr0m reads the rest from the API. See schema/README.md.

With no file path, every account's SavedVariables\\\\KutzInventory.lua under the Forever WTF folder is merged.`);
}

// ---------------------------------------------------------------------------
function findSavedFiles() {
  if (!fs.existsSync(WTF)) return [];
  return fs.readdirSync(WTF)
    .map((acc) => path.join(WTF, acc, "SavedVariables", "KutzInventory.lua"))
    .filter((p) => fs.existsSync(p));
}

// The auction-scan documents go beside the inventory: inventory.json -> auction-scans.json (a JSON array).
const auctionsFileFor = (outFile) => path.join(path.dirname(outFile), "auction-scans.json");

// -> { inventory, auctions, report }. Writes inventory.json and auction-scans.json.
function exportAll(files, outFile, options = {}) {
  const dbs = [];
  const observations = [];                       // each file's KutzInventoryObsDB (drop tracking), when there is one
  let health = null;
  for (const f of files) {
    const parsed = parseSavedVariables(fs.readFileSync(f, "utf8"));
    const db = parsed.KutzInventoryDB ? plain(parsed.KutzInventoryDB) : null;
    if (!db) throw new Error(`${f} has no KutzInventoryDB`);
    dbs.push(db);
    if (parsed.KutzInventoryObsDB) observations.push(plain(parsed.KutzInventoryObsDB));
    health = newerUiHealth(health, uiHealthFor(f, db));
  }
  const all = buildAll(dbs, health, { ...options, observations });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(all.inventory, null, 1));
  fs.writeFileSync(auctionsFileFor(outFile), JSON.stringify(all.auctions, null, 1));
  return all;
}
const exportOnce = (files, outFile) => exportAll(files, outFile).inventory;

function summarize(files, all, outFile) {
  const data = all.inventory;
  const stacks = (boxes) => boxes.reduce((t, b) => t + b.items.length, 0);
  const items = data.characters.reduce((t, c) => t + stacks(c.containers), 0)
    + (data.warband ? stacks(data.warband.containers) : 0)
    + data.guildBanks.reduce((t, g) => t + stacks(g.tabs), 0);
  console.log(`Read ${files.length} file(s): ${data.characters.length} character(s), ${items} item stacks.`);
  console.log(`Wrote ${outFile}`);
  // a short report: the best vendor profits, and the cheapest way to level, per profession
  const g = (c) => (c == null ? "?" : `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 10000)}g ${Math.floor(Math.abs(c) / 100) % 100}s ${Math.abs(c) % 100}c`);
  console.log(`Prices: ${Object.keys(data.prices).length} items with vendor prices, ${all.ahItems} with AH data (/kinv ah at the auction house adds more).`);
  for (const a of all.auctions) {
    console.log(`AH scan of ${a.realm} (${a.house}${a.houseSource === "player" ? ", from your faction" : ""}): ${Object.keys(a.items).length} items, ${a.complete ? "complete" : "partial"}, ${a.scannedAt}.`);
  }
  if (all.auctions.length) console.log(`Wrote ${auctionsFileFor(outFile)}`);
  for (const a of all.auctions) {
    const kb = Buffer.byteLength(JSON.stringify(a)) / 1024;
    if (kb > 4500) console.log(`Warning: the ${a.realm} (${a.house}) scan is ${Math.round(kb)} KB unpacked; cr0m accepts up to 5 MB.`);
  }
  for (const c of all.report) {
    for (const p of c.crafting) {
      const wins = p.recipes.filter((r) => r.vendorProfit != null && r.vendorProfit > 0).slice(0, 5);
      const lv = p.levelling.slice(0, 3);
      if (!wins.length && !lv.length) continue;
      console.log(`
${c.name} - ${p.profession} ${p.skill ?? "?"}/${p.max ?? "?"}`);
      for (const r of wins) console.log(`  profit selling to a vendor: ${r.name}  +${g(r.vendorProfit)}  (materials ${g(r.materialCost)})${r.learned ? "" : "  [not learned]"}`);
      for (const r of lv) console.log(`  level with: ${r.name} (${r.difficulty})  net ${g(r.netCostPerCraft)} per craft`);
    }
  }
  const uh = data.uiHealth;
  if (!uh) console.log("UI health: no monitor snapshot yet (open /kutz mon, or /reload with the Addon monitor module on).");
  else {
    const n = (uh.findings || []).length;
    const sess = uh.session || {};
    console.log(`UI health: ${n} finding(s), ${sess.errors == null ? "?" : sess.errors} error(s), ${sess.blocked == null ? "?" : sess.blocked} blocked, as of ${uh.updatedAt || "?"}.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { help(); return; }
  const outFile = path.resolve(args.output || path.join(__dirname, "..", "export", "inventory.json"));
  const { acquireOutputLock } = require("./output_lock");
  const release = await acquireOutputLock(outFile);
  process.once("SIGINT", () => process.exit(0));
  process.once("SIGTERM", () => process.exit(0));
  const { createOutbox } = require("./upload_outbox");
  const outbox = createOutbox(outFile + ".pending.json", uploadExport);
  if (args.upload && args.noInventory && args.noAuctions) { console.error("--no-inventory and --no-auctions together leave nothing to upload."); process.exit(2); }
  if (args.upload && !args.noInventory) {
    try { await outbox.flush(); }
    catch (e) {
      if (!args.watch) throw e;
      console.error(redact(e && e.message ? e.message : e));
    }
  }
  const files = args.input ? [args.input] : findSavedFiles();
  if (files.length === 0) {
    console.error("No KutzInventory.lua found. Log in with the addon on, then /reload or log out, or pass the file path.");
    process.exit(1);
  }
  for (const f of files) {
    if (!fs.existsSync(f)) {
      console.error("Saved file not found: " + f);
      process.exit(1);
    }
  }

  const { createAuctionSender } = require("./auction_sender");
  const auctions = createAuctionSender(outFile + ".auctions-sent.json", uploadAuctionScan, { log: (m) => console.log(m) });
  // The quest cache of each game folder the saved files are in (not sent when the site answers 404 or 405).
  let questCache = null;
  const games = [...new Set(files.map(gameFolderOf).filter(Boolean))];
  if (args.upload && !args.noQuestCache && games.length) {
    const { createQuestCacheSender, questCacheContext } = require("./quest_cache_sender");
    const { COMPANION_VERSION } = require("../companion/version");
    let origin = "";
    try { origin = new URL(questCacheUrl()).origin; } catch { origin = ""; }
    questCache = createQuestCacheSender(outFile + ".quest-cache-sent.json", uploadQuestCache, {
      context: questCacheContext({ origin, username: "" }), companion: COMPANION_VERSION, log: (m) => console.log(m),
    });
  }
  async function run() {
    const all = exportAll(files, outFile, { format: args.format });
    summarize(files, all, outFile);
    if (args.upload) {
      if (!args.noInventory) await outbox.send(all.inventory);
      if (!args.noAuctions) await auctions.send(all.auctions);
      for (const game of questCache ? games : []) {
        const sent = await questCache.send(game);
        if (sent.caches) console.log(`Quest cache: ${sent.sent} new or changed quest(s) sent, ${sent.unchanged} unchanged.`);
        if (sent.unsupported) { questCache = null; break; }
      }
    }
  }

  if (!args.watch) { await run(); return; }
  console.log("Watching for the game to rewrite the saved file (/reload or logout). Leave this running.");
  const { createExportQueue } = require("./export_queue");
  const queue = createExportQueue(run, e => console.error(redact(e && e.message ? e.message : e)));
  for (const f of files) {
    fs.watchFile(f, { interval: 1000 }, (cur, prev) => {
      if (cur.mtimeMs !== prev.mtimeMs) queue.kick();
    });
  }
  queue.kick();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(redact(e && e.message ? e.message : e));
    process.exit(1);
  });
}
module.exports = { SCHEMA_VERSION, SCHEMA_VERSION_3, DROPPED_IN_3, toFormat3, AUCTION_SCHEMA_VERSION, uploadExport, uploadAuctionScan, auctionsUrl, questCacheUrl, gameFolderOf, gzipJson,
  buildAll, exportAll, auctionsFileFor, parseSavedVariables, plain, build, exportUiHealth, newerUiHealth, exportOnce, redact };
