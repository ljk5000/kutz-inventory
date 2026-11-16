"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createAuctionSender } = require("./auction_sender");

const doc = (house, scannedAt) => ({ realm: "Realm", house, scannedAt, items: { 1: { p: [1], q: [1], n: 1, t: scannedAt } } });
const err = (status, extra = {}) => Object.assign(new Error("HTTP " + status), { status, retryable: status === 429 || status >= 500 }, extra);
function setup(post, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kutz-auctions-"));
  const sleeps = [];
  const sender = createAuctionSender(path.join(dir, "sent.json"), post, { minGapMs: 10500, sleep: async (ms) => { sleeps.push(ms); }, ...opts });
  return { sender, sleeps, state: () => JSON.parse(fs.readFileSync(path.join(dir, "sent.json"), "utf8")), dir };
}

test("sends each house once, again only for a newer scan; 200 with accepted 0 is acknowledged", async () => {
  const posted = [];
  const { sender, state } = setup(async (d) => { posted.push(d.house + "@" + d.scannedAt); return { ok: true, accepted: 0, stale: 1 }; });
  await sender.send([doc("horde", "2026-11-11T10:00:00.000Z"), doc("alliance", "2026-11-11T10:00:00.000Z")]);
  await sender.send([doc("horde", "2026-11-11T10:00:00.000Z"), doc("alliance", "2026-11-11T10:00:00.000Z")]);
  await sender.send([doc("horde", "2026-11-11T11:00:00.000Z")]);
  assert.deepEqual(posted, ["alliance@2026-11-11T10:00:00.000Z", "horde@2026-11-11T10:00:00.000Z", "horde@2026-11-11T11:00:00.000Z"]);
  assert.equal(state()["Realm|horde"].scannedAt, "2026-11-11T11:00:00.000Z");
});

test("a second request waits for cr0m's 10 s limit", async () => {
  const { sender, sleeps } = setup(async () => ({ ok: true, accepted: 1, stale: 0 }));
  await sender.send([doc("alliance", "2026-11-11T10:00:00.000Z"), doc("horde", "2026-11-11T10:00:00.000Z")]);
  assert.equal(sleeps.length, 1);
  assert.ok(sleeps[0] > 9000 && sleeps[0] <= 10500, "waited " + sleeps[0]);
});

test("429 honours Retry-After and tries again", async () => {
  let calls = 0;
  const { sender, sleeps, state } = setup(async () => { calls++; if (calls === 1) throw err(429, { retryAfter: 7 }); return { ok: true, accepted: 1, stale: 0 }; });
  await sender.send([doc("horde", "2026-11-11T10:00:00.000Z")]);
  assert.equal(calls, 2);
  assert.ok(sleeps.includes(7000), "slept " + sleeps);
  assert.ok(state()["Realm|horde"]);
});

test("400 / 413 / 422 are recorded as rejected and do not block the other houses", async () => {
  const { sender, state } = setup(async (d) => { if (d.house === "alliance") throw err(422, { detail: "unknown schemaVersion" }); return { ok: true, accepted: 1, stale: 0 }; });
  const out = await sender.send([doc("alliance", "2026-11-11T10:00:00.000Z"), doc("horde", "2026-11-11T10:00:00.000Z")]);
  assert.deepEqual(out.sent, ["Realm|horde"]);
  assert.equal(out.rejected[0].house, "Realm|alliance");
  assert.match(state()["Realm|alliance"].rejected, /422: unknown schemaVersion/);
  const again = await sender.send([doc("alliance", "2026-11-11T10:00:00.000Z")]);
  assert.deepEqual(again.skipped, ["Realm|alliance"], "the same rejected scan is not resent");
});

test("a rejected key (403) or a server error stops the run and keeps nothing as sent", async () => {
  const { sender, dir } = setup(async () => { throw err(403, { retryable: false, authentication: true }); });
  await assert.rejects(sender.send([doc("horde", "2026-11-11T10:00:00.000Z")]), (e) => e.status === 403);
  const state = fs.existsSync(path.join(dir, "sent.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "sent.json"), "utf8")) : {};
  assert.equal(state["Realm|horde"], undefined);
  const busy = setup(async () => { throw err(503); });
  await assert.rejects(busy.sender.send([doc("horde", "2026-11-11T10:00:00.000Z")]), (e) => e.retryable === true);
});

test("a resumable link refusal stops the run, keeps every unsent scan unsent, and the same scans go out on the next run", async () => {
  let linked = false; const posted = [];
  const { sender, dir, state } = setup(async (d) => {
    if (!linked) throw err(403, { code: "bnet_link_required", authentication: false, retryable: false, resumable: true });
    posted.push(d.house); return { ok: true, accepted: 1, stale: 0 };
  });
  const scans = [doc("alliance", "2026-11-11T10:00:00.000Z"), doc("horde", "2026-11-11T10:00:00.000Z")];
  await assert.rejects(sender.send(scans), (e) => e.resumable === true && e.status === 403 && e.authentication === false);
  const after = fs.existsSync(path.join(dir, "sent.json")) ? state() : {};
  assert.equal(after["Realm|alliance"], undefined, "a refused scan was marked sent or rejected");
  assert.equal(after["Realm|horde"], undefined);
  assert.deepEqual(posted, []);
  linked = true;
  const out = await sender.send(scans);
  assert.deepEqual(out.sent, ["Realm|alliance", "Realm|horde"]); assert.deepEqual(out.rejected, []);
  assert.deepEqual(posted, ["alliance", "horde"]);
});
