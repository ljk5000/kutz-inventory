"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { once } = require("events");
const { spawn } = require("child_process");
const { verify, upload, uploadAuctions, endpoint } = require("./transport");
const { createSession } = require("./session");
const { acquireOutputLock } = require("../tools/output_lock");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let i=0;i<150;i++) { if (fn()) return; await delay(20); } throw new Error("Timed out waiting for companion behavior"); }
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kutz-companion-"));
  const game = path.join(root, "_forever_");
  const saved = path.join(game, "WTF", "Account", "account", "SavedVariables");
  fs.mkdirSync(saved, { recursive:true });
  fs.mkdirSync(path.join(game,"Interface"));
  const input = path.join(saved,"KutzInventory.lua"), output=path.join(root,"inventory.json");
  const write = name => fs.writeFileSync(input, `KutzInventoryDB = { chars = { ["A"] = { name = "${name}" } } }`);
  write("Original");
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return { root, game, saved, input, output, write };
}
test("HTTP contract verifies username, authorizes uploads, rejects redirects and invalid acknowledgements without leaking keys", async t => {
  const key="private-test-key"; let mode="ok", posted;
  const server=http.createServer(async (req,res)=>{
    assert.equal(req.headers.authorization, "Bearer "+key);
    if (mode==="redirect") { res.writeHead(302,{Location:"/elsewhere"}); res.end(); return; }
    if (mode==="reject") { res.writeHead(403); res.end(key); return; }
    if (mode==="busy") { res.writeHead(503); res.end(key); return; }
    if (mode==="echo-key") { res.writeHead(422); res.end(JSON.stringify({error: "Rejected " + key + " / " + key})); return; }
    if (mode==="invalid") { res.end('{"ok":true}'); return; }
    if (req.method==="POST") {
      const chunks=[]; for await (const piece of req) chunks.push(piece);
      const raw=Buffer.concat(chunks);
      assert.equal(req.headers["content-encoding"], "gzip");
      assert.equal(raw[0], 0x1f); assert.equal(raw[1], 0x8b);   // what cr0m checks to unpack
      posted=JSON.parse(require("zlib").gunzipSync(raw).toString("utf8")); res.end('{"ok":true,"id":1}');
    } else res.end('{"ok":true,"username":"Player"}');
  });
  server.listen(0,"127.0.0.1"); await once(server,"listening");
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await verify(base,key)).username,"Player");
  await upload(base,key,{characters:[]}); assert.deepEqual(posted,{characters:[]});
  mode="reject";
  await assert.rejects(verify(base,key), error=>error.authentication && error.retryable===false && !error.message.includes(key));
  mode="busy"; await assert.rejects(upload(base,key,{}), error=>error.retryable && !error.message.includes(key));
  mode="echo-key";
  await assert.rejects(uploadAuctions(base,key,{}), error=>error.status===422 &&
    !error.message.includes(key) && !error.detail.includes(key) && error.detail.includes("[redacted]"));
  mode="invalid"; await assert.rejects(verify(base,key),/invalid acknowledgement/);
  mode="redirect"; await assert.rejects(verify(base,key),/Connection unavailable/);
  assert.throws(()=>endpoint("http://example.com","/api/wow/import"),/HTTPS/);
  assert.throws(()=>endpoint("https://user:secret@example.com","/api/wow/import"),/origin/);
});
test("watching exports saved variables, coalesces changes during upload, pauses, and preserves private state", async t=>{
  const f=await fixture(t), events=[], uploads=[]; let release;
  const session=await createSession({ ...f, base:"https://cr0m.com", key:"not-on-disk", interval:20, report:e=>events.push(e),
    upload:async (_base,_key,data)=>{ uploads.push(data); if (uploads.length===1) await new Promise(resolve=>release=resolve); }
  });
  t.after(()=>session.stop());
  await until(()=>uploads.length===1);
  assert.ok(fs.existsSync(f.output+".pending.json"));
  f.write("ChangedDuringUpload"); await delay(80); release();
  await until(()=>uploads.length===2);
  assert.equal(uploads[1].characters[0].name,"ChangedDuringUpload");
  await session.stop(); f.write("AfterPause"); await delay(100);
  assert.equal(uploads.length,2); assert.equal(events.at(-1).state,"paused");
  assert.equal(fs.existsSync(f.output+".pending.json"),false);
  assert.equal(fs.readFileSync(f.output,"utf8").includes("not-on-disk"),false);
});
test("rejected credentials block repeated saves; restart replays unacknowledged snapshot before new data", async t=>{
  const f=await fixture(t), events=[]; let tries=0;
  const bad=await createSession({...f,base:"https://cr0m.com",key:"bad",interval:20,report:e=>events.push(e),upload:async()=>{
    tries++; throw Object.assign(new Error("Key rejected"),{retryable:false});
  }});
  t.after(()=>bad.stop());
  await until(()=>events.some(e=>e.state==="attention")); f.write("Newer"); await delay(500);
  assert.equal(tries,1); await bad.stop();
  const sent=[];
  const good=await createSession({...f,base:"https://cr0m.com",key:"good",interval:20,report:()=>{},upload:async(_b,_k,data)=>sent.push(data)});
  t.after(()=>good.stop()); await until(()=>sent.length===2); await good.stop();
  assert.equal(sent[0].characters[0].name,"Original"); assert.equal(sent[1].characters[0].name,"Newer");
});
test("single output lock excludes competing writers and releases on process death", async t=>{
  const f=await fixture(t);
  const release=await acquireOutputLock(f.output); t.after(release);
  await assert.rejects(acquireOutputLock(f.output),/Another exporter/); await release();
  const child=spawn(process.execPath,["-e",`require(${JSON.stringify(require.resolve("../tools/output_lock"))}).acquireOutputLock(process.argv[1]).then(()=>{console.log('locked');setInterval(()=>{},1000)})`,f.output]);
  t.after(()=>child.kill()); await once(child.stdout,"data");
  await assert.rejects(acquireOutputLock(f.output),/Another exporter/);
  child.kill(); await once(child,"exit"); const again=await acquireOutputLock(f.output); await again();
});
test("first-save discovery includes accounts created after Start", async t=>{
  const f=await fixture(t); fs.unlinkSync(f.input); const uploads=[];
  const session=await createSession({...f,base:"https://cr0m.com",key:"key",interval:20,report:()=>{},upload:async(_b,_k,data)=>uploads.push(data)});
  t.after(()=>session.stop()); await delay(500); assert.equal(uploads.length,0);
  f.write("FirstSave"); await until(()=>uploads.length===1); await session.stop();
  assert.equal(uploads[0].characters[0].name,"FirstSave");
});

