/**
 * Tier-correct liquidation price.
 *
 * The formula in circulation on essentially every "liquidation price calculator"
 * that ranks for the term is:
 *
 *     liq = entry * (1 -/+ 1 / leverage)
 *
 * It is wrong, for two independent reasons:
 *
 *  1. It ignores maintenance margin. A position is closed when equity falls to the
 *     MAINTENANCE requirement, not to zero. The naive formula solves for equity = 0.
 *  2. It ignores margin tiers. Max leverage steps down as position size grows, so the
 *     maintenance requirement is a function of notional, not a constant.
 *
 * Hyperliquid documents maintenance margin as half the initial margin at max leverage,
 * i.e. maintenance margin fraction = 1 / (2 * maxLeverage), where maxLeverage is the
 * TIER-ADJUSTED value for the position's notional.
 *
 * Derivation (long, isolated margin), entry P0, size S, user leverage L:
 *     initial margin      M = P0*S / L
 *     equity at price P     = M + (P - P0)*S
 *     maintenance at P      = P*S*mmf
 *     liquidation when      M + (P - P0)*S = P*S*mmf
 *                       =>  P0/L + P - P0 = P*mmf
 *                       =>  P = P0 * (1 - 1/L) / (1 - mmf)
 * Short is symmetric:       P = P0 * (1 + 1/L) / (1 + mmf)
 *
 * The naive result is the special case mmf = 0.
 */

export interface MarginTier {
  /** Notional (USD) at which this tier starts. */
  lowerBound: number;
  maxLeverage: number;
}

export interface MarginTable {
  description: string;
  marginTiers: MarginTier[];
}

export type Side = "long" | "short";

export interface LiquidationInput {
  entryPrice: number;
  positionSize: number; // in base units (coins)
  leverage: number;
  side: Side;
  table: MarginTable;
}

export interface LiquidationResult {
  /** Correct, tier-aware liquidation price. */
  liquidationPrice: number;
  /** What the widespread naive formula returns. */
  naivePrice: number;
  /** naive - correct, in quote currency. Positive means the naive figure is further from entry. */
  differenceAbs: number;
  /* THE BASE IS IN THE NAME NOW, AND THAT IS THE FIX.
     This was `differencePct`, "difference as a share of the correct price", and three pages put it
     in the sentence "liquidation is 1.25% ($864.93) away from what the common formula returns" —
     which names the FORMULA's price as the reference while the percentage was taken on the
     CORRECT one. On BTC at 10× that is 1.25% against 1.27%; the claim-vs-table audit on
     16 September confirmed it on /funding/btc, /funding/trump and /tools/position-size. A share with
     no stated base will be read against whichever price the sentence happens to name.
     What a reader actually needs is the one comparison where both prices share a base: how far
     each puts liquidation from ENTRY. That is `distancePct` against `naiveDistancePct` — 8.86% of
     room, not the 10.00% the formula promises. */
  /** naive − correct as a share of the CORRECT price. Say so wherever it is printed. */
  differenceOfCorrectPct: number;
  /** Distance from entry to the correct liquidation, as a share of entry. */
  distancePct: number;
  /** Distance from entry to where the naive formula puts liquidation, as a share of entry — the
   *  same base as distancePct, so the two can be compared in one sentence. */
  naiveDistancePct: number;
  notional: number;
  /** Tier that applies at this notional. */
  tier: MarginTier;
  tierIndex: number;
  /** Maintenance margin fraction actually used. */
  maintenanceMarginFraction: number;
  /** Initial margin the position requires. */
  initialMargin: number;
  /** True when the requested leverage exceeds what the tier permits. */
  leverageClamped: boolean;
  effectiveLeverage: number;
}

/** The tier that applies to a given notional: the last tier whose lowerBound <= notional. */
export function tierFor(table: MarginTable, notional: number): { tier: MarginTier; index: number } {
  const tiers = [...table.marginTiers].sort((a, b) => a.lowerBound - b.lowerBound);
  let index = 0;
  for (let i = 0; i < tiers.length; i++) {
    if (notional >= tiers[i].lowerBound) index = i;
  }
  return { tier: tiers[index], index };
}

export function maintenanceMarginFraction(maxLeverage: number): number {
  // Hyperliquid: maintenance margin is half the initial margin at max leverage.
  return 1 / (2 * maxLeverage);
}

export function naiveLiquidationPrice(entryPrice: number, leverage: number, side: Side): number {
  return side === "long" ? entryPrice * (1 - 1 / leverage) : entryPrice * (1 + 1 / leverage);
}

