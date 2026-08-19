#!/usr/bin/env node
/**
 * public/icon.svg -> public/favicon.ico, because /favicon.ico was a 14KB HTML 404 page.
 *
 * The head has always carried `<link rel="icon" href="/icon.svg">` and browsers honour it, so
 * nothing looked broken. But /favicon.ico is probed at the ROOT, without reading any HTML, by
 * the consumers that matter most for how this site is presented when it is cited: Google's
 * favicon fetcher, DuckDuckBot, Bing, and the source cards in AI answers. Measured over 24
 * hours on the live zone, 15 requests hit /favicon.ico and every one received the 404 page —
 * among them Googlebot-Image and DuckDuckBot. A citation with a generic globe beside it is a
 * weaker citation, and this is the cheapest possible fix for it.
 *
 * SVG IS NOT ENOUGH ON ITS OWN and a redirect is not either: the point of the .ico path is the
 * clients that will not parse SVG. So this writes a real ICO — a PNG wrapped in the six-byte
 * directory and sixteen-byte entry that the Vista-era format allows, which every current
 * browser and crawler reads.
 *
 * WHY THE RASTERISER IS CLOUDFLARE'S: the same reason as scripts/gen-og-png.mjs. No new npm
 * dependency is permitted, Node cannot rasterise SVG, and this project's existing OAuth grant
 * already carries `browser (write)`. Not wired into `npm run build` — it needs the network and
 * a live credential, and favicon.ico is committed as an artifact. Run it when icon.svg changes.
 *
 *   CF_ACCOUNT_ID=... node scripts/gen-favicon.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const SIZE = 48; /* Google asks for a multiple of 48; browsers downscale to 16 and 32 happily. */
const ACCOUNT = process.env.CF_ACCOUNT_ID;
if (!ACCOUNT) { console.error("CF_ACCOUNT_ID is required — the Cloudflare account these calls address."); process.exit(1); }
const cfg = join(homedir(), ".wrangler/config/default.toml");
if (!existsSync(cfg)) { console.error("no wrangler credential — run `npx wrangler login`"); process.exit(1); }
const raw = readFileSync(cfg, "utf8");
const token = /oauth_token\s*=\s*"([^"]+)"/.exec(raw)?.[1];
const expiry = /expiration_time\s*=\s*"([^"]+)"/.exec(raw)?.[1];
if (!token) { console.error("no oauth_token in the wrangler config"); process.exit(1); }
if (expiry && Date.parse(expiry) < Date.now()) {
  console.error(`wrangler token expired at ${expiry} — run \`npx wrangler whoami\` to refresh`);
  process.exit(1);
}

const svg = readFileSync("public/icon.svg", "utf8");
const body = JSON.stringify({
  html: `<!doctype html><html><body style="margin:0;padding:0">${svg.replace("<svg ", `<svg width="${SIZE}" height="${SIZE}" `)}</body></html>`,
  viewport: { width: SIZE, height: SIZE, deviceScaleFactor: 1 },
  screenshotOptions: { type: "png", omitBackground: true },
});

const png = execFileSync("curl", [
  "-s", "-X", "POST", `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/browser-rendering/screenshot`,
  "-H", `authorization: Bearer ${token}`, "-H", "content-type: application/json",
  "--data-binary", "@-", "--output", "-",
], { input: body, maxBuffer: 8 * 1024 * 1024 });

/* A JSON error body is also a 200 here, so the magic bytes are the only honest success test. */
const MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
if (!png.subarray(0, 8).equals(MAGIC)) {
  console.error("browser rendering did not return a PNG:\n" + png.toString("utf8").slice(0, 400));
  process.exit(1);
}
const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
if (w !== SIZE || h !== SIZE) { console.error(`expected ${SIZE}x${SIZE}, got ${w}x${h}`); process.exit(1); }

/* ICONDIR (6 bytes) + one ICONDIRENTRY (16 bytes) + the PNG itself. */
const dir = Buffer.alloc(6);
dir.writeUInt16LE(0, 0);  // reserved
dir.writeUInt16LE(1, 2);  // 1 = icon
dir.writeUInt16LE(1, 4);  // one image
const entry = Buffer.alloc(16);
entry.writeUInt8(SIZE, 0);          // width  (0 would mean 256)
entry.writeUInt8(SIZE, 1);          // height
entry.writeUInt8(0, 2);             // palette size, 0 = truecolour
entry.writeUInt8(0, 3);             // reserved
entry.writeUInt16LE(1, 4);          // colour planes
entry.writeUInt16LE(32, 6);         // bits per pixel
entry.writeUInt32LE(png.length, 8); // bytes in this image
entry.writeUInt32LE(22, 12);        // offset: 6 + 16
const ico = Buffer.concat([dir, entry, png]);

writeFileSync("public/favicon.ico", ico);
console.log(`public/favicon.ico written — ${w}x${h} PNG in an ICO container, ${ico.length.toLocaleString()} bytes`);
