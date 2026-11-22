"use strict";
// The Companion's version, in one place: session.js binds remembered acknowledgements to it, and transport.js names it in
// every request (X-Kutz-Uploader), so cr0m can refuse versions it no longer reads. Kept equal to tools/windows/package.json
// by a test.
module.exports = { COMPANION_VERSION: "0.12.7" };
