"use strict";
// Only this module knows the cr0m HTTP contract. Never expose response bodies to logs.
const zlib = require("zlib");
function endpoint(base, route) {
  const url = new URL(base);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) throw new Error("Use HTTPS for cr0m.");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Enter a site origin, such as https://wow.cr0m.com.");
  return new URL(route, url).href;
}
// cr0m refuses an upload from a key that is fine when the person has not linked Battle.net (or none of the uploaded
// characters are on the linked account). That is not a rejected key: fixing it on the site is enough, so the session
// keeps watching (resumable). Only the two exact codes and the server's sentence are used; nothing else of the body is kept.
const ACCOUNT_REFUSALS = {
  bnet_link_required: { fallback: "Link your Battle.net account to upload.", hint: " Open Settings on wow.cr0m.com, Battle.net." },
  no_account_characters: { fallback: "None of these characters are on your Battle.net account.", hint: "" },
};
async function accountRefusal(res, key) {
  let body;
  try { body = await res.json(); } catch { return null; }   // not JSON: the old key case
  const code = body && body.code;
  if (typeof code !== "string" || !Object.hasOwn(ACCOUNT_REFUSALS, code)) return null;
  const known = ACCOUNT_REFUSALS[code];
  let text = typeof body.error === "string" ? body.error.trim().slice(0, 200).trim() : "";
  if (!text || (key && text.includes(key))) text = known.fallback;
  return Object.assign(new Error(text + known.hint), {
    status: 403, code, authentication: false, retryable: false, resumable: true,
    retryAfter: null, detail: null,
  });
}
async function request(base, key, route, data, fetcher = fetch, signal) {
  if (!key || /[\r\n]/.test(key)) throw Object.assign(new Error("Enter a valid API key."), { retryable: false });
  let url;
  try { url = endpoint(base, route); }
  catch { throw Object.assign(new Error("Enter a valid HTTPS site origin."), { retryable: false }); }
  let res;
  try {
    res = await fetcher(url, {
      method: data === undefined ? "GET" : "POST", redirect: "error",
      headers: { Authorization: "Bearer " + key, Accept: "application/json", ...(data === undefined ? {} : { "Content-Type": "application/json", "Content-Encoding": "gzip" }) },
      // gzipped JSON, about 10x smaller; cr0m detects gzip by its first two bytes
      ...(data === undefined ? {} : { body: zlib.gzipSync(Buffer.from(JSON.stringify(data), "utf8")) }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    });
  } catch { throw Object.assign(new Error("Connection unavailable; the saved snapshot will be retried."), { retryable: true }); }
  if (!res.ok) {
    if (res.status === 403) {
      const refusal = await accountRefusal(res, key);
      if (refusal) throw refusal;
    }
    const auth = res.status === 401 || res.status === 403;
    // A receiver can echo the bearer key in an error. Redact before truncating or persisting it as auction state.
    let detail = null;
    if (!auth) { try { const e = (await res.json()).error; detail = typeof e === "string" ? e.split(key).join("[redacted]").slice(0, 200) : null; } catch { detail = null; } }
    throw Object.assign(new Error(auth ? "Key rejected or permission removed. Reconnect in Settings." : `Upload service returned HTTP ${res.status}${detail ? ": " + detail : ""}.`), {
      status: res.status, detail, retryAfter: Number(res.headers && res.headers.get ? res.headers.get("retry-after") : null) || null,
      retryable: res.status === 408 || res.status === 429 || res.status >= 500, authentication: auth,
    });
  }
  let result;
  try { result = await res.json(); } catch { throw Object.assign(new Error("The service returned an invalid acknowledgement."), { retryable: false }); }
  if (result.ok !== true || (route.endsWith("identity") && (typeof result.username !== "string" || !result.username.trim()))) {
    throw Object.assign(new Error("The service returned an invalid acknowledgement."), { retryable: false });
  }
  return result;
}
module.exports = {
  endpoint,
  verify: (base, key, fetcher, signal) => request(base, key, "/api/wow/identity", undefined, fetcher, signal),
  upload: (base, key, data, fetcher, signal) => request(base, key, "/api/wow/import", data, fetcher, signal),
  // one auction-scan document; 200 { ok, accepted, stale, house } is an acknowledgement even when accepted is 0
  uploadAuctions: (base, key, doc, fetcher, signal) => request(base, key, "/api/wow/auctions", doc, fetcher, signal),
};
