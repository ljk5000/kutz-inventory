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
    const restarted = createOutbox(file, async data => { received.push(data); });
    await restarted.flush();
    assert.deepEqual(received, [snapshot]); assert.equal(fs.existsSync(file), false);
    await restarted.flush(); assert.equal(received.length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
