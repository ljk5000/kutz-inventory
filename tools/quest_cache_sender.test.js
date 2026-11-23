"use strict";
// The quest cache sender: only new or changed quests, state recorded after a 2xx only, quiet on a site without the endpoint.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createQuestCacheSender, questCacheContext, findQuestCaches } = require("./quest_cache_sender");
const { validateQuestCache } = require("./validate_export");

const FIXTURE = path.join(__dirname, "fixtures", "questcache-71037-enUS.wdb");
const QUEST_KEYS = new Set(["id", "level", "minLevel", "sort", "info", "next", "xpDifficulty", "xpMultiplier", "money", "spell", "startItem", "items", "choose", "rep", "currencies"]);
const err = (status, extra = {}) => Object.assign(new Error("HTTP " + status), { status, retryable: status === 429 || status >= 500 }, extra);

// A game folder holding the fixture as Cache/WDB/<locale>/questcache.wdb, and a sender with its state beside an export.
function setup(t, post, { locale = "enUS", context = questCacheContext({ origin: "https://wow.cr0m.com", username: "someone" }), ...opts } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kutz-questcache-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const game = path.join(root, "Private Person", "_forever_");
  const cacheFile = path.join(game, "Cache", "WDB", locale, "questcache.wdb");
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.copyFileSync(FIXTURE, cacheFile);
  const stateFile = path.join(root, "export", "inventory.json.quest-cache-sent.json");
  const logs = [], sleeps = [];
  const make = (ctx = context, p = post) => createQuestCacheSender(stateFile, p, { context: ctx, companion: "0.12.8", minGapMs: 10500,
    sleep: async (ms) => { sleeps.push(ms); }, log: (m) => logs.push(m), ...opts });
  return { root, game, cacheFile, stateFile, logs, sleeps, make, sender: make(),
    state: () => JSON.parse(fs.readFileSync(stateFile, "utf8")),
    // Changes one quest's money in the game's copy: quest 78150, record found by scanning the file.
    changeMoney(id, money) {
      const b = fs.readFileSync(cacheFile); let at = 24;
      for (;;) {
        const rid = b.readUInt32LE(at), size = b.readUInt32LE(at + 4);
        if (!rid && !size) throw new Error("no quest " + id);
        if (rid === id) { b.writeInt32LE(money, at + 8 + 48); break; }
        at += 8 + size;
      }
      fs.writeFileSync(cacheFile, b);
    } };
}
function recorder(answer = () => ({ ok: true })) {
  const posted = [];
  const post = async (doc) => { posted.push(JSON.parse(JSON.stringify(doc))); return answer(doc, posted.length); };
  return { posted, post, ids: () => posted.flatMap((d) => d.quests.map((q) => q.id)) };
}
function snapshot(dir) {
  const out = {};
  for (const name of fs.readdirSync(dir, { recursive: true }).map(String).sort()) {
    const p = path.join(dir, name), s = fs.statSync(p);
    out[name] = s.isFile() ? [s.size, s.mtimeMs, crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")] : "dir";
  }
  return out;
}

test("first run sends every quest, the second none, a changed quest alone; nothing under the game folder changes", async (t) => {
  const r = recorder();
  const s = setup(t, r.post);
  const before = snapshot(s.game);
  const first = await s.sender.send(s.game);
  assert.equal(first.caches, 1); assert.equal(first.sent, 8); assert.equal(first.unchanged, 0); assert.equal(first.unsupported, false);
  assert.equal(r.posted.length, 1);
  const doc = r.posted[0];
  assert.equal(doc.schemaVersion, "1.0.0"); assert.equal(doc.kind, "quest-cache"); assert.equal(doc.build, 71037); assert.equal(doc.locale, "enUS");
  assert.deepEqual(doc.supportedBuilds, [70938, 71037]); assert.equal(doc.companion, "0.12.8"); assert.equal(doc.total, 8);
  assert.deepEqual(doc.quests.map((q) => q.id), [257, 1003, 1097, 2359, 8372, 78150, 94238, 98372]);
  assert.deepEqual(validateQuestCache(doc), []);
  for (const q of doc.quests) for (const k of Object.keys(q)) assert.ok(QUEST_KEYS.has(k), "a key outside the schema: " + k);
  // Nothing personal: no path, folder or account name, no time.
  const text = JSON.stringify(doc);
  for (const bad of ["Private Person", "_forever_", "someone", os.userInfo().username, s.root, "T0", "Z\""]) assert.ok(!text.includes(bad), "the document holds " + bad);
  // The state names quests by id with a short hash, under build|locale, and holds no key or path.
  const st = s.state();
  assert.equal(st.v, 1); assert.match(st.context, /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(st.sets), ["71037|enUS"]);
  assert.equal(Object.keys(st.sets["71037|enUS"].quests).length, 8);
  assert.ok(Object.values(st.sets["71037|enUS"].quests).every((h) => /^[0-9a-f]{12}$/.test(h)));
  assert.ok(!fs.readFileSync(s.stateFile, "utf8").includes("Private Person"));

  const second = await s.sender.send(s.game);
  assert.equal(second.sent, 0); assert.equal(second.unchanged, 8); assert.equal(r.posted.length, 1, "unchanged quests were sent again");
  assert.deepEqual(snapshot(s.game), before, "the sender changed something under the game folder");

  s.changeMoney(78150, 130);
  const changed = snapshot(s.game);
  const third = await s.sender.send(s.game);
  assert.equal(third.sent, 1); assert.equal(r.posted.length, 2);
  assert.deepEqual(r.posted[1].quests.map((q) => [q.id, q.money]), [[78150, 130]]);
  assert.equal(r.posted[1].total, 8, "total is the whole cache, not the quests sent");
  const fourth = await s.sender.send(s.game);
  assert.equal(fourth.sent, 0);
  assert.deepEqual(snapshot(s.game), changed, "the sender changed something under the game folder");
});

test("a rejected document (400 / 413 / 422) records nothing as sent, is not resent unchanged, and a changed quest tries again", async (t) => {
  let reject = true;
  const r = recorder(() => { if (reject) throw err(422, { detail: "unknown field" }); return { ok: true }; });
  const s = setup(t, r.post);
  const out = await s.sender.send(s.game);
  assert.equal(out.sent, 0); assert.deepEqual(out.rejected, [{ locale: "enUS", reason: "HTTP 422: unknown field" }]);
  assert.equal(Object.keys(s.state().sets["71037|enUS"].quests).length, 0, "a rejected upload recorded quests as sent");
  await s.sender.send(s.game);
  assert.equal(r.posted.length, 1, "the same rejected document was sent again");
  s.changeMoney(1003, 801);
  reject = false;
  const again = await s.sender.send(s.game);
  assert.equal(r.posted.length, 2); assert.equal(again.sent, 8, "after a change the whole unsent set goes again");
  for (const status of [400, 413]) {
    const r2 = recorder(() => { throw err(status); });
    const s2 = setup(t, r2.post);
    const o = await s2.sender.send(s2.game);
    assert.equal(o.rejected.length, 1); assert.equal(o.sent, 0);
  }
});

test("404 and 405 are quiet: one log line, nothing recorded, nothing thrown, the caller is told the site does not take it", async (t) => {
  for (const status of [404, 405]) {
    const r = recorder(() => { throw err(status, { retryable: false }); });
    const s = setup(t, r.post);
    const out = await s.sender.send(s.game);
    assert.equal(out.unsupported, true); assert.equal(out.sent, 0); assert.equal(out.failed, null);
    assert.equal(r.posted.length, 1, "retried after " + status);
    assert.equal(s.logs.length, 1); assert.match(s.logs[0], new RegExp(`does not take quest caches yet \\(HTTP ${status}\\)`));
    assert.ok(!fs.existsSync(s.stateFile) || Object.values(s.state().sets).every((set) => !Object.keys(set.quests).length));
  }
});

test("401 / 403 / 426 and account refusals are thrown like the auction sender's; 5xx, no connection and 429 after retries are quiet", async (t) => {
  for (const e of [err(401, { retryable: false, authentication: true }), err(403, { retryable: false, authentication: true }),
    err(426, { retryable: false, detail: "Update the Companion." }), err(403, { code: "bnet_link_required", retryable: false, resumable: true })]) {
    const s = setup(t, async () => { throw e; });
    await assert.rejects(s.sender.send(s.game), (x) => x === e);
    assert.ok(!fs.existsSync(s.stateFile) || !Object.keys(s.state().sets["71037|enUS"].quests).length);
  }
  for (const e of [err(503), Object.assign(new Error("Connection unavailable"), { retryable: true }), Object.assign(new Error("The service returned an invalid acknowledgement."), { retryable: false })]) {
    const s = setup(t, async () => { throw e; });
    const out = await s.sender.send(s.game);
    assert.equal(out.failed, e.message); assert.equal(out.sent, 0); assert.equal(out.unsupported, false);
    assert.ok(!fs.existsSync(s.stateFile) || !Object.keys(s.state().sets["71037|enUS"].quests).length);
  }
  let calls = 0;
  const s = setup(t, async () => { calls++; throw err(429, { retryAfter: 5 }); });
  const out = await s.sender.send(s.game);
  assert.equal(calls, 3); assert.ok(s.sleeps.includes(5000)); assert.match(out.failed, /429/);
  calls = 0;
  const ok = setup(t, async () => { calls++; if (calls === 1) throw err(429, { retryAfter: 2 }); return { ok: true }; });
  assert.equal((await ok.sender.send(ok.game)).sent, 8);
});

test("another site, account, build or locale, or a missing or unreadable state file sends everything again", async (t) => {
  const r = recorder();
  const s = setup(t, r.post);
  await s.sender.send(s.game);
  assert.equal(r.ids().length, 8);
  await s.make(questCacheContext({ origin: "https://other.example", username: "someone" })).send(s.game);
  assert.equal(r.ids().length, 16, "another site");
  await s.make(questCacheContext({ origin: "https://other.example", username: "someone else" })).send(s.game);
  assert.equal(r.ids().length, 24, "another account");
  await s.make(questCacheContext({ origin: "https://other.example/", username: "someone else" })).send(s.game);
  assert.equal(r.ids().length, 24, "the same origin written differently");
  fs.writeFileSync(s.stateFile, "{ not json");
  await s.sender.send(s.game);
  assert.equal(r.ids().length, 32, "unreadable state");
  fs.rmSync(s.stateFile);
  await s.sender.send(s.game);
  assert.equal(r.ids().length, 40, "missing state");
  // Another locale of the same build is its own set; a new build of a locale replaces that locale's old set.
  const de = path.join(s.game, "Cache", "WDB", "deDE", "questcache.wdb");
  fs.mkdirSync(path.dirname(de)); const b = fs.readFileSync(s.cacheFile); b.write("EDed", 8, "latin1"); fs.writeFileSync(de, b);
  const both = await s.sender.send(s.game);
  assert.equal(both.caches, 2); assert.equal(both.sent, 8); assert.equal(r.posted.at(-1).locale, "deDE");
  const st = s.state();
  st.sets["70938|enUS"] = st.sets["71037|enUS"]; delete st.sets["71037|enUS"];
  fs.writeFileSync(s.stateFile, JSON.stringify(st));
  const rebuilt = await s.sender.send(s.game);
  assert.equal(rebuilt.sent, 8, "hashes of another build were used");
  assert.deepEqual(Object.keys(s.state().sets).sort(), ["71037|deDE", "71037|enUS"]);
});

test("a refused, half-written or missing cache is skipped quietly and sends nothing", async (t) => {
  const r = recorder();
  const s = setup(t, r.post);
  const good = fs.readFileSync(s.cacheFile);
  const unknown = Buffer.from(good); unknown.writeUInt32LE(71100, 4);
  fs.writeFileSync(s.cacheFile, unknown);
  let out = await s.sender.send(s.game);
  assert.equal(out.caches, 0); assert.equal(out.skipped.length, 1); assert.match(out.skipped[0].reason, /71100 is not a supported build/);
  fs.writeFileSync(s.cacheFile, good.subarray(0, 3000));
  out = await s.sender.send(s.game);
  assert.match(out.skipped[0].reason, /truncated/);
  assert.equal(r.posted.length, 0);
  fs.rmSync(path.join(s.game, "Cache"), { recursive: true });
  out = await s.sender.send(s.game);
  assert.deepEqual(out, { caches: 0, sent: 0, unchanged: 0, skipped: [], rejected: [], unsupported: false, failed: null });
  assert.deepEqual(findQuestCaches(path.join(s.root, "nowhere")), []);
  assert.equal(fs.existsSync(s.stateFile), false);
});

test("a large cache goes as several documents, spaced, each with the same header", async (t) => {
  const r = recorder();
  const s = setup(t, r.post, { perDocument: 3 });
  const out = await s.sender.send(s.game);
  assert.equal(out.sent, 8);
  assert.deepEqual(r.posted.map((d) => d.quests.length), [3, 3, 2]);
  assert.ok(r.posted.every((d) => d.total === 8 && d.build === 71037 && d.locale === "enUS"));
  assert.equal(s.sleeps.length, 2); assert.ok(s.sleeps.every((ms) => ms > 9000 && ms <= 10500));
  // A failure in the middle keeps what was accepted before it.
  const r2 = recorder((_d, n) => { if (n === 2) throw err(503); return { ok: true }; });
  const s2 = setup(t, r2.post, { perDocument: 3 });
  const part = await s2.sender.send(s2.game);
  assert.equal(part.sent, 3); assert.equal(Object.keys(s2.state().sets["71037|enUS"].quests).length, 3);
  const rest = await s2.sender.send(s2.game);
  assert.equal(rest.sent, 5);
});

test("the CLI's --upload sends the quest cache of the saved file's game folder; --no-quest-cache and a 404 leave it out quietly", async (t) => {
  const http = require("http");
  const zlib = require("zlib");
  const { execFile } = require("child_process");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kutz-questcache-cli-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const game = path.join(root, "_forever_");
  const saved = path.join(game, "WTF", "Account", "ACCOUNT", "SavedVariables", "KutzInventory.lua");
  fs.mkdirSync(path.dirname(saved), { recursive: true });
  fs.writeFileSync(saved, "KutzInventoryDB = { chars = {} }");
  fs.mkdirSync(path.join(game, "Cache", "WDB", "enUS"), { recursive: true });
  fs.copyFileSync(FIXTURE, path.join(game, "Cache", "WDB", "enUS", "questcache.wdb"));
  let questStatus = 200; const seen = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    seen.push({ url: req.url, body: JSON.parse(zlib.gunzipSync(Buffer.concat(chunks)).toString("utf8")) });
    const status = req.url === "/api/wow/quest-cache" ? questStatus : 200;
    res.writeHead(status, { "Content-Type": "application/json" }); res.end(status === 200 ? '{"ok":true}' : '{"error":"Not found"}');
  });
  server.listen(0, "127.0.0.1"); await require("events").once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const env = { ...process.env, WOW_IMPORT_TOKEN: "kutz_cli_token", WOW_IMPORT_URL: `http://127.0.0.1:${server.address().port}/api/wow/import` };
  delete env.WOW_QUEST_CACHE_URL; delete env.WOW_AUCTIONS_URL;
  const cli = (args, out) => new Promise((resolve) => execFile(process.execPath, [path.join(__dirname, "inventory_export.js"), "--upload", ...args, saved, out], { env, encoding: "utf8" },
    (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr })));
  let run = await cli([], path.join(root, "a", "inventory.json"));
  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(seen.map((s) => s.url), ["/api/wow/import", "/api/wow/quest-cache"]);
  assert.equal(seen[1].body.quests.length, 8); assert.match(run.stdout, /Quest cache: 8 new or changed quest\(s\) sent, 0 unchanged/);
  run = await cli([], path.join(root, "a", "inventory.json"));
  assert.equal(seen.filter((s) => s.url === "/api/wow/quest-cache").length, 1, "the CLI resent unchanged quests");
  assert.ok(!fs.readFileSync(path.join(root, "a", "inventory.json.quest-cache-sent.json"), "utf8").includes("kutz_cli_token"));
  run = await cli(["--no-quest-cache"], path.join(root, "b", "inventory.json"));
  assert.equal(seen.filter((s) => s.url === "/api/wow/quest-cache").length, 1, "--no-quest-cache sent it");
  questStatus = 404;
  run = await cli([], path.join(root, "c", "inventory.json"));
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /does not take quest caches yet \(HTTP 404\)/);
});
