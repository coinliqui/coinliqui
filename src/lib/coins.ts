
/* =========================================================================================
   COINS — the perpetual pages, and why they no longer carry a spot price.

   THIS FILE USED TO BE THE SPOT LAYER. It selected Coinbase Exchange as the source for "what
   is the bitcoin price", and everything under /coins was built on that: a spot price, the
   24-hour stats around it, spot candle charts, and the basis between spot and the perpetual.

   ALL OF IT IS GONE, removed on 19 August 2026, and the reason is not a preference.

   Coinbase's Market Data Terms of Use (last updated 2026-08-07) were read in full on that
   date, in a browser, after three plain fetches had returned 403 and been wrongly recorded as
   "unreadable" — the block was bot mitigation, not a property of the document. What it says:

     - it binds on ACCESS ALONE: "By accessing or using Coinbase Market Data, you agree to be
       bound by these Market Data Terms of Use". No account, no key, no login;
     - the licence it grants is "exclusively for you or your entity's personal or research
       purposes and may not be used to build an application intended for use by end users";
     - and, absent prior express written consent, you may not "Redistribute, display, or
       disseminate the Market Data—or any data, charts, analytics, research, or other works
       based on, referring to, or derived from the Market Data ("Derived Works") — to any third
       party outside of your organization".

   A free public website is an application for end users, and "display" and "charts" and
   "derived from" are the site's whole relationship with that data. There was no ambiguity left
   to resolve. A separate clause forbids using the data to train or improve any AI model, which
   matters here specifically: this site invites GPTBot, ClaudeBot and PerplexityBot by name.

   WHAT REPLACED IT: Hyperliquid, for everything. Its Terms of Use (2026-06-15) are scoped by
   their own first sentence to "this website-hosted user interface ("Interface"), available at
   app.hyperliquid.xyz", bind on accessing that Interface, and contain no IP section, no
   data-ownership clause and no redistribution restriction — the words "API", "redistribute"
   and "scrape" do not appear in the document. We consume only api.hyperliquid.xyz and never
   load the Interface. That is not a grant and it is not claimed as one; it is silence scoped
   to a surface this site does not touch, which is the most that could be established.

   WHAT WAS LOST, stated plainly rather than minimised: the basis — the gap between spot and
   the perpetual mark — cannot be computed without a spot price and is gone from the site. It
   was the number that connected the two halves of these pages. One metric, against a section.

   WHAT WAS GAINED, which is not nothing: the perpetual series carries 15-minute bars, so the
   15m and 30m timeframes now work on these pages. Spot could never serve them.

   This file is now a coin REGISTRY — slugs, names, symbols, publication dates — and nothing
   else. It fetches no market data at all.
   ========================================================================================= */

export interface Coin {
  /** URL slug — the full name, because that is what people search. */
  slug: string;
  name: string;
  /** Hyperliquid perp symbol, for the derivatives layer. */
  symbol: string;
  /** One line on what the asset is, so the page is not purely numeric. */
  blurb: string;
  /**
   * PUBLICATION DATE, and the reason it exists: no more than 25-30 new URLs a week. Twenty-five
   * contract pages went live on 14 August, so only the hub and four coins can follow this week.
   * A coin is absent from the sitemap, unlinked from the hub and 404s until its date passes —
   * the rate limit is enforced by the code rather than remembered by a person.
   */
  publishAt: string;
}

export const COINS: Coin[] = [
  { slug: "bitcoin", name: "Bitcoin", symbol: "BTC", publishAt: "2026-08-14",
    blurb: "The first and largest cryptocurrency, and the one whose derivatives market sets the tone for every other." },
  { slug: "ethereum", name: "Ethereum", symbol: "ETH", publishAt: "2026-08-14",
    blurb: "The largest smart-contract platform, and the second-largest perpetual market by open interest." },
  { slug: "solana", name: "Solana", symbol: "SOL", publishAt: "2026-08-14",
    blurb: "A high-throughput layer-1 whose perpetual funding is among the most volatile of the majors." },
  { slug: "xrp", name: "XRP", symbol: "XRP", publishAt: "2026-08-14",
    blurb: "A payment-focused asset with a large retail spot base and comparatively small open interest." },
  { slug: "bnb", name: "BNB", symbol: "BNB", publishAt: "2026-08-17",
    blurb: "The BNB Chain asset, listed here because its perpetual funding rarely matches its spot demand." },
  { slug: "dogecoin", name: "Dogecoin", symbol: "DOGE", publishAt: "2026-08-17",
    blurb: "The original memecoin, and a reliable example of funding running far ahead of spot." },
  { slug: "cardano", name: "Cardano", symbol: "ADA", publishAt: "2026-08-17",
    blurb: "A research-led layer-1 with deep spot liquidity relative to its open interest." },
  { slug: "avalanche", name: "Avalanche", symbol: "AVAX", publishAt: "2026-08-17",
    blurb: "A layer-1 with a subnet architecture, and one of the smaller major perpetual markets by open interest." },
  { slug: "chainlink", name: "Chainlink", symbol: "LINK", publishAt: "2026-08-17",
    blurb: "The dominant oracle network, whose token trades with unusually persistent positive funding." },
  { slug: "litecoin", name: "Litecoin", symbol: "LTC", publishAt: "2026-08-17",
    blurb: "One of the oldest altcoins, with a long, clean price history and a modest derivatives market." },
];

/** Live if its publication date has passed. Compared in UTC, on date alone. */
export const isLive = (c: Coin, now = Date.now()) => Date.parse(c.publishAt + "T00:00:00Z") <= now;
export const liveCoins = (now = Date.now()) => COINS.filter((c) => isLive(c, now));
export const findCoin = (slug: string | undefined) =>
  slug ? COINS.find((c) => c.slug === slug.toLowerCase()) : undefined;

