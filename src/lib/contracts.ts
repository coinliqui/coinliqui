/* =========================================================================================
   WHAT EACH CONTRACT IS, IN WORDS — src/data/contracts.json.

   Every other sentence on a contract's pages is read from the market. These are not: they say
   what the asset underneath the contract is, which no feed this site reads can tell a reader,
   and which is different for every contract by its nature. Compiled 19 October 2026 from each
   project's own documentation and reference sources; the sources for every entry are kept in the
   data file beside the text, and an entry whose identity could not be confirmed is not shipped.

   Kept deliberately free of market figures: no price, capitalisation, supply or ranking appears
   in this text, so it cannot go stale the way a number does and does not need a clock.
   ========================================================================================= */
import CONTRACTS from "../data/contracts.json";

export interface About { name: string; about: string; sources: string[]; checked: string }
const TABLE = CONTRACTS as Record<string, About>;

/** The entry for a contract, by its venue symbol (case as the venue writes it), or null. */
export const aboutOf = (symbol: string): About | null => TABLE[symbol] ?? null;

/** The first sentence, for pages that point to the full entry rather than repeat it. */
export const firstSentence = (text: string) => {
  const m = text.match(/^.+?[.!?](?=\s+[A-Z]|$)/);
  return m ? m[0] : text;
};
