"use strict";
const net = require("net");
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
// An exclusive loopback listener is an OS-owned lock, automatically released on crash.
// A rare port collision fails closed; it never permits simultaneous exporters.
async function acquireOutputLock(output) {
  const full = path.resolve(output);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  let canonical = path.join(fs.realpathSync(path.dirname(full)), path.basename(full));
  if (process.platform === "win32") canonical = canonical.toLowerCase();
  const port = 10000 + createHash("sha256").update(canonical).digest().readUInt16BE(0) % 20000;
  const server = net.createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once("error", () => reject(new Error("Another exporter is using this output, or its local lock port is busy. Pause other exporters first.")));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, resolve);
  });
  server.unref();
  let released = false;
  return () => { if (!released) { released = true; return new Promise(resolve => server.close(resolve)); } };
}
module.exports = { acquireOutputLock };
