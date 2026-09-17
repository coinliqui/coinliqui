/* =========================================================================================
   WHICH CONTRACTS GET A PAGE — STATED ONCE, BECAUSE IT WAS STATED FOUR WAYS.

   The rule has three parts: a contract must hold OI_NOTIONAL_FLOOR of open interest, it must rank
   inside the largest SYMBOL_CAP by open interest, and once published it keeps its page until it
   falls under OI_RETIRE_FLOOR. /404 said all three. /about and /data-sources said only the first —
   "a contract gets a page once it holds $5.00M of open interest" — and then, in the same
   paragraph, "58 of 234 clear that floor today; 50 are published", which by their own opening
   clause is eight contracts owed a page they do not have. The claim-vs-table audit on
   16 September confirmed it on both pages, three votes to none.

   So the sentence is built here from the constants that enforce the rule, and every page that
   states the rule renders it. A page that wants to say something different about coverage has to
   change the rule, not the prose.
   ========================================================================================= */
import { OI_NOTIONAL_FLOOR, OI_RETIRE_FLOOR, SYMBOL_CAP, SYMBOL_RETAIN_EXTRA } from "./hyperliquid.ts";
import { usd } from "./funding.ts";

export interface CoverageCounts {
  /** Contracts at or above the entry floor right now. */
  eligibleCount: number;
  /** Contracts the venue lists, delisted markets excluded. */
  universeCount: number;
  /** The published contracts, with their current open interest. */
  perps: readonly { oiNotional: number }[];
  /** Published contracts kept although outranked past the cap. */
  keptPastCap?: number;
}

/* THE RULE HAS TWO EXITS, AND THE FIRST VERSION OF THIS SENTENCE NAMED ONE.
   It said a contract "keeps it until open interest falls below $3.50M". A contract also lost its
   page when fifty larger ones outranked it — every retirement in the log on 16 September 2026 left
   that way, five of them while above the $5M entry floor — and the sentence gave no hint of it.
   The cap now has its own hysteresis (SYMBOL_RETAIN_EXTRA in src/lib/hyperliquid.ts), and this
   states both conditions and the bound. */
export const coverageRule = () =>
  `A contract gets a page when its perpetual holds ${usd(OI_NOTIONAL_FLOOR)} of open interest and ranks ` +
  `among the largest ${SYMBOL_CAP} by open interest. Once published it keeps the page while its open ` +
  `interest stays above ${usd(OI_RETIRE_FLOOR)}, even if larger contracts outrank it — up to ` +
  `${SYMBOL_RETAIN_EXTRA} pages beyond the ${SYMBOL_CAP}.`;

/**
 * Today's counts, with every gap between "clears the floor" and "has a page" accounted for.
 *
 * THE PUBLISHED SET IS NOT A SUBSET OF THE ELIGIBLE ONE, which is why this takes the contracts and
 * not two counts. The cap holds contracts above the floor back; the retirement floor keeps
 * contracts that slipped under it; the retained band keeps outranked ones. Each is counted
 * directly, because subtracting two counts would print a number that is none of them.
 */
export const coverageToday = (c: CoverageCounts) => {
  const published = c.perps.length;
  const belowFloor = c.perps.filter((p) => Number.isFinite(p.oiNotional) && p.oiNotional < OI_NOTIONAL_FLOOR).length;
  const heldBack = Math.max(0, c.eligibleCount - (published - belowFloor));
  const outranked = c.keptPastCap ?? 0;
  const parts: string[] = [];
  if (heldBack > 0) parts.push(`${heldBack} clear the floor but rank below the largest ${SYMBOL_CAP} and have no page yet`);
  if (belowFloor > 0) parts.push(`${belowFloor} ${belowFloor === 1 ? "keeps its page" : "keep their pages"} after slipping under the floor`);
  if (outranked > 0) parts.push(`${outranked} ${outranked === 1 ? "keeps its page" : "keep their pages"} although outranked`);
  return `${c.eligibleCount} of the ${c.universeCount} perpetuals the venue lists clear the ${usd(OI_NOTIONAL_FLOOR)} floor today and ` +
    `${published} have pages` + (parts.length ? ` — ${parts.join("; ")}.` : ".");
};

/* WHY A RETIRED CONTRACT LEFT, IN THE TERMS THE RULE ACTUALLY USES. The 410 page said every retired
   contract "fell below the $5.00M floor" — the ENTRY floor, which is not an exit at all. The two
   exits are the retirement floor and being outranked beyond the retained band; the page does not
   record which applied, so it states both rather than asserting one. */
export const retirementReason = () =>
  `either its open interest fell below ${usd(OI_RETIRE_FLOOR)}, or more than ${SYMBOL_RETAIN_EXTRA} larger ` +
  `contracts outranked it beyond the largest ${SYMBOL_CAP}`;
