# coinliqui.com — phase 0

Perpetual funding, normalised. Built to the project's SEO constitution: every displayed
number is in the server-rendered HTML at first byte, every navigation link is a real
`<a href>`, no page ships without real data behind it.

Deployment runbook: **[DEPLOY.md](DEPLOY.md)** — dashboard only.

**Brand lives in one constant.** `SITE.name` in `src/lib/site.ts` feeds the rail wordmark,
the JSON-LD and every `<title>` — pages pass a bare title and `Base.astro` appends the
suffix, so a rename is one line rather than twenty-four. `STORE_NS` does the same for the
one key this site writes to a visitor's browser, which is why `/privacy` can print the
exact key instead of a copy that drifts.

## Routes

| Route | Template | Notes |
|---|---|---|
| `/` | homepage | Dated factual H1, change cards, flip feed, top-20 table |
| `/funding` | hub | 25 contracts × 3 venues, annualised. One link per row |
| `/funding/{symbol}` | entity | 25 pages. Candles, volume and the funding band on one time axis. 404s below the coverage floor rather than rendering thin |
| `/open-interest` | hub | OI, volume, turnover multiple |
| `/liquidations` | model | Modelled liquidation density, every assumption printed and adjustable, plus the derived corridor chart |
| `/liquidations/sweep` | case | The 5–6 Feb 2026 event, frozen with its provenance — the model tested against real candles |
| `/liquidations/survival` | derived | What the rules did to a position opened on each day at each leverage. Nothing modelled |
| `/unlocks` | calendar | Supply events with per-row provenance |
| `/tools` | hub | Lists only shipped tools |
| `/tools/liquidation-price` | **410 Gone** | Withdrawn as a commodity. Serves 410, not a redirect: the URL was already in a submitted sitemap, and 410 removes it instead of retrying it for weeks. The tier maths stays in `src/lib/margin.ts` |
| `/tools/funding-cost`, `/tools/funding-arbitrage`, `/tools/position-size`, `/tools/leverage` | tools | |
| `/watchlist` | utility | All contracts server-rendered; pinning is `localStorage`. `noindex, follow` in its own head — crawlable so the directive is seen |
| `/methodology`, `/methodology/liquidations` | reference | Why quoted rates are not comparable; why no liquidation totals are published |
| `/data-sources` | reference | Every endpoint, cadence, and what is deliberately absent |
| `/privacy` | reference | No accounts, no identity, no tracking — the whole of it |
| `/status` | operational | Snapshot age, per-venue coverage, canary history. `Disallow`ed |
| `/robots.txt`, `/sitemap-index.xml`, `/sitemaps/*.xml` | — | One sitemap per template. 42 URLs across 7 |

## Data

Keyless Hyperliquid calls, verified 2026-08-14:

- `POST /info {"type":"metaAndAssetCtxs"}` — 232 contracts: funding, openInterest, markPx,
  oraclePx, prevDayPx, dayNtlVlm, premium, maxLeverage, marginTableId
- `POST /info {"type":"predictedFundings"}` — 232 × 3 venues (Hyperliquid, Binance, Bybit)
- `POST /info {"type":"candleSnapshot"}` — 1d and 1h series. Pre-launch backfill carries
  zero volume and is excluded everywhere
- `POST /info {"type":"fundingHistory"}` — Hyperliquid's own hourly rate, paged backwards
  and accumulated in KV so depth grows with each cron pass
- `POST /info {"type":"marginTable","id":N}` — margin tiers, fetched at build time

Coverage floor: $5M notional open interest to be published, $3.5M to keep the page
(`OI_NOTIONAL_FLOOR` / `OI_RETIRE_FLOOR`). `SYMBOL_CAP` = 50 published. The number that
clears the floor moves daily and is rendered live on / and /data-sources — this file
deliberately names the constants rather than a count, because the count goes stale here
and nothing notices.

**OKX is not a source.** Its API Agreement §9.4 (2026-07-28) forbids publishing or
displaying its market data, explicitly including public endpoints and non-commercial use.
It may only be used internally to compute derived values, never displayed or attributed.

## Architecture

```
Cron Worker (5 min)                    Pages Function (per request)
metaAndAssetCtxs  \
predictedFundings  \
candleSnapshot      ---> KV --------->  HTML with every number at first byte
fundingHistory     /     D1 (history)
```

