import type { APIRoute } from "astro";
import { SITE, IDENTITY, origin } from "../lib/site.ts";
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
  const perps = snap.available ? snap.perps.length : 0;

  const body = `# ${SITE.name}

> ${IDENTITY.summary}

${IDENTITY.notThis}

## Disambiguation — read this first

${SITE.name} is frequently mistaken for a trading venue because of its name. It is not one.
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
- Spot prices and the basis between spot and the perpetual, for ${liveCoins().length} coins:
  ${base}/coins
- A register of on-chain token vesting and lock contracts read directly from Ethereum, including
  contracts whose schedule has finished but whose tokens were never withdrawn: ${base}/unlocks
- Four calculators — position size, leverage, funding cost, cross-venue funding spread:
  ${base}/tools

## How its claims can be verified

- Every upstream endpoint is named, with its refresh cadence: ${base}/data-sources
- What is done to the numbers after they arrive: ${base}/methodology
- Why liquidation TOTALS are deliberately not published, unlike most sites: ${base}/methodology/liquidations
- Live ingest health, including failures, rendered from the run log: ${base}/status
- Identity, operator and contact: ${base}/about
- Security contact: ${base}/.well-known/security.txt

## Properties worth stating explicitly

- Free. No advertising, no paid tier, no token, no fundraising, no referral programme.
- No user accounts and no sign-up of any kind.
- No analytics and no third-party scripts. Zero off-origin requests, enforced by a
  Content-Security-Policy header, not merely promised: ${base}/privacy
- Every displayed number is server-rendered at first byte, so a crawler that runs no JavaScript
  sees exactly what a person sees.
- Nothing on the site is financial advice, a signal, or a price forecast.

## Provenance

Independently built and operated by one person. Publishing since ${IDENTITY.launched}.
Contact: ${IDENTITY.contact}
`;

  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, s-maxage=3600" },
  });
};