// A saved file with one scanned auction house, as KutzInventory 1.3.0 writes it.
const auctionDB = (stamp) => `KutzInventoryDB = { chars = { ["A"] = { name = "A", realm = "Realm", faction = "Horde" } },
  prices = { vendor = {}, sell = {}, ahByHouse = true,
    ah = { ["Realm|horde"] = { [2589] = { p = { 30 }, q = { 2 }, n = 1, t = ${stamp} } } },
    scans = { ["Realm|horde"] = { startedAt = ${stamp - 5}, finishedAt = ${stamp + 5}, method = "search", complete = true,
                                  queued = 1, answered = 1, houseSource = "npc", addonVersion = "1.3.0", region = 1 } } } }`;

test("auction scans go to /api/wow/auctions once per scan; a retry does not re-upload the inventory", async t => {
  const f = await fixture(t); fs.writeFileSync(f.input, auctionDB(1700000000));
  const inventory = [], scans = []; let failFirst = true;
  const session = await createSession({ ...f, base: "https://cr0m.com", key: "key", interval: 20, report: () => {}, auctionGapMs: 0,
    upload: async (_b, _k, data) => inventory.push(data),
    uploadAuctions: async (_b, _k, doc) => {
      if (failFirst) { failFirst = false; throw Object.assign(new Error("HTTP 503"), { status: 503, retryable: true }); }
      scans.push(doc); return { ok: true, accepted: 1, stale: 0, house: "Realm|horde" };
    } });
  t.after(() => session.stop());
  await until(() => scans.length === 1);
  await delay(300);
  assert.equal(inventory.length, 1, "the inventory was uploaded again on the auction retry");
  assert.equal(scans[0].realm, "Realm"); assert.equal(scans[0].house, "horde"); assert.equal(scans[0].items["2589"].p[0], 30);
  assert.ok(!JSON.stringify(scans[0]).includes('"A"'), "the scan names a character");
  // The Companion uploads inventory 3.x (cr0m reads the rest from the Battle.net API).
  assert.equal(inventory[0].schemaVersion, "3.10.0"); assert.ok(!("crafting" in inventory[0].characters[0]));
  assert.ok(!("stats" in inventory[0].characters[0]) && !("talents" in inventory[0].characters[0]), "3.x still carries API fields");
  // the game saves again without a new scan: inventory again, the same scan is not resent
  fs.writeFileSync(f.input, auctionDB(1700000000) + "\n");
  await until(() => inventory.length === 2); await delay(300);
  assert.equal(scans.length, 1, "an acknowledged scan was sent again");
  // a newer scan of that house is sent
  fs.writeFileSync(f.input, auctionDB(1700000600));
  await until(() => scans.length === 2);
  await session.stop();
});

