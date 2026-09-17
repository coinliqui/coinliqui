/* =========================================================================================
   SUPERLATIVES THAT CANNOT LIE ABOUT A TIE.

   THE DEFECT THIS EXISTS TO MAKE UNSPELLABLE. The front page said "Hyperliquid funding is most
   expensive on BTC at 10.95% a year". Measured on the live table at the time: 38 of the 50
   contracts held EXACTLY 10.95%, and the whole book carried 13 distinct values. 10.95% is
   0.0000125 an hour annualised — Hyperliquid's base rate, the rate a contract rests on when the
   market has no view about it. So the sentence took the reading that says NOTHING, called it a
   MAXIMUM, and picked the winner by whichever row the sort happened to leave first.
   BTC did not lead the sorted table; CHIP did. The claim was arithmetically defensible and
   editorially false, which is the worst kind this site can publish.

   IT WAS WRITTEN AS `const richest = byApr[0]`. That is the shape of the bug: sort, take the
   first, never ask whether the first is alone. Every page that wants an extreme is one line away
   from making it again, and a comment saying "mind the ties" is a comment, not a guarantee.

   SO THE ANSWER IS A TYPE, NOT A CAVEAT. extremeBy() returns a discriminated union. There is no
   `.item` on the union — reaching the winner requires narrowing to kind === "unique", and the
   tied case has no winner to reach for, only `items` and a count. `npm run typecheck` is inside
   the `check` gate, so a page that tries to name a single coin out of a tied set does not render
   wrong: it does not compile. That is the difference between a failure made impossible and a
   failure made unobservable.

   /funding already got this right in prose — "the rest sit exactly on it, which is a venue
   constant rather than a view about any of them" — while the home page, the surface whose entire
   job is stating conclusions, got it wrong. The honest framing is also the better line: "38 of 50
   sit exactly on the venue's base rate" is a fact no other funding site prints, and a maximum over a
   tied set is one every funding site prints wrongly.
   ========================================================================================= */

/**
 * An extreme over a set, with the tied case carried in the type rather than in a comment.
 *
 * `of` is how many finite candidates were considered, so a caller can say "of 50" without
 * recounting the input and reaching a different denominator than the one the extreme came from —
 * the disagreement this codebase has already shipped once between a numerator and a denominator
 * measured over different windows (see the flip-scale note in src/pages/index.astro).
 */
export type Extreme<T> =
  | { readonly kind: "unique"; readonly item: T; readonly value: number; readonly of: number }
  | { readonly kind: "tied"; readonly items: readonly T[]; readonly value: number; readonly of: number }
  | { readonly kind: "none" };

/**
 * The most, or the least, by a stated measure — reporting a tie as a tie.
 *
 * NON-FINITE IS NOT A CANDIDATE AND NOT A DENOMINATOR. A missing rate is not a small rate; it is
 * absence, and counting it would understate every share computed against `of`.
 *
 * THE TOLERANCE IS ABSOLUTE AND SMALL BY DEFAULT. Contracts resting on a venue constant arrive
 * from the same arithmetic on the same input and land on the same float, so exact equality would
 * in fact do; 1e-9 is here for the case where two venues publish the same rate through different
 * roundings. Callers comparing quantities that are only equal to a printed precision should pass
 * the precision they print at — a figure that says two things are equal must be using the same
 * definition of equal as the words beside it.
 */
export function extremeBy<T>(
  items: readonly T[],
  value: (item: T) => number,
  dir: "max" | "min" = "max",
  eps = 1e-9,
): Extreme<T> {
  let best = NaN;
  const finite: { item: T; v: number }[] = [];
  for (const item of items) {
    const v = value(item);
    if (!Number.isFinite(v)) continue;
    finite.push({ item, v });
    if (!Number.isFinite(best) || (dir === "max" ? v > best : v < best)) best = v;
  }
  if (!finite.length) return { kind: "none" };
  const at = finite.filter((f) => Math.abs(f.v - best) <= eps);
  return at.length === 1
    ? { kind: "unique", item: at[0].item, value: best, of: finite.length }
    : { kind: "tied", items: at.map((f) => f.item), value: best, of: finite.length };
}

/**
 * The value the most candidates share, and how many share it.
 *
 * THE COMPANION TO THE ABOVE, because on this site a tie is almost never an accident of two coins
 * meeting: it is a venue constant that most of the book is resting on. Knowing "the extreme is
 * tied" is only half an answer; the readable half is "38 of 50 sit on one number". /funding
 * computed this inline to detect Hyperliquid's base rate and the home page did not, which is
 * exactly how the two surfaces came to disagree about the same book at the same moment.
 *
 * Returns null when nothing is finite. A plurality of one is still a plurality — with 50 distinct
 * values this returns count 1, and a caller must decide that a mode of one says nothing. That is
 * the caller's judgement and not a reason for this to return null and be silently skipped.
 */
export interface Plurality {
  readonly value: number;
  readonly count: number;
  readonly of: number;
}

/**
 * WHERE ONE READING SITS INSIDE ITS OWN HISTORY — the context without which a magnitude cannot
 * be judged.
 *
 * "BTC funding is 10.95% a year" is a readout. Nobody outside the trade knows whether that is a
 * lot, and nobody inside it knows without remembering the last month. "Higher than it has been
 * for 84% of the last 30 days" is the same number made readable, and it costs no new data: the
 * contract pages already load the hourly funding series to draw the band under the candles.
 *
 * COMPARED SIGNED, NOT BY MAGNITUDE. A rate of −40% is not "a big funding rate", it is a deeply
 * negative one, and ranking by |value| would file it beside +40% as though the two were the same
 * reading. The sign is the direction of payment; collapsing it is the same error as colouring a
 * chart by distance from a reference and calling the hues a payment direction.
 *
 * Returns null on an empty history rather than a share of zero, because "0% of no readings" is a
 * sentence the caller must not be allowed to print.
 */
/* THE TIE IS PART OF THE ANSWER, AND THE FIRST VERSION DROPPED IT.
   It returned only `below` and `share = below / of`, and /funding/btc printed "That is above
   28.57% of the 714 hourly readings of the last 30 days" — true, and badly misleading, because the
   claim-vs-table audit on 16 September found BTC's rate EQUAL to about 480 of those 720 hours and
   higher than only 34. A reading held for two-thirds of the month was presented as sitting in its
   lower third. The same shape that made "most expensive on BTC" wrong on the home page: a ranking
   computed as if the values were distinct, over a set that is mostly one value.
   So all three counts come back and the caller has to say which one it means. */
export interface Standing {
  /** Past readings strictly below this one. */
  readonly below: number;
  /** Past readings equal to it, within the tolerance extremeBy uses. */
  readonly equal: number;
  /** Past readings strictly above it. */
  readonly above: number;
  /** below + equal + above. */
  readonly of: number;
}

export function standing(history: readonly number[], value: number, eps = 1e-9): Standing | null {
  if (!Number.isFinite(value)) return null;
  const finite = history.filter((v) => Number.isFinite(v));
  if (!finite.length) return null;
  let below = 0, equal = 0, above = 0;
  for (const v of finite) {
    if (Math.abs(v - value) <= eps) equal++;
    else if (v < value) below++;
    else above++;
  }
  return { below, equal, above, of: finite.length };
}

export function pluralityOf(values: readonly number[], eps = 1e-9): Plurality | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return null;
  let best: Plurality | null = null;
  for (const v of finite) {
    const count = finite.filter((w) => Math.abs(w - v) <= eps).length;
    if (!best || count > best.count) best = { value: v, count, of: finite.length };
  }
  return best;
}
