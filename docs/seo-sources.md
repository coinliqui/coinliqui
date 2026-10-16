# SEO decisions: the sources they rest on

Every SEO change on this site cites either a Google primary source read recently or our own
measurement (Search Console, a crawl of production). Memory, skills and third-party SEO articles
are a reviewer's opinion: where they disagree with the documentation or a measurement, the
documentation and the measurement win. Re-read a source older than 30 days before acting on it.

## Primary sources, read 16 October 2026

| Source | Page updated | What it says that bears on this site |
|---|---|---|
| [Ranking systems guide](https://developers.google.com/search/docs/appearance/ranking-systems-guide) | 2025-12-10 | Systems work on the page level, plus site-wide signals and classifiers. PageRank is still a core system. Original content systems rank original reporting ahead of pages that cite it. Deduplication shows only the most relevant of very similar results. Helpful content system folded into core in March 2024. |
| [Helpful, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) | 2026-10-05 | Self-assessment: original information or analysis; descriptive title; "free of spelling and stylistic problems"; trust is the most important part of E-E-A-T, and E-E-A-T is not itself a ranking factor; YMYL (financial) gets more weight on trust. Warning signs: dates changed to look fresh, content added only to look fresh, readers having to search again. Who / How / Why: say how automated content was made. |
| [Spam policies](https://developers.google.com/search/docs/essentials/spam-policies) | 2026-08-28 | Scaled content abuse: many pages made mainly to rank, with little value, however they are produced. Accordions, tabs and screen-reader text are not hidden-text abuse. |
| [AI features and your website](https://developers.google.com/search/docs/appearance/ai-features) | 2025-12-10 | No extra requirements for AI Overviews or AI Mode: no special files, markup or schema. Indexed and snippet-eligible is enough; keep content in text and structured data matching visible text. |
| [Page experience](https://developers.google.com/search/docs/appearance/page-experience) | 2026-09-22 | Core Web Vitals are the only part used directly; good scores do not guarantee rankings. |
| [SEO starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide) | 2025-12-10 | Not factors: meta keywords, word count, keywords in the domain, heading order, E-E-A-T as a score. |
| [Title links](https://developers.google.com/search/docs/appearance/title-link) | 2025-12-10 | Descriptive and concise titles; boilerplate that varies by one detail gets rewritten; prices change too fast for a title. |
| [Snippets](https://developers.google.com/search/docs/appearance/snippet) | 2026-04-20 | Programmatic meta descriptions are encouraged on large database sites if they are built from page-specific data. |
| [Sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) | 2026-07-08 | lastmod is used only when it is consistently and verifiably accurate; priority and changefreq are ignored. |
| [Dataset structured data](https://developers.google.com/search/docs/appearance/structured-data/dataset) | 2026-09-08 | Targets Dataset Search, not ordinary results. Not worth the bytes here. |
| [How Search works](https://developers.google.com/search/docs/fundamentals/how-search-works) | 2025-12-18 | Near-duplicates are clustered and one canonical is chosen; indexing is never guaranteed. |

NavBoost (clicks used in ranking) is known from the US v. Google trial record and secondary
commentary, not from documentation. The only use made of it here is the conclusion Google's own
title guidance already supports: the title and snippet must promise what the page delivers.

## Measurements behind the decisions, 16 October 2026

- **Index (Search Console, Pages, last updated 12.10):** 146 indexed. Not indexed for reasons
  in our hands: canonical alternates 14, redirects 7, 404 6, noindex 1 (all intended). For reasons
  Google's systems decided: crawled, not indexed 5 (/liquidations/xrp, /liquidations/aave,
  /liquidations/chip, /funding/aero, /funding/avax); discovered, never crawled 6 (/funding/tia,
  /funding/w, /liquidations/hbar, /liquidations/ondo, /liquidations/uni, /liquidations/survival).
- **Links (Search Console):** 0 external links. 3,142 internal.
- **Crawl stats:** about 1,760 requests in 90 days (roughly 20 a day), 91% 200s, 376 ms mean.
- **Lab Core Web Vitals** (local Chrome, 412px, 4x CPU, 1.6 Mbps / 150 ms): LCP 0.38–0.85 s,
  CLS 0.000, no long tasks, on /, /liquidations, /funding, /funding/btc, /unlocks,
  /coins/bitcoin, /learn/funding-rate, /open-interest.
- **Every sitemap URL** (143): 200, self-canonical, no noindex, unique title and description.
- **Template prose share** (sentences identical across 15 sibling pages, numbers masked):
  /liquidations/{coin} about 21% identical prose, 30% shared sentences with their own figures, 45–55%
  unique; /funding/{coin} about 5% identical, 75% unique.
- **Queries** (named only, 17.09–14.10): liquidation map/heatmap phrasings about 110 impressions,
  all to /liquidations, positions 45–87; "hyperliquid liquidation map/heatmap" 29 of them.
  "hyperliquid funding rates" 25 impressions spread across six URLs at 80–97. "btc funding rate"
  phrasings about 25 to /funding/btc at 70–90. Every named query sits past position 45.

## Decisions taken on this basis

| Date | Change | Basis | Re-read |
|---|---|---|---|
| 16.10.2026 | "a ETH perpetual" → "the ETH perpetual" in 29 descriptions; the article follows the number in the funding-cost hold; `wrongArticles` check, live and blind | Helpful content: free of spelling and stylistic problems | live check, every deploy |
| 16.10.2026 | /funding title names its venues: "Funding rates on Hyperliquid, Binance and Bybit, annualised" | Title links: describe the page; GSC: "hyperliquid funding rates" split across six URLs | position and CTR for that query after 30.10.2026 |
| 16.10.2026 | /funding/{coin} title and heading carry the registry name, "Bitcoin (BTC)", for the ten coins in src/lib/coins.ts | GSC: "bitcoin funding rate perpetual" and similar reached a page that said only BTC | those queries after 30.10.2026 |
| 16.10.2026 | Brand once in a title; no canonical on a 404 or 410 | Title links: concise branding; one URL per piece of content | — |

| 16.10.2026 | /funding/paid: what funding cost in dollars over 30 days, per contract; the per-contract figure on every /funding/{coin} | Original content systems: original reporting ranks ahead of pages that cite it. A figure nobody else publishes, with its method on the page, is what a link is made to | impressions and links to /funding/paid from 06.11.2026 |
| 16.10.2026 | /about and llms.txt: provenance and method only, nothing about how text is made | Owner's ruling; Google's who/how guidance is advice, not a ranking input | — |

## Queued, with the reason they wait

- /liquidations and /liquidations/{coin}: name Hyperliquid and the registry name in the title, and build
  the description from the page's own derived figures (snippet guidance: page-specific data). Waits
  for the 22.10.2026 visits measurement of /liquidations*, so the two effects are not mixed.
