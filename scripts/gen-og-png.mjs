#!/usr/bin/env node
/**
 * public/og.svg -> public/og.png, because no social platform renders SVG.
 *
 * og:image and twitter:image pointed at an SVG on all 78 URLs, under
 * twitter:card="summary_large_image". Facebook, X, LinkedIn, Slack, Discord and iMessage all
 * reject SVG, so the large card the head was built to provide never appeared anywhere: every
 * link ever shared rendered bare. Nothing was broken and nothing logged an error — the tag was
 * present, the URL returned 200, and the content-type was a perfectly valid image/svg+xml.
 *
 * WHY THE RASTERISER IS CLOUDFLARE'S. No new npm dependency is permitted here, and Node cannot
 * rasterise SVG on its own — sharp, resvg and puppeteer are all out. This project's existing
 * Cloudflare OAuth grant already carries `browser (write)`, so the Browser Rendering API turns
 * the SVG into a 1200x630 PNG using a credential that is already present for other reasons.
 *
 * NOT WIRED INTO `npm run build`. It needs the network and a live credential, and a build that
 * fails because a token expired is a build that gets bypassed. og.png is committed as an
 * artifact; run this when og.svg changes. scripts/verify-live.mjs asserts the card is a raster
 * image that actually resolves, which is the part that must never silently regress.
 *
 *   node scripts/gen-og-png.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const ACCOUNT = "7118e7c838c68b1c370b7837743a150e";
const cfg = join(homedir(), ".wrangler/config/default.toml");
if (!existsSync(cfg)) { console.error("no wrangler credential — run `npx wrangler login`"); process.exit(1); }
const token = /oauth_token\s*=\s*"([^"]+)"/.exec(readFileSync(cfg, "utf8"))?.[1];
const expiry = /expiration_time\s*=\s*"([^"]+)"/.exec(readFileSync(cfg, "utf8"))?.[1];
if (!token) { console.error("no oauth_token in the wrangler config"); process.exit(1); }
/* Expiry is checked BEFORE the request, because this project has already lost hours reading an
   "Authentication error" as a missing scope when the token had simply run out. */
if (expiry && Date.parse(expiry) < Date.now()) {
  console.error(`wrangler token expired at ${expiry} — run \`npx wrangler whoami\` to refresh`);
  process.exit(1);
}

const svg = readFileSync("public/og.svg", "utf8");
const body = JSON.stringify({
  html: `<!doctype html><html><body style="margin:0;padding:0;background:#16181b">${svg}</body></html>`,
  viewport: { width: 1200, height: 630, deviceScaleFactor: 1 },
  screenshotOptions: { type: "png", omitBackground: false },
});

const out = execFileSync("curl", [
  "-s", "-X", "POST", `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/browser-rendering/screenshot`,
  "-H", `authorization: Bearer ${token}`, "-H", "content-type: application/json",
  "--data-binary", "@-", "--output", "-",
], { input: body, maxBuffer: 32 * 1024 * 1024 });

/* A JSON error body is also a 200 here, so the magic bytes are the only honest success test. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
if (!out.subarray(0, 8).equals(PNG)) {
  console.error("browser rendering did not return a PNG:\n" + out.toString("utf8").slice(0, 400));
  process.exit(1);
}
/* Dimensions come out of the IHDR chunk rather than being assumed from the request. */
const w = out.readUInt32BE(16), h = out.readUInt32BE(20);
if (w !== 1200 || h !== 630) { console.error(`expected 1200x630, got ${w}x${h}`); process.exit(1); }

writeFileSync("public/og.png", out);
console.log(`public/og.png written — ${w}x${h}, ${out.length.toLocaleString()} bytes`);
