# Indexation — 2026-W34

https://coinliqui.com · started 2026-08-19 05:38 UTC

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

## B. Search Console

### Indexed share, per template

| Template | Indexed | Crawled, not indexed | Discovered, not crawled | Other |
|---|---:|---:|---:|---:|
| `pages` | 6/7 (86%) | 1 | 0 | 0 |
| `coins` | 9/11 (82%) | 2 | 0 | 0 |
| `funding-hub` | 1/1 (100%) | 0 | 0 | 0 |
| `funding-symbols` | 42/50 (84%) | 8 | 0 | 0 |
| `open-interest` | 1/1 (100%) | 0 | 0 | 0 |
| `tools` | 4/5 (80%) | 1 | 0 | 0 |
| `liquidations` | 1/3 (33%) | 2 | 0 | 0 |
| `unlocks` | 1/1 (100%) | 0 | 0 | 0 |

**The 14 URLs Google has not indexed**, with its own reason for each. Read the
reason before acting: *Discovered — currently not indexed* is a queue, and the answer is
usually to wait and watch the series below; *Crawled — currently not indexed* is a
judgement about the page, and the answer is to change the page.

| URL | Template | Verdict | Google's coverage state |
|---|---|---|---|
| `/terms` | `pages` | NEUTRAL | URL is unknown to Google |
| `/coins` | `coins` | NEUTRAL | Discovered - currently not indexed |
| `/coins/xrp` | `coins` | NEUTRAL | URL is unknown to Google |
| `/funding/zro` | `funding-symbols` | NEUTRAL | URL is unknown to Google |
| `/funding/vvv` | `funding-symbols` | NEUTRAL | Discovered - currently not indexed |
| `/funding/gram` | `funding-symbols` | NEUTRAL | Discovered - currently not indexed |
| `/funding/trx` | `funding-symbols` | NEUTRAL | Discovered - currently not indexed |
| `/funding/cashcat` | `funding-symbols` | NEUTRAL | Discovered - currently not indexed |
| `/funding/ethfi` | `funding-symbols` | NEUTRAL | Discovered - currently not indexed |
| `/funding/ltc` | `funding-symbols` | NEUTRAL | Discovered - currently not indexed |
| `/funding/pengu` | `funding-symbols` | NEUTRAL | URL is unknown to Google |
| `/tools/position-size` | `tools` | NEUTRAL | Discovered - currently not indexed |
| `/liquidations/sweep` | `liquidations` | NEUTRAL | Discovered - currently not indexed |
| `/liquidations/survival` | `liquidations` | NEUTRAL | Discovered - currently not indexed |

### Search performance, 2026-08-10 to 2026-08-17

| Template | Impressions | Clicks | Avg position | Pages with impressions |
|---|---:|---:|---:|---:|
| `pages` | 10 | 1 | 3.5 | 4/7 |
| `coins` | 1 | 0 | 66.0 | 1/11 |
| `funding-hub` | 2 | 0 | 69.0 | 1/1 |
| `funding-symbols` | 67 | 1 | 18.0 | 16/50 |
| `open-interest` | 1 | 0 | 8.0 | 1/1 |
| `tools` | 5 | 0 | 46.2 | 2/5 |
| `liquidations` | 17 | 0 | 41.1 | 1/3 |
| `unlocks` | 14 | 0 | 46.6 | 1/1 |

### Top queries

| Query | Impressions | Clicks | Position |
|---|---:|---:|---:|
| aave | 1 | 0 | 8.0 |
| aster funding | 1 | 0 | 55.0 |
| bitcoin liquidation map | 1 | 0 | 67.0 |
| btc liquidation heat map | 1 | 0 | 54.0 |
| btc liquidation heatmap | 2 | 0 | 36.0 |
| btc liquidation map | 2 | 0 | 41.0 |
| eth funding rate | 1 | 0 | 55.0 |
| funding rate history hyperliquid | 1 | 0 | 59.0 |
| funding rate hyperliquid | 1 | 0 | 61.0 |
| kaito liquidation heatmap | 1 | 0 | 10.0 |
| kangeroo coin token sale vesting schedule | 1 | 0 | 53.0 |
| sol funding rate | 1 | 0 | 66.0 |

## C. Crawler fetches

Not available: CF_ANALYTICS_TOKEN or CF_ZONE_ID is not set.

Setup for this section is in DEPLOY.md.

## What to read first

1. **Section A must be all green.** A URL a crawler cannot fetch is not an indexing problem.
2. **Indexed share by template, not by page.** One template stuck in *Discovered — currently
   not indexed* past week 6 is a thin-template problem; scattered pages are just latency.
3. **Position before impressions.** Impressions on a new domain arrive late and jump around;
   average position per template moves earlier and more honestly.
4. **Crawler fetches are the leading indicator.** If they are zero, nothing downstream can
   move, and the cause is access rather than quality.
