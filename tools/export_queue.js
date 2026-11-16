"use strict";

// Coalesce changes without losing a change that arrives during an upload.
// Retry delays are capped; the saved JSON remains on disk across restarts.
function createExportQueue(run, report, timers = { setTimeout, clearTimeout }) {
  let timer = null, running = false, dirty = false, stopped = false, failures = 0;
  function schedule(delay) {
    if (timer != null) timers.clearTimeout(timer);
    timer = timers.setTimeout(drain, delay);
  }
  async function drain() {
    timer = null;
    if (running || stopped) return;
    running = true;
    dirty = false;
    let retry = false;
    try { await run(); failures = 0; }
    catch (error) {
      report(error);
      retry = error.retryable !== false;
      failures++;
    } finally {
      running = false;
      if (!stopped && (dirty || retry)) schedule(dirty ? 400 : Math.min(60000, 1000 * 2 ** Math.min(failures - 1, 6)));
    }
  }
  return {
    kick() { dirty = true; if (!running && !stopped) schedule(400); },
    stop() { stopped = true; if (timer != null) timers.clearTimeout(timer); },
  };
}
module.exports = { createExportQueue };
