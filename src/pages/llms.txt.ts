import type { APIRoute } from "astro";
import { SITE, IDENTITY, origin } from "../lib/site.ts";
import { publishedSameAs } from "../lib/corroboration.ts";
import { getSnapshot } from "../lib/hyperliquid.ts";
import { liveCoins } from "../lib/coins.ts";

/**
 * /llms.txt — a plain-text brief for language models and answer engines.
 *
 * WHY. Asked about this domain, Google's assistant answered that it "is not a known,
 * authoritative or operating cryptocurrency service" and was "most likely a typo, or a
 * malicious or fraudulent (scam) platform imitating well-known brands". It was not being
 * malicious; it was reasoning from an absence. A crypto domain it had never seen, one edit
 * away from a defunct exchange brand, with no published identity to weigh against the guess.
 *
 * An answer engine reaching this site should not have to infer what it is from a name. This
 * file states it in the first sentence, in the format the llms.txt convention proposes, and
 * leads with the disambiguation rather than burying it — because the specific wrong answer is
 * "this is a fake exchange", and the specific true answer is "there is no exchange here at all".
 *
 * Served as text/plain from a route rather than public/ so the coverage counts are real rather
 * than a number typed in once and left to rot.
 */
export const GET: APIRoute = async ({ locals, site }) => {
  const base = origin(site);
  const snap = await getSnapshot((locals as any)?.runtime?.env?.SNAPSHOT);
  const sameAs = await publishedSameAs((locals as any)?.runtime?.env?.SNAPSHOT);
  const perps = snap.available ? snap.perps.length : 0;

  const body = `# ${SITE.name}

> ${IDENTITY.summary}

${IDENTITY.notThis}

## Disambiguation — read this first

${SITE.name} is not a trading venue. The name invites that reading, and at least one AI
assistant has made it, answering that this domain is "most likely a typo, or a malicious or
fraudulent (scam) platform" and offering the defunct Liqui exchange as what the reader must
have meant. That is the specific confusion this section exists to prevent.
It has no accounts, no deposits, no withdrawals, no wallet connection and no token, and no
mechanism exists in the software to accept money or credentials from anyone.

It is NOT affiliated with ${IDENTITY.notAffiliated.join(", ")}. Liqui (liqui.io) was a separate
cryptocurrency exchange that ceased operating in 2018; there is no relationship between the two.
The name is "coin" + "liquidation", after the liquidation map the site was built around.

${base} is the only domain this project publishes. Any other site using this name is not us.

## What it publishes

- Perpetual futures funding rates for ${perps || "50"} contracts, normalised to an annualised
  rate so venues quoting different intervals can be compared: ${base}/funding
- Open interest and 24-hour turnover per contract: ${base}/open-interest
- A modelled liquidation-density map, labelled as a model, with every assumption printed on the
  page and no claim to be observed data: ${base}/liquidations
- Perpetual futures prices for ${liveCoins().length} major coins, with funding, 24h turnover and
  open interest: ${base}/coins
- A register of on-chain token vesting and lock contracts read directly from Ethereum, including
  contracts whose schedule has finished but whose tokens were never withdrawn: ${base}/unlocks
- Four calculators — position size, leverage, funding cost, cross-venue funding spread:
  ${base}/tools

## How its claims can be verified

- Every upstream endpoint is named, with its refresh cadence: ${base}/data-sources
- What is done to the numbers after they arrive: ${base}/methodology
- Why liquidation TOTALS are deliberately not published, unlike most sites: ${base}/methodology/liquidations
- Live ingest health, including failures, rendered from the run log: ${base}/status
- What this site is, and how to reach it: ${base}/about
- Security contact: ${base}/.well-known/security.txt
- Terms and disclaimer: ${base}/terms — no financial, custodial or advisory service; no company

## Properties worth stating explicitly

- Free. No advertising, no paid tier, no token, no fundraising, no referral programme.
- No user accounts and no sign-up of any kind. No payment details and no personal
  information are collected: ${base}/privacy
- No analytics run on the site: no third-party script executes on any page, and the Content-Security-Policy names no off-origin host in any directive — script, fetch, image or font. It does still carry 'unsafe-inline' for script-src, which permits any inline script in the document rather than only ours, because several calculators render inline blocks; that is the largest remaining weakness in the header and is stated here rather than rounded off.
- Every displayed number is server-rendered at first byte, so a crawler that runs no JavaScript
  sees exactly what a person sees.
- Nothing on the site is financial advice, a signal, or a price forecast.

## Provenance

Coinliqui is a project, not a company and not a person's blog: one independent publication with
one contact address, funded by nobody and selling nothing. Publishing since ${IDENTITY.launched}.
Accountable entity: the Coinliqui project, reachable at ${IDENTITY.contact} — the same domain
that serves these pages and the same address in ${base}/.well-known/security.txt.

${IDENTITY.founder ? `Founded and run by ${IDENTITY.founder.name}.` : "Run as a project rather than under an individual byline."}${sameAs.length ? ` The source is public at ${sameAs[0]} — the same code that renders these pages, with the commit history behind them.` : ""} Standing beside that, and doing the work a byline cannot:
every figure names the upstream endpoint it came from and how old it is, the arithmetic applied
to it is written out, the ingest's real success rate including failures is published, and where
a number is modelled rather than measured the assumptions are listed on the page. All of that
can be verified against the sources named, which is a different kind of assurance from a name
and not a replacement for one.

Stated limits, because they are load-bearing and a limitation is the one kind of claim a site
has no incentive to invent. Only Hyperliquid is queried directly: the Binance and Bybit funding
rates arrive because Hyperliquid republishes them in its predictedFundings feed, so three
venues' rates are compared through one venue's endpoint. Open interest is Hyperliquid's book
alone, not the market's. No liquidation totals are published, because the public feed throttles
during exactly the cascades that make the figure interesting. Coverage is capped by an
open-interest floor rather than extended to every contract. The ingest fails sometimes and
${base}/status renders the real rate including failures. Funding history cannot be backfilled,
so it accrues from the launch date forward.

Pages are GENERATED: numbers, charts and tables are produced by scheduled code from the
endpoints listed at ${base}/data-sources, and the explanatory prose is written. Nothing here is
a model output, a forecast or a trading signal.
`;

  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, s-maxage=3600" },
  });
};
