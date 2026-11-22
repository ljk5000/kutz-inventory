"use strict";
const fs = require("fs");
const path = require("path");
const { exportAll } = require("../tools/inventory_export");
const { createOutbox } = require("../tools/upload_outbox");
const { ackContext, parseAck, mergeMarks, trimExport, readAckState, writeAckState } = require("../tools/upload_ack");
const { createAuctionSender } = require("../tools/auction_sender");
const { createExportQueue } = require("../tools/export_queue");
const { acquireOutputLock } = require("../tools/output_lock");
const transport = require("./transport");
function savedFiles(game) {
  const root = path.join(game, "WTF", "Account");
  if (!fs.existsSync(root) || !fs.existsSync(path.join(game, "Interface"))) throw new Error("Select the game client folder containing WTF and Interface (for example _forever_).");
  return fs.readdirSync(root).map(account => path.join(root, account, "SavedVariables", "KutzInventory.lua")).filter(f => fs.existsSync(f));
}
// Linking Battle.net on cr0m does not touch the game file, so after a link refusal the session tries again on its own.
const RESUME_AFTER_MS = 5 * 60 * 1000;
const COMPANION_VERSION = "0.12.7";
async function createSession({ game, output, base, key, username = "", companionVersion = COMPANION_VERSION, report, upload = transport.upload, uploadAuctions = transport.uploadAuctions, interval = 1000, resumeAfterMs = RESUME_AFTER_MS, auctionGapMs = 10500, sendInventory = true, sendAuctions = true }) {
  // What this PC shares: its characters (/api/wow/import), auction house prices (/api/wow/auctions), or both.
  // A price-gathering "service" character turns off the first; a player who doesn't share prices, the second.
  if (!sendInventory && !sendAuctions) throw new Error("Choose at least one thing to upload: your characters or auction house prices.");
  savedFiles(game); // Validate before acquiring a resource.
  const release = await acquireOutputLock(output);
  const abort = new AbortController();
  const ackFile = output + ".ack.json";
  let stopped = false, blocked = false, signature = "", active = Promise.resolve(), timer, resumeTimer = null, refused = false, refusedSig = "";
  const notify = event => { if (!stopped) report(event); };
  const outbox = createOutbox(output + ".pending.json", async data => {
    notify({ state: "uploading" });
    const result = await upload(base, key, data, undefined, abort.signal);
    refused = false;
    notify({ state: "watching", acknowledgedAt: new Date().toISOString() });
    return result;
  });
  // A wait that Pause / Exit cancels, so a 10 s gap or a Retry-After never holds the session open.
  const sleep = ms => new Promise((resolve, reject) => {
    if (abort.signal.aborted) { reject(Object.assign(new Error("Paused."), { retryable: false })); return; }
    const t = setTimeout(resolve, ms);
    abort.signal.addEventListener("abort", () => { clearTimeout(t); reject(Object.assign(new Error("Paused."), { retryable: false })); }, { once: true });
  });
  // Auction prices: one document per auction house, each scan sent once (state beside the export, no key in it).
  const auctions = createAuctionSender(output + ".auctions-sent.json", doc => uploadAuctions(base, key, doc, undefined, abort.signal), {
    minGapMs: auctionGapMs, sleep,
    log: message => { if (/rejected/.test(message)) notify({ state: "watching", message }); },
  });
  let replay = true, deliveredFor = "";
  const fileSignature = files => files.map(f => { const s = fs.statSync(f); return `${f}:${s.mtimeMs}:${s.size}`; }).join("|");
  async function run() {
    if (blocked || stopped) return;
    if (replay) { if (sendInventory) await outbox.flush(); replay = false; }
    const files = savedFiles(game);
    if (!files.length) { notify({ state: "watching", message: "Waiting for your first game save. Enable Inventory, then /reload." }); return; }
    const sig = fileSignature(files);
    const all = exportAll(files, output);
    // A retry after a failed auction upload does not upload the same inventory again.
    if (sendInventory && sig !== deliveredFor) {
      try {
        // Unchanged since cr0m refused it: send that same pending snapshot again, not a fresh export.
        if (sig === refusedSig && fs.existsSync(output + ".pending.json")) {
          await outbox.flush();
        } else {
          const ctx = ackContext({
            origin: base, username, files,
            schemaVersion: all.inventory && all.inventory.schemaVersion,
            companionVersion,
          });
          const marks = readAckState(ackFile, ctx);
          const payload = trimExport(all.inventory, marks);
          const trimmed = payload !== all.inventory;
          const answer = await outbox.send(payload);
          const ack = parseAck(answer && typeof answer === "object" ? answer.ack : null);
          if (ack) {
            const next = mergeMarks(marks, ack, { trimmed });
            if (next) { try { writeAckState(ackFile, ctx, next); } catch {} }
          }
        }
      } catch (error) { if (error && error.resumable === true) refusedSig = sig; throw error; }
      deliveredFor = sig; refusedSig = "";
    }
    if (sendAuctions) await auctions.send(all.auctions);
  }
  const clearResume = () => { if (resumeTimer) clearTimeout(resumeTimer); resumeTimer = null; };
  const queue = createExportQueue(() => (active = run().then(() => {
    clearResume();
    // The refused part may have been the auction prices only; say that the attention state is over.
    if (refused) { refused = false; notify({ state: "watching", acknowledgedAt: new Date().toISOString() }); }
  })), error => {
    if (error.resumable === true) {
      // Not a key problem: keep watching, and try again on a slow timer because the fix happens on the site.
      refused = true; clearResume();
      if (!stopped) resumeTimer = setTimeout(() => { resumeTimer = null; queue.kick(); }, resumeAfterMs);
      notify({ state: "attention", message: error.message });
      return;
    }
    if (error.retryable === false) blocked = true;
    notify({ state: blocked ? "attention" : "retrying", message: error.message });
  });
  function poll() {
    if (stopped || blocked) return;
    try {
      const next = savedFiles(game).map(f => { const stat = fs.statSync(f); return `${f}:${stat.mtimeMs}:${stat.size}`; }).join("|");
      if (next !== signature) { signature = next; queue.kick(); }
    } catch { notify({ state: "attention", message: "Game folder unavailable. Restore it or pause and select it again." }); }
  }
  notify({ state: "watching" });
  timer = setInterval(poll, interval);
  poll(); queue.kick();
  return { async stop() {
    if (stopped) return;
    stopped = true; queue.stop(); clearInterval(timer); clearResume(); abort.abort();
    await active.catch(() => {}); await release(); key = "";
    report({ state: "paused" });
  } };
}
module.exports = { savedFiles, createSession, COMPANION_VERSION };
