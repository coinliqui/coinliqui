# Indexation — 2026-W35

https://coinliqui.com · started 2026-08-24 07:02 UTC

## A. Coverage

What exists, and whether a crawler can still fetch it. No credentials — this section always runs.

| Template | URLs | Fetchable as GPTBot |
|---|---:|---:|
| `pages` | 7 | 7/7 |
| `coins` | 11 | 11/11 |
| `funding-hub` | 1 | 1/1 |
| `funding-symbols` | 50 | 50/50 |
| `open-interest` | 1 | 1/1 |
| `tools` | 5 | 5/5 |
| `liquidations` | 3 | 3/3 |
| `unlocks` | 1 | 1/1 |
| **total** | **79** | **79/79** |

> **The URL list on this reading was reconstructed, not captured.** Section A gained a
> covered-set diff after this run finished, so W35 had no list of its own. It was rebuilt
> on 2026-08-24 from the live sitemap, whose per-template counts match the table above
> exactly. W36 will diff against it; anything that changed between 07:02 and the rebuild
> is invisible to that comparison and will surface a week late.

## B. Search Console

### Indexed share, per template

| Template | Indexed | Crawled, not indexed | Discovered, not crawled | Unknown to Google | Other |
|---|---:|---:|---:|---:|---:|
| `pages` | 7/7 (100%) | 0 | 0 | 0 | 0 |
| `coins` | 9/11 (82%) | 0 | 2 | 0 | 0 |
| `funding-hub` | 1/1 (100%) | 0 | 0 | 0 | 0 |
| `funding-symbols` | 40/50 (80%) | 0 | 10 | 0 | 0 |
| `open-interest` | 1/1 (100%) | 0 | 0 | 0 | 0 |
| `tools` | 4/5 (80%) | 0 | 1 | 0 | 0 |
| `liquidations` | 1/3 (33%) | 0 | 2 | 0 | 0 |
| `unlocks` | 1/1 (100%) | 0 | 0 | 0 | 0 |

**The 15 URLs Google has not indexed**, with its own reason for each. Read the
reason before acting: *Discovered — currently not indexed* is a queue, and the answer is
usually to wait and watch the series below; *Crawled — currently not indexed* is a
judgement about the page, and the answer is to change the page.

| URL | Template | Verdict | Google's coverage state |
|---|---|---|---|
| `/coins` | `coins` | NEUTRAL | Discovered - currently not indexed |
| `/coins/xrp` | `coins` | NEUTRAL | Discovered - currently not indexed |
| `/funding/zro` | `funding-symbols` | NEUTRAL | Discovered - currently not indexed |
| `/funding/vvv` | `funding-symbols` | NEUTRAL | Discovered - currently not indexed |
| `/funding/gram` | `funding-symbols` | NEUTRAL | Discovered - currently not indexed |
| `/funding/trx` | `funding-symbols` | NEUTRAL | Discovered - currently not indexed |
| `/funding/ltc` | `funding-symbols` | NEUTRAL | Discovered - currently not indexed |
| `/funding/cashcat` | `funding-symbols` | NEUTRAL | Discovered - currently not indexed |
| `/funding/ethfi` | `funding-symbols` | NEUTRAL | Discovered - currently not indexed |
| `/funding/pengu` | `funding-symbols` | NEUTRAL | Discovered - currently not indexed |
| `/funding/kbonk` | `funding-symbols` | NEUTRAL | Discovered - currently not indexed |
| `/funding/morpho` | `funding-symbols` | NEUTRAL | Discovered - currently not indexed |
| `/tools/position-size` | `tools` | NEUTRAL | Discovered - currently not indexed |
| `/liquidations/sweep` | `liquidations` | NEUTRAL | Discovered - currently not indexed |
| `/liquidations/survival` | `liquidations` | NEUTRAL | Discovered - currently not indexed |

### Search performance, 2026-08-15 to 2026-08-22

| Template | Impressions | Clicks | Avg position | Pages with impressions |
|---|---:|---:|---:|---:|
| `pages` | 75 | 3 | 6.6 | 6/7 |
| `coins` | 8 | 0 | 31.4 | 5/11 |
| `funding-hub` | 29 | 0 | 52.6 | 1/1 |
| `funding-symbols` | 392 | 1 | 31.5 | 25/50 |
| `open-interest` | 11 | 0 | 14.9 | 1/1 |
| `tools` | 18 | 0 | 22.2 | 4/5 |
| `liquidations` | 70 | 1 | 40.2 | 1/3 |
| `unlocks` | 117 | 0 | 61.4 | 1/1 |

### Top queries

| Query | Impressions | Clicks | Position |
|---|---:|---:|---:|
| aave | 1 | 0 | 8.0 |
| aave funding | 1 | 0 | 63.0 |
| aster funding | 1 | 0 | 55.0 |
| bitcoin liqudation map | 1 | 0 | 67.0 |
| bitcoin liquidation map | 1 | 0 | 67.0 |
| bitcoin perpetual funding rate | 1 | 0 | 81.0 |
| btc aggregated funding rate chart | 1 | 0 | 60.0 |
| btc funding rate | 1 | 0 | 75.0 |
| btc funding rate current | 1 | 0 | 75.0 |
| btc liquidation chart | 1 | 0 | 63.0 |
| btc liquidation heat map | 1 | 0 | 54.0 |
| btc liquidation heatmap | 2 | 0 | 36.0 |
| btc liquidation heatmap all exchanges | 1 | 0 | 56.0 |
| btc liquidation map | 8 | 0 | 52.4 |
| btc usdt funding rate 8h | 1 | 0 | 68.0 |

## C. Crawler fetches

Not available: CF_ANALYTICS_TOKEN is not set.

Setup for this section is in DEPLOY.md.

## D. Legal reading age

**Oldest reading: 5 days (hyperliquid-tou).** Nothing overdue.

| Document | Read | Window | Dated on the document |
|---|---:|---:|---|
| hyperliquid-tou | 5d | 30d | 2026-06-15 |
| coinbase-market-data | 5d | 90d | 2026-08-07 |
| bybit-api | 5d | 90d | 2026-01-16 |

## What to read first

1. **Section A must be all green.** A URL a crawler cannot fetch is not an indexing problem.
2. **Indexed share by template, not by page.** One template stuck in *Discovered — currently
   not indexed* past week 6 is a thin-template problem; scattered pages are just latency.
3. **Position before impressions.** Impressions on a new domain arrive late and jump around;
   average position per template moves earlier and more honestly.
4. **Crawler fetches are the leading indicator.** If they are zero, nothing downstream can
   move, and the cause is access rather than quality.
5. **Section D is the one nothing else can catch.** Every other failure on this site has a
   technical symptom. A change to the terms this site depends on has none — the pages keep
   rendering perfectly — so the only detector is somebody re-reading the document.