export function liquidationPrice(input: LiquidationInput): LiquidationResult {
  const { entryPrice, positionSize, side, table } = input;
  const notional = entryPrice * positionSize;
  const { tier, index } = tierFor(table, notional);

  // A position cannot be opened above the tier's max leverage.
  const leverageClamped = input.leverage > tier.maxLeverage;
  const leverage = Math.min(input.leverage, tier.maxLeverage);

  const mmf = maintenanceMarginFraction(tier.maxLeverage);
  const correct =
    side === "long"
      ? (entryPrice * (1 - 1 / leverage)) / (1 - mmf)
      : (entryPrice * (1 + 1 / leverage)) / (1 + mmf);

  /* THE FORMULA IN CIRCULATION IS FED THE LEVERAGE THE READER ASKED FOR, not the clamped one.
     Its whole point is to show what someone gets from `entry × (1 − 1/leverage)` without knowing
     the venue's tiers — and someone who does not know the tiers does not know about the clamp
     either. It used the clamped leverage, so /learn/liquidation-price printed "Leverage requested:
     10× … Common formula says: $80.00" for a $4.00M position: $80 is what the formula gives at 5×,
     the tier's cap, which the same page says "neither is visible in the common formula". The gap
     column then measured the correct price against a naive price that already knew the answer.
     Confirmed by the claim-vs-table audit on 16 September. Unclamped contracts are unchanged. */
  const naive = naiveLiquidationPrice(entryPrice, input.leverage, side);

  return {
    liquidationPrice: correct,
    naivePrice: naive,
    differenceAbs: Math.abs(naive - correct),
    /* THE DENOMINATOR IS DERIVED, NOT SUPPLIED, AND IT REACHES ZERO. `correct` is computed four
       lines up, and at leverage 1 the factor (1 - 1/1) is exactly 0 in IEEE754, so both prices
       are 0 and this was 0/0 = NaN. Every input was validated; the value actually divided by was
       not. /tools/position-size accepts leverage=1 from its own dropdown, so the page whose job
       is to quantify the gap printed an em dash in the middle of the sentence saying so. */
    differenceOfCorrectPct: correct > 0 ? Math.abs(naive - correct) / correct : 0,
    distancePct: entryPrice > 0 ? Math.abs(correct - entryPrice) / entryPrice : 0,
    naiveDistancePct: entryPrice > 0 ? Math.abs(naive - entryPrice) / entryPrice : 0,
    notional,
    tier,
    tierIndex: index,
    maintenanceMarginFraction: mmf,
    initialMargin: notional / leverage,
    leverageClamped,
    effectiveLeverage: leverage,
  };
}

/**
 * The notional at which the next tier kicks in, if there is one.
 * Used on the page to show where the answer changes.
 */
export function nextTierBoundary(table: MarginTable, notional: number): MarginTier | null {
  const tiers = [...table.marginTiers].sort((a, b) => a.lowerBound - b.lowerBound);
  return tiers.find((t) => t.lowerBound > notional) ?? null;
}

/**
 * THE TIER-1 CORRIDOR AT ONE LEVERAGE — where a long is closed, where a short is closed, and
 * how far apart those two prices sit as a fraction of the mark.
 *
 * Derived, not modelled: given the maintenance margin from the published table and a mark,
 * every number here is arithmetic. It is the same pair of expressions as liquidationPrice()
 * uses, at tier 1 and for a notional of one unit — kept separate because the callers here are
 * drawing a LADDER across leverages at a fixed contract rather than pricing one position, and
 * threading a synthetic position size through liquidationPrice() to get the same two numbers
 * would obscure that.
 *
 * WHY IT IS A FUNCTION AT ALL. It was written out longhand in three places — the corridor
 * chart, the "falls off the picture" filter beside it, and the per-contract index on
 * /liquidations — and the three had to agree, because two of them are printed on the same
 * page under headings that say the same thing. The formula appears in five further places in
 * this repository (the map's hot loop, the survival counterfactual, and the calculators' inline
 * scripts, which cannot import). Those are deliberately left: consolidating a hot loop and a
 * browser-side script is a different change with a different risk, and pretending otherwise by
 * doing half of it is how a "single source" ends up being one of several.
 */
export function corridorAt(mark: number, L: number, mmf: number) {
  const longLiq = (mark * (1 - 1 / L)) / (1 - mmf);
  const shortLiq = (mark * (1 + 1 / L)) / (1 + mmf);
  return {
    L,
    longLiq,
    shortLiq,
    longDist: (mark - longLiq) / mark,
    shortDist: (shortLiq - mark) / mark,
    corridor: (shortLiq - longLiq) / mark,
    margin: 1 / L,
  };
}

/* =========================================================================================
   HOW THE VENUE'S ROOM COMPARES WITH THE FORMULA'S — ONE DECISION, THREE ANSWERS.

   The sentence on /funding/{symbol} and /tools/position-size had two branches: less room ("of room
   that is not there") or else "more room than the formula shows, because the tier caps the
   leverage". The audit of 16 September 2026 rendered /tools/position-size at 1×: both rooms were
   100.00%, the gap $0.00, nothing was capped, and the page printed "$0.00 more room than the formula
   shows, because the tier caps the leverage at 1×". Equal is a state, and "because the tier caps"
   is only true when it did.

   EQUAL MEANS EQUAL AT THE PRECISION PRINTED. The two percentages sit side by side at two decimals;
   a gap that rounds away there is not a gap a sentence may assert.
   ========================================================================================= */
export type RoomVerdict = "less" | "more-capped" | "more" | "same";
export function roomVerdict(r: LiquidationResult, printedPctDecimals = 2): RoomVerdict {
  const q = (x: number) => Math.round(x * 100 * 10 ** printedPctDecimals);
  if (q(r.distancePct) === q(r.naiveDistancePct)) return "same";
  if (r.distancePct < r.naiveDistancePct) return "less";
  return r.leverageClamped ? "more-capped" : "more";
}
