"use strict";
const fs = require("fs");
const path = require("path");

// Contains inventory only, never credentials. Keep the exact snapshot until acknowledged.
function createOutbox(file, upload) {
  async function flush() {
    if (!fs.existsSync(file)) return undefined;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const result = await upload(data);
    fs.unlinkSync(file);
    return result;
  }
  return {
    flush,
    async send(data) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = file + ".tmp";
      fs.writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 });
      fs.renameSync(temporary, file);
      return flush();
    },
  };
}
module.exports = { createOutbox };
