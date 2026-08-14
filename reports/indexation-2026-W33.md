# Indexation — 2026-W33

https://coinliqui.com · generated 2026-08-14 12:46 UTC

## A. Coverage

What exists, and whether a crawler can still fetch it. No credentials — this section always runs.

| Template | URLs | Fetchable as GPTBot | Median numbers in HTML |
|---|---:|---:|---:|
| `pages` | 5 | 5/5 | 2 |
| `funding-hub` | 1 | 1/1 | 147 |
| `funding-symbols` | 25 | 25/25 | 861 |
| `open-interest` | 1 | 1/1 | 51 |
| `tools` | 6 | 6/6 | 13 |
| `liquidations` | 3 | 3/3 | 179 |
| `unlocks` | 1 | 1/1 | 10 |
| **total** | **42** | **42/42** | |

## B. Search Console

Not available: GSC_SA_KEY is not set.

To enable: create a Google Cloud service account, enable the Search Console API, then add the
service account's email as a **full user** on the `coinliqui.com` Domain property in Search
Console. Put the JSON key in the `GSC_SA_KEY` secret. Nothing about the site changes.

## C. Crawler fetches

Not available: CF_ANALYTICS_TOKEN or CF_ZONE_ID is not set.

To enable: a Cloudflare token scoped to this zone with **Analytics → Read**, in the
`CF_ANALYTICS_TOKEN` secret, plus `CF_ZONE_ID`. If the free plan does not expose a
user-agent dimension, the same numbers are readable by eye in the dashboard under
**AI Crawl Control**, which is per-crawler and free.

## What to read first

1. **Section A must be all green.** A URL a crawler cannot fetch is not an indexing problem.
2. **Indexed share by template, not by page.** One template stuck in *Discovered — currently
   not indexed* past week 6 is a thin-template problem; scattered pages are just latency.
3. **Position before impressions.** Impressions on a new domain arrive late and jump around;
   average position per template moves earlier and more honestly.
4. **Crawler fetches are the leading indicator of all of it.** If they are zero, nothing
   downstream can move, and the cause is access rather than quality.
