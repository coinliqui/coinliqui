import { getSnapshot } from "./hyperliquid.ts";
import { readFlips } from "./flips.ts";

/** One loader for the homepage and for every /ui/ surface variant, so a variant can
 *  never drift from the real page on data, copy or ordering. */
export async function loadHome(env: any) {
  const snap = await getSnapshot(env?.SNAPSHOT);
  const flips = await readFlips(env?.DB, 24);
  return {
    snap,
    flips,
    title: "Basis — perpetual funding, normalised",
    description:
      "Funding rates across Hyperliquid, Binance and Bybit annualised so they are comparable, open interest, and a tier-correct liquidation price calculator.",
  };
}
