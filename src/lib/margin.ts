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
  /** Difference as a share of the correct price. */
  differencePct: number;
  /** Distance from entry to the correct liquidation, as a share of entry. */
  distancePct: number;
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

  const naive = naiveLiquidationPrice(entryPrice, leverage, side);

  return {
    liquidationPrice: correct,
    naivePrice: naive,
    differenceAbs: Math.abs(naive - correct),
    /* THE DENOMINATOR IS DERIVED, NOT SUPPLIED, AND IT REACHES ZERO. `correct` is computed four
       lines up, and at leverage 1 the factor (1 - 1/1) is exactly 0 in IEEE754, so both prices
       are 0 and this was 0/0 = NaN. Every input was validated; the value actually divided by was
       not. /tools/position-size accepts leverage=1 from its own dropdown, so the page whose job
       is to quantify the gap printed an em dash in the middle of the sentence saying so. */
    differencePct: correct > 0 ? Math.abs(naive - correct) / correct : 0,
    distancePct: entryPrice > 0 ? Math.abs(correct - entryPrice) / entryPrice : 0,
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
