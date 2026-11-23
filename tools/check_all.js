// Runs every offline check for KutzInventory, the exporter, the export schema and the Companion.
// Usage (from tools/, after npm ci):  node check_all.js [../KutzInventory]
"use strict";
const { spawnSync } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");
const addon = path.resolve(process.argv[2] || path.join(root, "KutzInventory"));
let failed = 0;
function node(args) {
    const r = spawnSync(process.execPath, args, { encoding: "utf8", cwd: __dirname });
    return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}
function report(label, ok, detail) {
    console.log((ok ? "PASS  " : "FAIL  ") + label);
    if (!ok) { failed++; if (detail && detail.trim()) console.log(detail.trim().split("\n").map(l => "      " + l).join("\n")); }
}
const tool = (f) => path.join(__dirname, f);

let r = node([tool("check.js"), addon]);
report("KutzInventory: syntax (Lua 5.1, what WoW runs)", /^OK/m.test(r.out) && !/^FAIL/m.test(r.out), r.out);
r = node([tool("limits.js"), addon]);
report("KutzInventory: under the Lua 5.1 load limits (60 upvalues / 200 locals)", /No function is over/.test(r.out), r.out);
r = node([tool("globals.js"), addon]);
report("KutzInventory: no unexpected global names", /\(none\)/.test(r.out), r.out);
r = node([tool("check_prices.js")]);
report("AH prices per auction house, scan records, legacy migration, no-answer items left out", r.ok && /^OK/m.test(r.out), r.out);
r = node([tool("check_scheduling.js")]);
report("scan scheduling, retries and failure recovery", r.ok, r.out);
r = node([tool("check_raids.js")]);
report("raid tracking: /kinv raid, raid string shape, active window, events, loot lines, caps and pruning", r.ok && /^OK/m.test(r.out) && !/^FAIL/m.test(r.out), r.out);
r = node([tool("check_observations.js")]);
report("drop tracking: on by default for a new install, /kinv track, one-time note, loot / quest (with its objectives, places, level, XP and reputation changes) / vendor / trainer / taxi / flight / gossip / read / line / tame / credit events, the npcs summary and its services, no gold, standings or other players, caps",
    r.ok && /^OK/m.test(r.out) && !/^FAIL/m.test(r.out), r.out);
r = node([tool("check_crafts.js")]);
report("items crafted: own 'You create' lines only, stacks, per-day counts, the 120-day window, export shape, nothing crafted unchanged",
    r.ok && /^OK/m.test(r.out) && !/^FAIL/m.test(r.out), r.out);
r = node([tool("check_facts.js"), addon]);
report("item facts: read once per item and game build from a link of id and suffix alone, queued, never in combat, capped by bytes; random suffixes as variants of one item; kills per day; /kinv perf; unlearned recipes saved once per account file (undone = the original, exports identical); statistics per day; every vendor of an item",
    r.ok && /^OK/m.test(r.out) && !/^FAIL/m.test(r.out), r.out);
r = node([tool("check_inventory_logout.js")]);
report("reload, logout and exit snapshots; trainers (no Beast Training); reputation and quest log headers put back; quest log modern/legacy reads; Legacy tree ranks/events/nil APIs and guild loading", r.ok && /^OK/m.test(r.out), r.out);
r = node([tool("check_legacy_challenges.js")]);
report("Legacy challenges: login read, saved only when changed, 30 s limit, never in combat, set 61 once started, guarded answers, /kinv scan and checkpoint, a client without the functions",
    r.ok && /^OK/m.test(r.out) && !/^FAIL/m.test(r.out), r.out);
r = node([tool("check_character_identity.js")]);
report("same-name characters: GUID ownership, stable keys, isolated data and export", r.ok && /^OK/m.test(r.out), r.out);
r = node([tool("check_export.js")]);
report("inventory export 2.x and 3.x and auction scans (schemas, dropped 3.x fields, gzip uploads, upload errors)", /OK   inventory export/.test(r.out) && !/FAIL/.test(r.out), r.out);
r = node([tool("examples.js")]);
report("schema/examples: inventory 2.x and 3.x examples match the exporter and their schemas", r.ok && /^OK/m.test(r.out), r.out);
r = node(["--test", tool("convert.test.js")]);
report("convert.js: runs with no Node globals, CLI output unchanged, the example .lua converts exactly, nesting limit", r.ok, r.out);
r = node(["--test", tool("tooltip_clean.test.js")]);
report("tooltip cleaner: what is the item's stays, what is the reading character's goes; the copy inside convert.js is the module's", r.ok, r.out);
r = node(["--test", tool("export_queue.test.js"), tool("upload_outbox.test.js"), tool("upload_ack.test.js"), tool("auction_sender.test.js")]);
report("export watch queue, retries, upload acknowledgements, and auction scans sent once per scan", r.ok, r.out);
if (Number(process.versions.node.split(".")[0]) >= 22) {
    r = node(["--test", path.join(root, "companion", "companion.test.js"), tool("package_release.test.js")]);
    report("companion HTTP, watch lifecycle, locks and distribution", r.ok, r.out);
} else {
    console.log("SKIP  companion checks: Node 22+ required");
}
console.log(failed === 0 ? "\nALL CHECKS PASSED" : "\n" + failed + " CHECK(S) FAILED");
process.exit(failed === 0 ? 0 : 1);