test("auctions over HTTP: gzip to /api/wow/auctions, Retry-After on 429, and 200 with accepted 0 is an acknowledgement", async t => {
  const key = "kutz_test"; let calls = 0, got;
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    calls++;
    if (calls === 1) { res.writeHead(429, { "Retry-After": "3", "Content-Type": "application/json" }); res.end('{"error":"slow down"}'); return; }
    got = { url: req.url, encoding: req.headers["content-encoding"], body: JSON.parse(require("zlib").gunzipSync(Buffer.concat(chunks)).toString("utf8")) };
    res.end('{"ok":true,"accepted":0,"stale":1,"house":"Realm|horde"}');
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const doc = { schemaVersion: "1.0.0", realm: "Realm", house: "horde", scannedAt: "2026-11-11T10:00:00.000Z", items: {} };
  const first = await uploadAuctions(base, key, doc).catch(e => e);
  assert.equal(first.status, 429); assert.equal(first.retryAfter, 3); assert.equal(first.retryable, true); assert.equal(first.detail, "slow down");
  assert.ok(!String(first.message).includes(key));
  const ack = await uploadAuctions(base, key, doc);
  assert.equal(ack.ok, true); assert.equal(ack.accepted, 0);
  assert.equal(got.url, "/api/wow/auctions"); assert.equal(got.encoding, "gzip"); assert.equal(got.body.house, "horde");
});

test("a price-only setup (the service character) never uploads characters; at least one switch is required", async t => {
  const f = await fixture(t); fs.writeFileSync(f.input, auctionDB(1700000000));
  const inventory = [], scans = [];
  const session = await createSession({ ...f, base: "https://cr0m.com", key: "key", interval: 20, report: () => {}, auctionGapMs: 0,
    sendInventory: false, upload: async (_b, _k, d) => inventory.push(d),
    uploadAuctions: async (_b, _k, d) => { scans.push(d); return { ok: true, accepted: 1, stale: 0 }; } });
  t.after(() => session.stop());
  await until(() => scans.length === 1); await delay(300); await session.stop();
  assert.equal(inventory.length, 0, "a price-only setup uploaded the inventory");
  await assert.rejects(createSession({ ...f, base: "https://cr0m.com", key: "key", report: () => {}, sendInventory: false, sendAuctions: false }), /at least one/);
});

