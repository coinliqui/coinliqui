# Retrieval baseline — 2026-08-20

A dated reading, kept so the next one has something to diff against. The last retrieval
measurements lived in a comment in `src/lib/site.ts` and were nearly impossible to compare
against; this file exists because that was the problem.

Every number here was measured on 2026-08-20 unless the row says otherwise. **Method is
recorded with each one**, because two of these are not the same measurement as their
predecessor and reading them as a trend would be wrong.

## A. Brand and topical retrieval

| Query | 18–19 Aug (recorded in site.ts) | 20 Aug | Change |
|---|---|---|---|
| `coinliqui` | nothing for this domain; returns coinliq.com, coinli.net, coinlib.io, CoinMarketCap/Liqui | nothing for this domain; returns coinli.net, coinliq.com, CoinMarketCap/Liqui, Wikipedia coin pages | **none** |
| `coinliqui.com perpetual funding rates annualised` | not measured | nothing for this domain; returns altrady, coinbase/learn, loris.tools, coinglass, coinmarketcap | first reading |

The substitution behaviour is unchanged: the engine resolves the token to *coinliq* and answers
about that site. Six days is not long enough for this to move, and nothing here should be read
as evidence either way.

## B. What an extractor takes from the page

Method: fetch the URL, convert to markdown, answer a fixed set of questions with a small model —
the same shape as a RAG pipeline, and **not** the same measurement as A. A fetch tests the page;
a query tests the index.

### `/about` — the identity question

| | Before the fix | After the fix |
|---|---|---|
| Verdict | "Trustworthy, with caveats" | "Uncertain, leaning toward trustworthy" |
| First verification route named | "examining the public GitHub repository at github.com/coinliqui/coinliqui showing actual code and commit history" | "Every endpoint is named on data sources, and they are public APIs — you can call the same ones and compare" |
| Grounds quoted | "The source is public...with the commit history behind it" | "The source repository is not publicly reachable at present, so it is not offered here as evidence" |
| Would the named route survive being followed? | **No — 404** | Yes, all four |

The stated verdict is weaker and it is now **true**. Before, it rested on a link that returned
404 to every signed-out reader, so an agent that actually followed it would have arrived
somewhere worse than "uncertain".

Baseline for context — the answer this identity block was written to end, from a Google
assistant asked about the domain with no page supplied: *"not a known, authoritative or
operating cryptocurrency service"*, *"most likely a typo, or a malicious or fraudulent (scam)
platform imitating well-known brands"*. That measurement has **not** been repeated and the rows
above are not comparable to it.

### `/funding/btc` — the data question

Facts returned, each with a date attached: mark price, funding APR with direction, period high.
Staleness: **yes** — the extractor found `Figures as of 2026-08-20 14:17 UTC` and bound it to the
figures. Sources: correctly attributed to Hyperliquid, Binance, Bybit and Ethereum JSON-RPC, and
it followed the pointer to `/data-sources` for the per-figure mapping.

Nothing to fix here. The citable unit on a contract page is intact.

## C. Crawler reach at the edge

Every one of thirteen AI and search crawlers gets `200` on four paths (`verify-live` §1). Real
traffic, from Cloudflare's adaptive dataset, excluding our own `coinliqui-selfcheck` traffic:

| Crawler | 17→18 Aug | 18→19 Aug | 19→20 Aug |
|---|---:|---:|---:|
| GPTBot | 3,392 | 89 | 1 |
| ClaudeBot | 288 | 48 | 48 |
| Googlebot | 569 | 26 | 49 |
| ChatGPT-User | 205 | 44 | 41 |
| bingbot | 145 | 15 | 28 |
| PerplexityBot | 172 | 6 | 3 |
| OAI-SearchBot | 164 | 6 | 4 |
| Applebot | 176 | 2 | 0 |
| Claude-User / Claude-SearchBot | 116 / 109 | 32 / 0 | 0 / 0 |
| Amazonbot | 104 | 1 | 0 |
| meta-externalagent | 0 | 9 | 52 |

Non-200s to crawlers, all three days: `/tools/liquidation-price` → 410 to Googlebot (deliberate,
that URL is retired) and `img.coinliqui.com/sitemap.xml` → 404 to ClaudeBot, twelve times a day.
The second one is fixed — see D.

## D. Fixed in this pass

- `sameAs` / `/about` / `llms.txt` no longer publish a URL that 404s. `verify-live` §17 now
  fails on any published self-claim URL that does not answer a signed-out reader.
- `img.coinliqui.com` is an empty R2 bucket on a public custom domain. It answered 404 to
  everything and served Cloudflare's managed robots.txt, which carries content signals and no
  rules — so crawlers read "index everything" and found nothing. It now serves a real
  `robots.txt` with `Disallow: /`.
- `/methodology` claimed "the raw comparison every other site publishes is wrong" (and
  "everyone else" in its meta description). Replaced with the checkable form.
- `/unlocks` claimed depth "produced everything on this page that nobody else has". Replaced.
- `/privacy` and `/methodology/liquidations` published a lastmod in the sitemap and no
  `dateModified` in their own structured data. Both now read the same `codeStamp()`.
- `/about` and `/terms` were absent from `gen-lastmod.mjs`; seven other routes had drifted 1–2
  days behind git. `--check` mode added and wired into `deploy:site`.
- `/tools/funding-cost` had one inbound link site-wide. The fifty contract pages link to it now.
- The fifty contract meta descriptions had the open-interest figure past the snippet cut.

## E. Measured and deliberately not changed

- **Titles**: 68 of 79 exceed ~60 characters. The overflow is the ` | Coinliqui` suffix plus a
  clause; the distinguishing part is already inside the cut.
- **Descriptions**: 75 of 79 exceed ~160 characters. Only the funding template was rewritten,
  because only there did a page-specific number sit past the cut.
- **`Dataset` structured data**: not added. The only machine-readable distribution is
  `/api/live.json`, which is `x-robots-tag: noindex, cache-control: no-store` on purpose. A
  `Dataset` node pointing at it would assert a published dataset that is not published.
- **`BreadcrumbList` on hub pages**: absent by design — the graph mirrors the visible trail, and
  hub pages print none.
