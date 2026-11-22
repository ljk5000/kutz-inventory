"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createOutbox } = require("./upload_outbox");
test("an unacknowledged snapshot survives restart and clears only after success", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inventory-outbox-"));
  const file = path.join(dir, "pending.json");
  try {
    const snapshot = { exportedAt: "original", characters: [{ name: "Hero" }] };
    const first = createOutbox(file, async () => { throw new Error("offline"); });
    await assert.rejects(first.send(snapshot), /offline/);
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), snapshot);
    const received = [];
    const restarted = createOutbox(file, async data => { received.push(data); return { ok: true, ack: { epoch: 1 } }; });
    const flushed = await restarted.flush();
    assert.deepEqual(flushed, { ok: true, ack: { epoch: 1 } });
    assert.deepEqual(received, [snapshot]); assert.equal(fs.existsSync(file), false);
    assert.equal(await restarted.flush(), undefined); assert.equal(received.length, 1);
    const sent = await restarted.send(snapshot);
    assert.deepEqual(sent, { ok: true, ack: { epoch: 1 } });
    assert.equal(fs.existsSync(file), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
