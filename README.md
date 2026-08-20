# coinliqui

**[coinliqui.com](https://coinliqui.com)** — perpetual funding, normalised.

A free, independent, read-only reference site for crypto derivatives data: perpetual funding
rates compared across Hyperliquid, Binance and Bybit on a common annualisation; open interest;
modelled liquidation levels; on-chain token vesting contracts read directly from Ethereum; and
spot prices from Coinbase Exchange.

**How the three venues are read, stated up front because it is the one claim here that could
otherwise be falsified.** Only Hyperliquid is queried directly. The Binance and Bybit funding
rates arrive because Hyperliquid republishes them in its `predictedFundings` feed, so this site
compares three venues' rates through one venue's endpoint — a normalisation of a republished
figure, not three independent connections. [/data-sources](https://coinliqui.com/data-sources)
names the endpoint behind every number, this one included.

**It is not an exchange.** There are no accounts, no sign-up, no deposits or withdrawals, no
wallet connection, no token and no referral programme. It never asks for money, keys, seed
phrases or personal details, and has no mechanism to accept them. It is not affiliated with
Liqui, liqui.io, Coinliqui.io, LiquiTrade, or any exchange or broker.

This repository is the source of that site. It is published so the claims the site makes about
itself can be checked rather than taken on trust:

| Claim the site makes | Where to check it in this repo | Where to check it live |
|---|---|---|
| Every number names its source | [`src/lib/`](src/lib) fetchers, one per upstream | [/data-sources](https://coinliqui.com/data-sources) |
| The arithmetic is stated, not hidden | [`src/lib/funding.ts`](src/lib/funding.ts), [`src/lib/margin.ts`](src/lib/margin.ts) | [/methodology](https://coinliqui.com/methodology) |
| Figures are rendered server-side, not fetched by script | `.astro` templates under [`src/pages/`](src/pages) | view-source on any page |
| Nothing is published that cannot be stood behind | [`/methodology/liquidations`](src/pages/methodology/liquidations.astro) — why no liquidation totals exist here | [/methodology/liquidations](https://coinliqui.com/methodology/liquidations) |
| The ingest's real success rate, failures included | [`worker/ingest.ts`](worker/ingest.ts) | [/status](https://coinliqui.com/status) |
| Indexation is reported, not asserted | [`worker/report.ts`](worker/report.ts) | [/status/indexation](https://coinliqui.com/status/indexation) |

Contact: **hello@coinliqui.com** · Security reports: [security.txt](https://coinliqui.com/.well-known/security.txt)

## How it is built

Built to the project's SEO constitution: every displayed number is in the server-rendered HTML
at first byte, every navigation link is a real `<a href>`, no page ships without real data
behind it.

`npm run check` is a hard gate and nothing is pushed past it. It runs a typecheck, a build,
the invariant suites, and a smoke pass that renders every route against both a warm fixture and
an empty store. Its checks exist, nearly all of them, because a specific defect shipped, and each
carries the account of what it missed; most also carry a *blind case* — the same check run
against a deliberately reintroduced fault, so a check that has stopped seeing anything fails
instead of passing quietly.

Deployment: `npm run deploy:site` — direct upload, gated by `npm run check`. There is no git
integration and its absence is deliberate; the reasoning, and the API calls behind it, are in
**[DEPLOY.md](DEPLOY.md)** §7a. Credentials: `npm run preflight`.

**Brand lives in one constant.** `SITE.name` in `src/lib/site.ts` feeds the rail wordmark,
the JSON-LD and every `<title>` — pages pass a bare title and `Base.astro` appends the
suffix, so a rename is one line rather than one per template. `STORE_NS` does the same for the
one key this site's own code writes to a visitor's browser, which is why `/privacy` can print
the exact key instead of a copy that drifts. Analytics cookies are set by Google's tag and are
not in that constant.

## Principal routes

Not an inventory — the complete list of what is served, and the expected status of each, is
`ROUTES` in [scripts/smoke.mjs](scripts/smoke.mjs), which is the list the gate actually renders
on every push. A table here would be a second copy that drifts, and the first version of this
file drifted exactly that way, naming contract and sitemap totals that the code had long since
moved past — in a paragraph explaining why counts do not belong in this file.

| Route | Template | Notes |
|---|---|---|
| `/` | homepage | Dated factual H1, change cards, flip feed, top-20 table |
| `/funding` | hub | Every published contract × 3 venues, annualised. One link per row |
| `/funding/{symbol}` | entity | One page per published contract, capped at `SYMBOL_CAP`. Candles, volume and the funding band on one time axis. 404s below the coverage floor rather than rendering thin |
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
| `/privacy` | reference | What is collected: no accounts, no payment or personal data, GA4 |
| `/status` | operational | Snapshot age, per-venue coverage, canary history. `Disallow`ed |
| `/robots.txt`, `/sitemap-index.xml`, `/sitemaps/*.xml` | — | One sitemap per template, so Search Console reports an indexation rate per template |

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

**OKX is not a source, and is not called at all.** There is no OKX request anywhere in this
codebase — checkable by grep, and the operative fact. It was ruled out on an **uncited and unverified**
reading of OKX's API Agreement §9.4, recorded on 2026-07-28 and understood at the time to forbid
publishing or displaying its market data including from public endpoints and for non-commercial
use — no URL was kept and the document has not been re-read, so that is the reason for a
decision rather than a statement about what OKX's terms say.
An earlier version of this line also said OKX "may only be used internally to compute derived
values". That was false — no OKX request has ever existed here — and it is removed.

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

## A mid-render throw is a 200, not a 500

**This was wrong in our heads for the whole class, and it changes what the failure costs.**

Astro streams. A throw partway through a template flushes the status and everything rendered so
far, then stops — the error goes to the log, never into the body. So a TypeError in a template
does not reach a reader as a 500. It reaches them as **200 text/html with a truncated body**:
measured at 0 bytes under `wrangler pages dev`, which buffers, and at 9,159 bytes in production,
which does not.

A crawler **stores the amputated page** rather than skipping it. An error page is retried; a
successful empty one is indexed.

Two of this project's defects presented exactly this way — an unimported `SYMBOL_CAP` in
`404.astro`, and the margin-table lookup that hands `undefined` to `tierFor`. Neither showed a
non-200 anywhere.

So completeness is asserted, not assumed:

- `scripts/smoke.mjs` — every one of its 45 routes, cold and warm
- `scripts/verify-live.mjs` §5 — **every URL in the sitemaps**, 79 documents. It used to be
  eight hand-picked paths in §7, while §5 walked all 79 and used the brand string as its
  "did it render" test. `Coinliqui` is in the `<title>`, inside the first two kilobytes, so it
  is satisfied by the header of a page whose body never arrived.
- `scripts/degraded.mjs` — the same assertion with the data deliberately removed

The predicate is defined once (`rendersToEnd`) and the self-test exercises **that** function.
It used to carry its own copy and prove the copy could tell the two apart.

## A fix can make a failure unreachable instead of impossible

They look identical from inside the gate, and this project keeps producing them.

`seed-smoke-kv.mjs` was written because the warm fixture was a point-in-time capture: features
added after it read keys that were not there, the gate rendered the empty branch, and the defect
shipped — twice. Seeding every key fixed that, and made **all ten of the site's empty states
unreachable** in the same stroke. Correct fix, and it removed the ability to observe its own
counterpart. `scripts/degraded.mjs` is the answer: exercise the degraded path deliberately
rather than by accident.

The same shape, found by looking for it:

- **Four depth floors in `src/lib/candles.ts`** — 20 daily, 24 m15, 24 hourly, 24 funding — a
  second copy of a decision every consumer already makes better (`MIN_CHART_BARS = 6` on the
  aggregated count, `series.length > 40`, `closedDays.length > hold + 12`). Where they disagreed
  the blunt one won, invisibly: a contract listed four hours ago holds 20 fifteen-minute bars —
  20 at 15m, 10 at 30m, both far above the chart floor — and the page said *"Candles not
  collected yet"* about candles that were collected. The reader judges shape now; the consumer
  judges sufficiency. `scripts/read-floor-cases.mjs` fails if a floor regrows in either place.
- **`getM15`/`getHourly`/`getCandles`/`getFunding`/`getLive` collapse three states into one** —
  KV threw, the key is absent, or the value is unreadable. All become `null`, all render the same
  sentence, and no instrument downstream can recover which. Documented rather than fixed: the
  reader-facing behaviour is right, and distinguishing them needs a channel the read path does
  not have. Named here so it is a known limit rather than a surprise.

### The standing question at the end of every fix

**Did this make the failure impossible, or just unobservable?**

Not only when going looking for the pattern — every time. The two are indistinguishable from
inside the gate, and the second one is worse than no fix, because it also removes the evidence.

A fix passes when you can say which:

- what state used to produce the failure
- what now happens in that state instead
- what would go red if the fix were reverted

If the third has no answer, the failure was made unobservable. The reverting is not rhetorical —
`degraded.mjs` found its own blind spot only when the guard it tests was actually deleted, and
`read-floor-cases.mjs` only counts because putting the 24 back turns it red.

## Before wiring a check in: what does it fire on today?

Two questions, asked of every new check **before** it goes in the gate:

1. **What does this fire on today?** Run it against the current tree and read every finding.
2. **Is that list shorter than its exemption list?** If not, the check is wrong, not the code.

A check with more exemptions than findings is not strict — it is a list of things somebody
decided not to fix, wearing a check's clothes. It gets ignored, then deleted, and the defect it
was written for comes back unnoticed.

This is recorded because recording it was not enough. `scripts/checks.mjs` already carried the
sentence *"an inferred rule that fires on every flex row would be turned off within a week"*, and
the first version of `controlGroupOverflow` did exactly that: it asked every flex rule in the
stylesheet to wrap or be exempted and fired on ten — `.btn`, `.verdict`, `.empty`, `.nav-item`,
both topbar clusters — every one a fixed arrangement of two or three children that cannot grow.
Ten findings, ten exemptions, zero defects.

The fix was to narrow the **input**, not the rule: containers whose children come from a
`.map()`, because that is the set whose size nobody chose. It now fires on nothing and needs no
exemptions. **Narrowing the input is almost always the answer; lengthening the exemption list
almost never is.**

## Reachability: verify at a phone width, as a reader

**Every check in this repository reads one moment, in one viewport, at one width.** The worst
defect found so far was invisible to all of them.

Measured on the live site at `innerWidth: 371`: the eight-button timeframe group was **442px
wide**, `flex-wrap: nowrap`, `overflow-x: visible`. 1W sat at x=366 and 1M at x=420 — both past
the right edge, no scrollbar, no fade, no affordance. The document scrolled sideways instead,
472px against a 371px viewport, on all sixty chart pages. The last button a reader could reach
was 1D, which is also the default, so the page read as though it had one timeframe.

The buttons were present, correct, labelled, wired, and served identically to every crawler. The
markup was right. The fetch was right. Desktop was right. It was only wrong on a phone, and only
to a person holding one.

**Presence is not reachability.** They are different properties and nothing automated here tests
the second one. `controlGroupOverflow` in `scripts/checks.mjs` is a floor — it asserts that any
container rendering a *generated* list of controls wraps or scrolls — but it cannot measure
layout, and layout is where this lives.

So, as a standing step whenever anything visual changes:

```
resize to 375x812, then on each page family:
  document.documentElement.scrollWidth === innerWidth      # the page must not scroll sideways
  every button/a/select/input: rect.right <= innerWidth    # or inside an overflow-x:auto parent
  every control row: scrollWidth <= clientWidth            # or carrying the mask fade
  open the drawer: its items fit, and it scrolls if it does not
```

Run it as a reader — click the controls, do not just query them. Three of this project's own
instrument bugs looked exactly like site failures because the parser and the reader were asking
different questions.

**A control inside a horizontally scrolling `.panel` is acceptable** — that is the table pattern,
and the mask fade signals it. A control past the edge of the *page* is not: nothing signals it,
and the reader has no reason to believe there is more.

Swept 2026-08-20 at 375px across every page family — `/`, `/coins`, `/coins/[coin]`, `/funding`,
`/funding/[symbol]`, `/liquidations` and both sub-pages, `/open-interest`, `/unlocks`, all four
`/tools`, `/watchlist`, `/status`, `/data-sources`, `/methodology`, `/terms`, `/about`. Every one
`375/375`. The only element-level overflows are inside `.panel` containers that carry the fade.

## Multi-agent findings: never pass evidence through a prompt

When a multi-agent run produces findings that a later step summarises, the summarising step must
read them **from disk with an expected count**, not receive them interpolated into its prompt.

This rule exists because the alternative failed twice in one day. A run produced ten findings;
the synthesis step got them as `JSON.stringify(findings).slice(0, 26000)`; the slice cut
mid-record; and the final report stated a conclusion about ten candidates having read four. Both
times the conclusion was right, which is the dangerous version — nothing in the output
distinguished "read everything" from "read 40% and generalised", and both times it was caught
afterwards by reading the run journal by hand. That is not a mechanism.

A bigger slice is not the fix; it fails the same way one input later. The convention:

1. every finder agent writes its own result to `<dir>/<key>.json` as it finishes;
2. the script passes the synthesis agent that directory **and the expected count**;
3. the synthesis agent runs `node scripts/wf-collect.mjs <dir> <expected>`;
4. the synthesis agent is instructed to refuse to synthesise on a non-zero exit, and to report
   the run as incomplete rather than reporting on whatever survived.

`wf-collect.mjs` prints the complete set or exits 1 naming exactly what is missing. It refuses on
a short set, on unexpected extras (the caller's model of the run is wrong), on a file that will
not parse, and on a finder that returned `{}` or `null` — an empty-but-valid result pads the
count and makes a partial set look whole, which is the same lie arriving from the other end.

```bash
node scripts/wf-collect.mjs --blind    # nine cases: it accepts only the complete set
```

## Deliberately not built

**Accounts, and any notification channel.** No sign-up, no identity, no email, no wallet
connection, no bot. The watchlist is `localStorage`, the calculators compute in-page, and
`/privacy` says what is collected. Analytics is a separate question and the answer is yes —
GA4 runs; it is operational tooling, not a claim the site makes about itself.

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
| B. Search Console | `GSC_SA_KEY` | indexed share per template, position, impressions, top queries — the service account must be a delegated **Owner** on the Domain property, not a Full user: URL Inspection is owner-only |
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