Pages read KV, never the upstream API. Verified in the compiled output: the dev
read-through is a parameter that compiles to `false`, so with a KV binding present an
upstream outage can make the timestamp older and nothing else. The dev server does fetch
upstream directly, which is why a rate-limit there produces a 503 and in production would
not.

The worker stages its bulk refreshes — at most one of hourly / daily / funding per
invocation — because a free Worker allows 50 subrequests per invocation and each sweep is
25 fetches. Steady state is 33.

## Charts

`src/lib/chart.ts` is the single scale every chart is drawn to: a 4px unit that all
padding, gutters and panel heights are multiples of, the ink palette, round tick values,
calendar-boundary time ticks, and the crosshair furniture.

Two rules the chart code exists to enforce:

1. **Nothing is eyeballed.** A number in a chart file that is not derived from `chart.ts`
   is a defect.
2. **Every generated SVG styles itself inline.** Astro scopes `<style>` selectors to a
   `data-astro-cid-*` attribute that markup injected with `set:html` never carries, so a
   class on a generated element silently resolves to nothing and the shape falls back to
   black. That shipped three times before the rule was written down.

Red and green mean the direction of a funding payment and nothing else, which is why
candles are monochrome and the density ramp is built to avoid both hues.

## Setup

```bash
npm install
npm run dev                 # http://localhost:4321
npm run gen:margin          # refresh committed margin tiers
npm run build:worker        # rebuild worker-dist/ingest.bundle.js after editing worker/
node scripts/fetch-sweep.mjs  # re-freeze the showcase window
```

`worker-dist/ingest.bundle.js` is committed on purpose: the dashboard-only deploy copies it
from GitHub's web UI, so it must be visible there. **It is a build artefact — after any
change to `worker/ingest.ts` it must be rebuilt and re-pasted into the Worker editor.**

## Acceptance tests

The build's real contract.

```bash
# numbers present for a non-JS AI crawler
curl -s -A "GPTBot/1.1" $URL/funding/btc | grep -c "Open interest"

# nav labels are text nodes, not aria-label
curl -s $URL/funding | grep -q 'nav-item__label'

# collapsed and expanded markup have identical href sets
diff <(curl -s $URL/funding | grep -o 'href="[^"]*"' | sort) \
     <(curl -s -H "Cookie: rail=0" $URL/funding | grep -o 'href="[^"]*"' | sort)

# SearchAction absent — Google removed the sitelinks searchbox 2024-11-21
curl -s $URL/ | grep -c SearchAction   # must be 0

# every sitemap URL resolves and is on the canonical origin
```

## Deliberately not built

**Accounts, and any notification channel.** No sign-up, no identity, no email, no wallet
connection, no bot. The watchlist is `localStorage`, the calculators compute in-page, and
`/privacy` states the whole of it.

The `funding_snapshot` cron and its D1 writes stay regardless: they exist for the on-site
flip feed, and that history cannot be backfilled, which is why ingest runs from day one.

Liquidation **events** are out of scope by decision, not oversight: no venue publishes a
complete feed, and the two routes to one were costed and rejected. See
`/methodology/liquidations`.

## Weekly instrument

`.github/workflows/indexation.yml` runs `scripts/indexation-report.mjs` every Monday at
07:00 UTC and commits the output to `reports/`. Three independent sections, each degrading
to a stated reason rather than failing the run:

| Section | Needs | Answers |
|---|---|---|
| A. Coverage | nothing | what exists per template, and whether a crawler can still fetch all of it |
| B. Search Console | `GSC_SA_KEY` | indexed share per template, position, impressions, top queries |
| C. Crawler fetches | `CF_ANALYTICS_TOKEN`, `CF_ZONE_ID` | which named crawlers actually fetched, from Cloudflare's edge |

The sitemaps ARE the template split — one file per template by construction — so the
report's grouping cannot drift from the site's own.

Section C reads aggregate request metrics Cloudflare already keeps at the edge, which is the
only place a named crawler's fetch is visible at all — Googlebot runs no JavaScript, so it
never appears in Google Analytics. The two sources answer different questions and neither
replaces the other: GA4 measures people, section C measures crawlers.

## Not built yet

OG image generation, at build time in GitHub Actions into R2 — not on demand in a Worker,
whose 10ms CPU limit image rendering exceeds by orders of magnitude.
