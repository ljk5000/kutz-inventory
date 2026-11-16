"use strict";
// Sends auction-scan documents (one per auction house) to cr0m's POST /api/wow/auctions, each scan once.
//
// State file (no credentials): { "<realm>|<house>": { "scannedAt": "<ISO>", "rejected": "<reason>"? } }.
// A house is sent again only when its scan's scannedAt is newer than the one acknowledged.
//   - 200 is acknowledged, even with accepted: 0 (the server dedupes on region, realm, house, item, t).
//   - 400 / 413 / 422 mean this document will never be accepted: it is recorded as rejected and skipped,
//     so one bad scan cannot block the others. A newer scan of that house is tried again.
//   - 401 / 403 (the key) and anything else marked retryable: false stop the run (the caller pauses).
//   - A `resumable` error (cr0m: Battle.net not linked, or none of the characters on the linked account) also
//     stops the run and keeps every unsent scan unsent: it is neither a rejected key nor a rejected scan, the
//     person fixes it on the site and the next run sends the same scans.
//   - 429 waits Retry-After (at most a minute) and tries again, up to 3 times; then the error is retryable.
// cr0m allows one request per 10 s per key, so consecutive sends are spaced by minGapMs.
const fs = require("fs");
const path = require("path");

const houseOf = (doc) => doc.realm + "|" + doc.house;
const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createAuctionSender(stateFile, post, { minGapMs = 10500, sleep = realSleep, log = () => {} } = {}) {
  let lastSentAt = 0;
  function read() {
    try { return JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch { return {}; }
  }
  function write(state) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    const tmp = stateFile + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, stateFile);
  }
  async function paced(doc) {
    for (let attempt = 1; ; attempt++) {
      const wait = lastSentAt + minGapMs - Date.now();
      if (lastSentAt && wait > 0) await sleep(wait);
      lastSentAt = Date.now();
      try { return await post(doc); }
      catch (error) {
        if (error && error.status === 429 && attempt < 3) {
          await sleep(Math.min(60, Math.max(1, Number(error.retryAfter) || 10)) * 1000);
          continue;
        }
        throw error;
      }
    }
  }
  return {
    // -> { sent: [house...], skipped: [house...], rejected: [{ house, reason }] }
    async send(docs) {
      const state = read();
      const out = { sent: [], skipped: [], rejected: [] };
      for (const doc of [...(docs || [])].sort((a, b) => houseOf(a).localeCompare(houseOf(b)))) {
        const house = houseOf(doc);
        const done = state[house];
        if (done && done.scannedAt && Date.parse(done.scannedAt) >= Date.parse(doc.scannedAt)) { out.skipped.push(house); continue; }
        try {
          const result = await paced(doc);
          state[house] = { scannedAt: doc.scannedAt };
          out.sent.push(house);
          log(`Auction prices for ${house}: ${result && result.accepted != null ? result.accepted : "?"} stored, ${result && result.stale != null ? result.stale : "?"} already known.`);
        } catch (error) {
          if (error && [400, 413, 422].includes(error.status)) {
            state[house] = { scannedAt: doc.scannedAt, rejected: `HTTP ${error.status}${error.detail ? ": " + error.detail : ""}` };
            out.rejected.push({ house, reason: state[house].rejected });
            log(`Auction prices for ${house} were rejected (${state[house].rejected}); a newer scan will be tried.`);
          } else {
            write(state);
            throw error;
          }
        }
        write(state);
      }
      return out;
    },
  };
}
module.exports = { createAuctionSender, houseOf };
