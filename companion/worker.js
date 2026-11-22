"use strict";
// Native UI sends credentials over stdin, never the command line or a settings file.
const readline = require("readline");
const path = require("path");
const { verify } = require("./transport");
const { createSession } = require("./session");
const report = event => process.stdout.write(JSON.stringify(event) + "\n");
let session, chain = Promise.resolve();
async function command(cmd) {
  const emit = event => report({ ...event, requestId: cmd.requestId });
  if (cmd.action === "pause") { if (session) await session.stop(); session = null; emit({ state: "paused" }); return; }
  if (cmd.action !== "connect" && cmd.action !== "start") throw new Error("Unknown companion command.");
  if (session) { await session.stop(); session = null; }
  emit({ state: "connecting" });
  const account = await verify(cmd.base, cmd.key);
  emit({ state: "connected", username: account.username, legacy: !!account.legacy, starting: cmd.action === "start" });
  if (cmd.action === "start") session = await createSession({
    game: cmd.game, output: path.join(cmd.dataDirectory, "inventory.json"), base: cmd.base, key: cmd.key, username: account.username, report: emit,
    sendInventory: cmd.sendInventory !== false, sendAuctions: cmd.sendAuctions !== false,
  });
}
const input = readline.createInterface({ input: process.stdin });
input.on("line", line => {
  chain = chain.then(async () => {
    let cmd;
    try { cmd = JSON.parse(line); } catch { report({ state: "attention", message: "Invalid companion command." }); return; }
    try { await command(cmd); }
    catch (error) { report({ state: "attention", message: error.message, running: !!session, requestId: cmd.requestId }); }
  });
});
input.on("close", () => { chain.finally(async () => { if (session) await session.stop(); process.exit(0); }); });