// cr0m's refusals for a person who has not linked Battle.net (HTTP 403 with a code), and a rejected key (403 without one).
const LINK = { ok: false, error: "Link your Battle.net account to upload.", code: "bnet_link_required", link: "/private/settings#wow-battlenet" };
const NO_CHARS = { ok: false, error: "None of these characters are on your Battle.net account. Re-link after making a new one.", code: "no_account_characters", link: "/private/settings#wow-battlenet" };
const LINK_HINT = " Open Settings on wow.cr0m.com, Battle.net.";
const linkRefusal = () => Object.assign(new Error("Link your Battle.net account to upload." + LINK_HINT), { status: 403, code: "bnet_link_required", authentication: false, retryable: false, resumable: true });
async function serve(t, answer) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    let body = null; try { body = JSON.parse(require("zlib").gunzipSync(Buffer.concat(chunks)).toString("utf8")); } catch { body = null; }
    seen.push({ url: req.url, body });
    const [status, text] = answer(req.url, seen.length);
    res.writeHead(status, { "Content-Type": "application/json" }); res.end(typeof text === "string" ? text : JSON.stringify(text));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { seen, base: `http://127.0.0.1:${server.address().port}` };
}

test("a coded 403 is resumable and says what to do; any other 403 is still a rejected key", async t => {
  const key = "private-test-key"; let reply;
  const { base } = await serve(t, () => [403, reply]);
  reply = LINK;
  for (const call of [() => upload(base, key, {}), () => uploadAuctions(base, key, {})]) {
    const e = await call().catch(x => x);
    assert.equal(e.resumable, true); assert.equal(e.authentication, false); assert.equal(e.retryable, false);
    assert.equal(e.status, 403); assert.equal(e.code, "bnet_link_required");
    assert.equal(e.message, "Link your Battle.net account to upload." + LINK_HINT);
    assert.ok(!e.message.includes(key) && !JSON.stringify(e).includes("wow-battlenet"), "the link or key leaked");
  }
  reply = NO_CHARS;
  const none = await upload(base, key, {}).catch(x => x);
  assert.equal(none.resumable, true); assert.equal(none.authentication, false); assert.equal(none.retryable, false); assert.equal(none.code, "no_account_characters");
  assert.equal(none.message, NO_CHARS.error);
  reply = { ok: false, error: "x".repeat(500), code: "bnet_link_required" };
  assert.equal((await upload(base, key, {}).catch(x => x)).message, "x".repeat(200) + LINK_HINT);
  reply = { ok: false, error: `echo ${key}`, code: "no_account_characters" };
  assert.ok(!(await upload(base, key, {}).catch(x => x)).message.includes(key));
  for (const body of [{ ok: false, error: "invalid key or permission" }, { ok: false, error: "x", code: "something_else" },
                      { ok: false, error: "x", code: "BNET_LINK_REQUIRED" }, { ok: false, error: "x", code: ["bnet_link_required"] }, "not json " + key, ""]) {
    reply = body;
    const e = await upload(base, key, {}).catch(x => x);
    assert.equal(e.authentication, true, JSON.stringify(body)); assert.equal(e.retryable, false); assert.equal(e.resumable, undefined);
    assert.equal(e.message, "Key rejected or permission removed. Reconnect in Settings."); assert.ok(!e.message.includes(key));
  }
  // a 401 never gets the exception, whatever the code
  const unauthorized = await serve(t, () => [401, LINK]);
  const e401 = await upload(unauthorized.base, key, {}).catch(x => x);
  assert.equal(e401.authentication, true); assert.equal(e401.resumable, undefined);
});

