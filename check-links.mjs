// Fetches every channel's url and submitUrl and writes `status` + `checked` back into
// channels.json. No dependencies. Run: node check-links.mjs [--only-unchecked]
//
// status:
//   ok       - 2xx after redirects
//   blocked  - the site answered but refuses scripts (403/429/503, bot walls, Reddit).
//              Alive, but needs a human look; build.mjs keeps these.
//   dead     - 404/410, DNS failure, or no answer. build.mjs refuses to publish these.
// A channel's status is the worse of its two URLs.
//
// ponytail: status codes only, not page content. A domain that now parks a for-sale page
// returns 200 and reads "ok" - the manual pass in the guide's plan catches those.

import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("./channels.json", import.meta.url);
const UA = "Mozilla/5.0 (X11; Linux x86_64) link-checker"; // generic, identifies no one
const TIMEOUT_MS = 15000;
const CONCURRENCY = 12;
const RANK = { ok: 0, blocked: 1, dead: 2 };

async function probe(url) {
  for (const method of ["HEAD", "GET"]) {
    try {
      const res = await fetch(url, {
        method,
        redirect: "follow",
        headers: { "user-agent": UA, accept: "text/html,*/*" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      res.body?.cancel();
      if (res.ok) return { status: "ok", code: res.status, final: res.url };
      if (method === "HEAD" && res.status !== 404 && res.status !== 410) continue; // many sites reject HEAD
      if ([401, 403, 429, 503, 999].includes(res.status)) return { status: "blocked", code: res.status };
      if (res.status >= 500) return { status: "blocked", code: res.status };
      return { status: "dead", code: res.status };
    } catch (e) {
      if (method === "HEAD") continue;
      return { status: "dead", code: e.cause?.code ?? e.name };
    }
  }
}

const channels = JSON.parse(readFileSync(FILE, "utf8"));
const onlyUnchecked = process.argv.includes("--only-unchecked");
const today = new Date().toISOString().slice(0, 10);
const todo = channels.filter((c) => !onlyUnchecked || !c.checked);

let i = 0;
async function worker() {
  while (i < todo.length) {
    const c = todo[i++];
    const urls = [...new Set([c.url, c.submitUrl].filter(Boolean))];
    const results = await Promise.all(urls.map(probe));
    const worst = results.reduce((a, b) => (RANK[b.status] > RANK[a.status] ? b : a));
    c.status = worst.status;
    c.checked = today;
    if (worst.status !== "ok") console.log(`${worst.status.padEnd(7)} ${String(worst.code).padEnd(14)} ${c.name}  ${urls.join(" ")}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

writeFileSync(FILE, JSON.stringify(channels, null, 1) + "\n");
const counts = channels.reduce((m, c) => ((m[c.status] = (m[c.status] ?? 0) + 1), m), {});
console.log(`\nchecked ${todo.length}:`, counts);
