/**
 * WHAT EVERY CREDENTIAL THIS PROJECT USES IS DOING RIGHT NOW, BEFORE ANYTHING RELIES ON ONE.
 *
 * Three times on this project a supposed permission problem turned out to be an expired token,
 * and each time the diagnosis went a long way down the wrong road first — reasoning about
 * scopes, about org membership, about API semantics, while the actual answer was in a
 * timestamp on disk. The third time the wrangler token had 248 seconds left at the moment a
 * multi-call investigation began, which would have produced a completely different and
 * completely wrong conclusion had it lapsed mid-run.
 *
 * Remembering to check is not a fix; the two times it was remembered were the two times it had
 * already caused an hour of confusion. So it is a script, it prints the state of everything at
 * once, and the operations that depend on a credential run it first.
 *
 *   node scripts/credentials.mjs          report, exit 0 unless something is already expired
 *   node scripts/credentials.mjs --strict exit 1 if anything expires within the margin
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

/* Long enough for a deploy, a verify-live pass, or an investigation of several calls. A token
   that lapses halfway through any of those produces a wrong answer, not a clean failure. */
const MARGIN_S = 600;

const rows = [];
const add = (name, state, detail) => rows.push({ name, state, detail });

/* ---- 1. the wrangler OAuth token: Cloudflare Pages, Workers, KV, D1 ------------------- */
{
  const p = join(homedir(), ".wrangler/config/default.toml");
  if (!existsSync(p)) add("cloudflare (wrangler)", "ABSENT", "no ~/.wrangler/config/default.toml — run: npx wrangler login");
  else {
    const src = readFileSync(p, "utf8");
    const exp = (src.match(/^expiration_time\s*=\s*"([^"]+)"/m) || [])[1];
    const scopes = (src.match(/scopes = \[([\s\S]*?)\]/) || [])[1] || "";
    const has = (s) => new RegExp(`"${s}"`).test(scopes);
    if (!exp) add("cloudflare (wrangler)", "UNKNOWN", "no expiration_time in the config");
    else {
      const left = Math.round((Date.parse(exp) - Date.now()) / 1000);
      const state = left <= 0 ? "EXPIRED" : left < MARGIN_S ? "EXPIRING" : "ok";
      add("cloudflare (wrangler)", state,
        `${left <= 0 ? `lapsed ${-left}s ago` : `${left}s left`} · pages:write ${has("pages:write") ? "yes" : "NO"} · workers:write ${has("workers:write") ? "yes" : "NO"} · refreshable ${has("offline_access") ? "yes" : "NO"}`);
    }
  }
}

/* ---- 2. the GitHub CLI token -------------------------------------------------------- */
{
  try {
    const out = execFileSync("gh", ["auth", "status"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const scopes = (out.match(/Token scopes:\s*(.+)/) || [])[1] || "unknown";
    const who = (out.match(/account (\S+)/) || [])[1] || "?";
    add("github (gh)", "ok", `${who} · ${scopes.trim()}`);
  } catch (e) {
    const msg = String(e.stderr || e.message || e).split("\n")[0];
    add("github (gh)", "ABSENT", msg.slice(0, 90));
  }
}

/* ---- 3. worker secrets: named only, never read -------------------------------------- */
{
  try {
    const out = execFileSync("npx", ["wrangler", "secret", "list", "--config", "wrangler.toml"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const names = [...out.matchAll(/"name":\s*"([^"]+)"/g)].map((m) => m[1]);
    add("worker secrets", names.length ? "ok" : "EMPTY", names.join(", ") || "none set — the weekly report degrades, the site does not");
  } catch {
    add("worker secrets", "UNKNOWN", "could not list (usually the Cloudflare token above)");
  }
}

const pad = Math.max(...rows.map((r) => r.name.length));
console.log("credential pre-flight");
for (const r of rows) {
  const mark = r.state === "ok" ? "ok  " : r.state === "EXPIRING" ? "WARN" : r.state === "UNKNOWN" ? "?   " : "FAIL";
  console.log(`  ${mark}  ${r.name.padEnd(pad)}  ${r.state.padEnd(8)} ${r.detail}`);
}

const dead = rows.filter((r) => r.state === "EXPIRED" || r.state === "ABSENT");
const soon = rows.filter((r) => r.state === "EXPIRING");
if (dead.length) {
  console.error(`\n  ${dead.length} credential(s) unusable — fix before drawing any conclusion from an API error.`);
  process.exit(1);
}
if (soon.length && process.argv.includes("--strict")) {
  console.error(`\n  ${soon.length} credential(s) expire within ${MARGIN_S}s — too little for a deploy or an investigation.`);
  process.exit(1);
}
if (soon.length) console.log(`\n  note: ${soon.length} credential(s) expire within ${MARGIN_S}s. A wrangler call refreshes them.`);