test("after a link refusal the session keeps watching, retries on a timer and on a file change, and clears the attention state", async t => {
  const f = await fixture(t), events = []; let mode = "link";
  const { seen, base } = await serve(t, () => mode === "ok" ? [200, { ok: true, id: 1 }] : [403, mode === "link" ? LINK : NO_CHARS]);
  const session = await createSession({ ...f, base, key: "kutz_private_key", interval: 20, resumeAfterMs: 150, auctionGapMs: 0, sendAuctions: false, report: e => events.push(e) });
  t.after(() => session.stop());
  await until(() => events.some(e => e.state === "attention"));
  assert.equal(events.find(e => e.state === "attention").message, "Link your Battle.net account to upload." + LINK_HINT);
  // the timer alone (the file never changes) sends the refused snapshot again, and the sentence follows the server
  mode = "nochars";
  await until(() => seen.length >= 2 && events.at(-1).state === "attention" && events.at(-1).message === NO_CHARS.error);
  assert.equal(seen[1].body.characters[0].name, "Original");
  assert.equal(events.some(e => e.state === "paused"), false);
  // a changed game file is sent as usual
  f.write("Newer");
  await until(() => seen.at(-1).body.characters[0].name === "Newer");
  // the person links Battle.net: the next attempt is accepted and the attention state ends
  mode = "ok";
  await until(() => events.at(-1).state === "watching" && events.at(-1).acknowledgedAt);
  const sentAfterOk = seen.length; await delay(500);
  assert.equal(seen.length, sentAfterOk, "kept retrying after a success");
  assert.equal(seen.at(-1).body.characters[0].name, "Newer");
  await session.stop();
});

test("a file change retries at once while the slow timer is long", async t => {
  const f = await fixture(t), events = [], sent = []; let linked = false;
  const session = await createSession({ ...f, base: "https://cr0m.com", key: "k", interval: 20, resumeAfterMs: 600000, sendAuctions: false, report: e => events.push(e),
    upload: async (_b, _k, d) => { sent.push(d); if (!linked) throw linkRefusal(); } });
  t.after(() => session.stop());
  await until(() => events.some(e => e.state === "attention")); assert.equal(sent.length, 1);
  linked = true; f.write("Changed");
  await until(() => sent.length === 2 && events.at(-1).acknowledgedAt);
  assert.equal(sent[1].characters[0].name, "Changed");
  await session.stop();
});

test("the refused snapshot is the one retried, not a fresh export of the same file", async t => {
  const f = await fixture(t), events = [], sent = []; let linked = false;
  const session = await createSession({ ...f, base: "https://cr0m.com", key: "k", interval: 5000, resumeAfterMs: 120, sendAuctions: false, report: e => events.push(e),
    upload: async (_b, _k, data) => { sent.push(data); if (!linked) throw linkRefusal(); } });
  t.after(() => session.stop());
  await until(() => sent.length >= 2); linked = true;
  await until(() => events.at(-1).acknowledgedAt);
  assert.deepEqual(sent.at(-1), sent[0]);   // identical document, including its export time
  assert.equal(fs.existsSync(f.output + ".pending.json"), false);
  await session.stop();
});

test("pause during the wait leaves no retry timer; a rejected key still blocks", async t => {
  const f = await fixture(t), events = [];
  const realSet = global.setTimeout, realClear = global.clearTimeout, live = new Set();
  global.setTimeout = (fn, ms, ...a) => { const h = realSet(fn, ms, ...a); if (ms === 777000) live.add(h); return h; };
  global.clearTimeout = h => { live.delete(h); return realClear(h); };
  t.after(() => { global.setTimeout = realSet; global.clearTimeout = realClear; });
  let calls = 0;
  const session = await createSession({ ...f, base: "https://cr0m.com", key: "k", interval: 20, resumeAfterMs: 777000, sendAuctions: false, report: e => events.push(e),
    upload: async () => { calls++; throw linkRefusal(); } });
  await until(() => events.some(e => e.state === "attention"));
  assert.equal(live.size, 1, "the slow timer is armed during the wait");
  await session.stop();
  assert.equal(live.size, 0, "Pause left a timer running"); assert.equal(events.at(-1).state, "paused");
  const settled = calls; await delay(200); assert.equal(calls, settled);
  // a rejected key is unchanged: attention, no timer, no further attempts
  const bad = await createSession({ ...f, base: "https://cr0m.com", key: "bad", interval: 20, resumeAfterMs: 50, sendAuctions: false, report: e => events.push(e),
    upload: async () => { calls++; throw Object.assign(new Error("Key rejected"), { status: 403, retryable: false, authentication: true }); } });
  t.after(() => bad.stop());
  const before = calls; await until(() => calls === before + 1); await delay(400); f.write("Changed"); await delay(300);
  assert.equal(calls, before + 1, "a rejected key kept trying"); await bad.stop();
});

