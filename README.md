# Basis — phase 0

Perpetual funding, normalised. Built to the project's SEO constitution: every displayed
number is in the server-rendered HTML at first byte, every navigation link is a real
`<a href>`, no page ships without real data behind it.

**The brand name is a placeholder.** "Basis" is a working name — clear it against trademark
databases and domain availability before launch. It lives in one constant, `src/lib/site.ts`.

## What is built

| Route | Template | Notes |
|---|---|---|
| `/` | homepage | Dated factual H1 (the citable unit), 6 change cards, flip feed, top-20 table |
| `/funding` | hub | 25 contracts × 3 venues, annualised. One link per row |
| `/funding/{symbol}` | entity | 25 pages. 404s below the coverage floor rather than rendering thin |
| `/open-interest` | hub | OI, volume, turnover multiple |
| `/tools` | hub | Lists only shipped tools |
| `/tools/liquidation-price` | tool | Tier-correct vs naive, with the gap shown |
| `/watchlist` | utility | All contracts server-rendered; pinning is client-side. `Disallow`ed in robots.txt |
| `/methodology` | reference | Why quoted rates are not comparable, with a live worked example |
| `/methodology/liquidations` | reference | Why no liquidation totals are published |
| `/data-sources` | reference | Every endpoint, cadence, and what is deliberately absent |
| `/robots.txt`, `/sitemap-index.xml`, `/sitemaps/*.xml` | — | One sitemap per template |

## Data

Two keyless Hyperliquid calls, verified 2026-08-14:

- `POST /info {"type":"metaAndAssetCtxs"}` — 232 contracts: funding, openInterest, markPx,
  oraclePx, prevDayPx, dayNtlVlm, premium, maxLeverage, marginTableId
- `POST /info {"type":"predictedFundings"}` — 232 × 3 venues (Hyperliquid, Binance, Bybit)
- `POST /info {"type":"marginTable","id":N}` — margin tiers, fetched at build time

Coverage floor: $5M notional open interest. 50 contracts clear it; phase 0 publishes 25.

**OKX is not a source.** Its API Agreement §9.4 (2026-07-28) forbids publishing or displaying
its market data, explicitly including public endpoints and non-commercial use. It may only be
used internally to compute derived values, never displayed or attributed.

## Architecture

```
GitHub Actions (build)      Cron Worker (5 min)          Pages Function (request)
margin tables -> JSON       metaAndAssetCtxs      \
OG images     -> R2         predictedFundings      ---> KV -----> HTML with numbers
                            -> KV + D1 history           D1        at first byte
```

Pages read KV, never the upstream API. An upstream outage cannot take a page down — it can
only make the timestamp older. The dev server fetches upstream directly, which is why a
timeout there produces an error page and in production would not.

## Setup

```bash
npm install
npm run gen:margin          # refresh committed margin tiers
npm run dev
```

Before deploy: create the KV namespace and D1 database, put their ids in `wrangler.toml`,
apply `worker/schema.sql`, then trigger `/ingest` once so KV is populated before first render.

## Acceptance tests

These are the build's real contract. Run them in CI, not once.

```bash
# 1. numbers present for a non-JS AI crawler
curl -s -A "GPTBot/1.1" $URL/funding/btc | grep -q "10.95%"

# 2. nav labels are text nodes, not aria-label
curl -s $URL/funding | grep -q '<span class="rail__label">Funding</span>'

# 3. collapsed and expanded markup identical apart from the state class
diff <(curl -s $URL/funding | grep -o 'href="[^"]*"' | sort) \
     <(curl -s -H "Cookie: rail=0" $URL/funding | grep -o 'href="[^"]*"' | sort)

# 4. no destination is desktop-only (mobile-first parity)
# 5. SearchAction absent — Google removed the sitelinks searchbox 2024-11-21
curl -s $URL/ | grep -c SearchAction   # must be 0
```

Verified 2026-08-14: 44 anchors on `/funding` in both rail states, identical href sets,
identical label text nodes; JSON-LD is `WebSite` + `Organization` only; `/methodology` and
`/data-sources` are mobile-hidden in the rail but present in the footer.

## Not built yet

Four calculators (funding arbitrage, cost of carry, position size, leverage), OG image
generation, the Telegram alert path that the `funding_snapshot` table exists to feed, and the
account entry in the shell — deliberately absent until an account system exists, since a
button pointing at an empty page would break the no-thin-pages rule.

Liquidation **events** are out of scope by decision, not oversight: Hyperliquid exposes
liquidations only through a per-address subscription, so a market-wide series would require a
block indexer. See `/methodology/liquidations`.
