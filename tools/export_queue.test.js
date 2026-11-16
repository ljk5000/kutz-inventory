"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createExportQueue } = require("./export_queue");
function clock() {
  let pending;
  return {
    setTimeout(fn, delay) { pending = { fn, delay }; return 1; },
    clearTimeout() { pending = null; },
    get delay() { return pending?.delay; },
    fire() { const p = pending; pending = null; return p.fn(); },
  };
}
test("a change during an upload triggers a second run", async () => {
  const timer = clock(); let finish, runs = 0;
  const queue = createExportQueue(async () => { runs++; if (runs === 1) await new Promise(resolve => { finish = resolve; }); }, assert.fail, timer);
  queue.kick(); const running = timer.fire();
  queue.kick(); queue.kick(); finish(); await running;
  assert.equal(timer.delay, 400); await timer.fire(); assert.equal(runs, 2);
  assert.equal(timer.delay, undefined);
});
test("temporary failures back off and success clears retries", async () => {
  const timer = clock(); let runs = 0;
  const queue = createExportQueue(async () => { if (++runs < 3) throw new Error("offline"); }, () => {}, timer);
  queue.kick(); await timer.fire(); assert.equal(timer.delay, 1000);
  await timer.fire(); assert.equal(timer.delay, 2000);
  await timer.fire(); assert.equal(timer.delay, undefined);
});
test("permanent failure waits for another change", async () => {
  const timer = clock();
  const queue = createExportQueue(async () => { throw Object.assign(new Error("forbidden"), { retryable: false }); }, () => {}, timer);
  queue.kick(); await timer.fire(); assert.equal(timer.delay, undefined);
  queue.kick(); assert.equal(timer.delay, 400); queue.stop(); assert.equal(timer.delay, undefined);
});
