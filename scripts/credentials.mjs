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
/* `left` IS CARRIED ON THE ROW, and the remedy below is why. It used to be a local in the
   wrangler block, so any message printed later could only say "expiring" and not for how
   long — and the whole remedy for this credential is a WAIT with a length. A message that
   says "wait" without saying how long is the same dead end as the one it replaced. */
const add = (name, state, detail, left) => rows.push({ name, state, detail, left });

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
        `${left <= 0 ? `lapsed ${-left}s ago` : `${left}s left`} · pages:write ${has("pages:write") ? "yes" : "NO"} · workers:write ${has("workers:write") ? "yes" : "NO"} · refreshable ${has("offline_access") ? "yes" : "NO"}`,
        left);
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
/* =========================================================================================
   THE REMEDY THIS FILE PRINTED DID NOT WORK, AND IT COST THREE DEPLOYS TO NOTICE.

   The note below used to read "A wrangler call refreshes them." It does not, and the
   distinction is the whole difference between a message you can act on and one that sends
   you in a circle. Measured on 27 August 2026, three times in one session:

       token EXPIRING, 503s left   `npx wrangler whoami` -> still 503s, no refresh
       token EXPIRING, 340s left   `npx wrangler whoami` -> still 340s, no refresh
       token EXPIRED,  23s ago     `npx wrangler whoami` -> 3581s left, refreshed

   Wrangler refreshes on LAPSE, not on proximity. So the window this file refuses to deploy
   in — the last ten minutes of a token's life — is also the one window in which no wrangler
   command will get you out of it. Reading the old note, the obvious move is to run wrangler
   and retry, which fails, and fails again, and looks like the credential is broken.

   The instruction now says what actually works and how long it takes. It is a wait, and a
   message that admits a wait is worth more than one that suggests a command that does not.
   ========================================================================================= */
const remedy = (r) => {
  if (!r.name.includes("wrangler")) return "renew it before retrying";
  /* NO NUMBER IF THERE IS NO NUMBER. A row with no parsed expiry would otherwise print
     "wait 0s", which reads as "go now" and is the one thing that does not work here. */
  if (!Number.isFinite(r.left)) return "wrangler refreshes on LAPSE, not on proximity — wait for it to expire, then any wrangler call (`npx wrangler whoami`) renews it for an hour";
  const s = Math.max(0, r.left);
  return `wrangler refreshes on LAPSE, not on proximity — wait ${s}s (${Math.ceil(s / 60)} min) for it to expire, then any wrangler call (\`npx wrangler whoami\`) renews it for an hour`;
};
if (dead.length) {
  console.error(`\n  ${dead.length} credential(s) unusable — fix before drawing any conclusion from an API error.`);
  for (const r of dead) if (r.name.includes("wrangler")) console.error(`  ${r.name}: it has lapsed, so \`npx wrangler whoami\` will renew it now.`);
  process.exit(1);
}
if (soon.length && process.argv.includes("--strict")) {
  console.error(`\n  ${soon.length} credential(s) expire within ${MARGIN_S}s — too little for a deploy or an investigation.`);
  for (const r of soon) console.error(`  ${r.name}: ${remedy(r)}`);
  process.exit(1);
}
if (soon.length) for (const r of soon) console.log(`\n  note: ${r.name} expires within ${MARGIN_S}s. ${remedy(r)}`);
