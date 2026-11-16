#!/usr/bin/env node
"use strict";
// A distribution is a fresh directory. Never copy WTF, exports, credentials, or node_modules.
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
function packageRelease(destination) {
  const output = path.resolve(destination);
  // Avoid accidentally packaging into a source directory or recursively copying our output.
  for (const dir of ["KutzInventory", "companion", "tools"]) {
    const source = path.join(root, dir);
    if (output === source || output.startsWith(source + path.sep)) throw new Error("Choose an output outside source directories.");
  }
  if (fs.existsSync(output)) throw new Error("Output already exists. Choose a fresh package directory.");
  fs.mkdirSync(output, { recursive:true });
  for (const addon of ["KutzInventory"]) {
    fs.cpSync(path.join(root,addon),path.join(output,"AddOns",addon),{recursive:true});
  }
  fs.mkdirSync(path.join(output,"companion")); fs.mkdirSync(path.join(output,"tools"));
  for (const name of ["Start.cmd","Companion.ps1","CredentialStore.cs","worker.js","session.js","transport.js"]) {
    fs.copyFileSync(path.join(root,"companion",name),path.join(output,"companion",name));
  }
  for (const name of ["inventory_export.js","convert.js","export_queue.js","upload_outbox.js","output_lock.js","auction_sender.js"]) {
    fs.copyFileSync(path.join(root,"tools",name),path.join(output,"tools",name));
  }
  fs.copyFileSync(path.join(root,"companion","README.md"),path.join(output,"README.md"));
  return output;
}
if (require.main === module) {
  try { console.log(packageRelease(process.argv[2] || path.join(root,"export","KutzInventory-package"))); }
  catch (e) { console.error(e.message); process.exitCode=1; }
}
module.exports = { packageRelease };