test("a link refusal on auction prices keeps the inventory delivered and sends the scans after the link is made", async t => {
  const f = await fixture(t); fs.writeFileSync(f.input, auctionDB(1700000000));
  const events = [], inventory = [], scans = []; let linked = false;
  const session = await createSession({ ...f, base: "https://cr0m.com", key: "k", interval: 20, resumeAfterMs: 100, auctionGapMs: 0, report: e => events.push(e),
    upload: async (_b, _k, d) => inventory.push(d),
    uploadAuctions: async (_b, _k, doc) => {
      if (!linked) throw linkRefusal();
      scans.push(doc); return { ok: true, accepted: 1, stale: 0 };
    } });
  t.after(() => session.stop());
  await until(() => events.at(-1).state === "attention"); await delay(300);
  assert.equal(inventory.length, 1, "the inventory was uploaded again on each auction retry"); assert.equal(scans.length, 0);
  linked = true;
  await until(() => scans.length === 1 && events.at(-1).state === "watching" && events.at(-1).acknowledgedAt);
  assert.equal(inventory.length, 1);
  await session.stop();
});

// WoW moved from cr0m.com to wow.cr0m.com: the default site, and the move of a site saved by an earlier Companion.
const source = name => fs.readFileSync(path.join(__dirname, name), "utf8");
test("the default site and the examples are wow.cr0m.com, and both settings windows move a saved site on load", () => {
  const cs = source("Companion.cs"), ps = source("Companion.ps1");
  assert.match(cs, /WowSite = "https:\/\/wow\.cr0m\.com";/); assert.match(cs, /site\.Text = WowSite;/);
  assert.match(cs, /site\.Text = MovedOrigin\(saved\);/);
  assert.match(ps, /\$base\.Text='https:\/\/wow\.cr0m\.com'/); assert.match(ps, /\$base\.Text=Move-SiteOrigin \$savedBase/);
  for (const text of [cs, ps, source("transport.js")]) assert.doesNotMatch(text, /https:\/\/cr0m\.com\./, "an example still names the old site");
  assert.throws(() => endpoint("https://wow.cr0m.com/x", "/api/wow/import"), /such as https:\/\/wow\.cr0m\.com\./);
});
// The same rule in Companion.cs (MovedOrigin) is checked by KutzUICompanion.exe --self-test, which tools/windows/smoke.js runs.
test("Move-SiteOrigin moves only a saved https://cr0m.com", { skip: process.platform !== "win32" && "needs Windows PowerShell" }, () => {
  const fn = source("Companion.ps1").split(/\r?\n/).find(line => line.startsWith("function Move-SiteOrigin"));
  const moved = "https://wow.cr0m.com";
  const cases = [["https://cr0m.com", moved], ["HTTPS://CR0M.COM/", moved], [" https://Cr0m.com/ ", moved], [moved, moved],
    ["https://example.com", "https://example.com"], ["http://cr0m.com", "http://cr0m.com"], ["https://www.cr0m.com", "https://www.cr0m.com"],
    ["https://cr0m.com/x", "https://cr0m.com/x"], ["https://cr0m.com.example.org", "https://cr0m.com.example.org"]];
  const script = fn + "\n" + cases.map(([saved]) => `Move-SiteOrigin '${saved}'`).join("\n");
  const run = require("child_process").spawnSync("powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { encoding: "utf8", windowsHide: true });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.stdout.trim().split(/\r?\n/), cases.map(([, expected]) => expected));
});
