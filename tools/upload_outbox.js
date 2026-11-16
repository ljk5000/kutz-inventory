"use strict";
const fs = require("fs");
const path = require("path");

// Contains inventory only, never credentials. Keep the exact snapshot until acknowledged.
function createOutbox(file, upload) {
  async function flush() {
    if (!fs.existsSync(file)) return;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    await upload(data);
    fs.unlinkSync(file);
  }
  return {
    flush,
    async send(data) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = file + ".tmp";
      fs.writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 });
      fs.renameSync(temporary, file);
      await flush();
    },
  };
}
module.exports = { createOutbox };
