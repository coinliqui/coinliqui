/**
 * ONE SWEEP SLICE, FETCHED WITHOUT RUNNING INTO A RATE LIMIT HEAD FIRST.
 *
 * Measured 15 October 2026 in the sweep metas: Hyperliquid answered the worker 429. The daily
 * candle cycle at 03:22 UTC failed on all 55 contracts ("HYPE 429"), its retry at 06:52 failed
 * the same way, the hourly cycle at 05:32 skipped twelve, and /funding/wlfi served a 1h chart
 * 11.6 hours old — WLFI sat last in the retry list, so every retry spent the budget before
 * reaching it. The slice used to go out as one Promise.all of up to 24 candle requests, each
 * weighing about 38 of the 1,200 a minute Hyperliquid allows an IP, from Cloudflare egress
 * addresses that other people's workers share. When the budget was gone the whole burst hit
 * the wall together, and the retry was another burst.
 *
 * So a slice goes out in small groups, and the first 429 stops it: what was not tried is
 * returned as not done, lands on the sweep's skip list, and is retried after the existing
 * backoff instead of being thrown at a limit that has just said no.
 */
export interface SliceResult {
  done: string[];
  /** The first error, "SYMBOL: message", for the meta record. */
  firstErr: string;
  /** True when a 429 ended the slice early. */
  throttled: boolean;
}

export const SLICE_GROUP = 4;
const isThrottle = (msg: string) => /\b429\b/.test(msg);

export async function runSlice(
  slice: readonly string[],
  write: (s: string) => Promise<boolean>,
  group = SLICE_GROUP,
): Promise<SliceResult> {
  const done: string[] = [];
  let firstErr = "";
  let throttled = false;
  for (let i = 0; i < slice.length && !throttled; i += group) {
    const part = slice.slice(i, i + group);
    const oks = await Promise.all(part.map((s) =>
      write(s).catch((e) => {
        const msg = (e instanceof Error ? e.message : String(e)).slice(0, 90);
        if (!firstErr) firstErr = `${s}: ${msg}`;
        if (isThrottle(msg)) throttled = true;
        return false;
      })));
    oks.forEach((ok, k) => { if (ok) done.push(part[k]); });
  }
  return { done, firstErr, throttled };
}

/**
 * The retry list, rotated by tick, so a symbol at the end of it is not the one that loses
 * every time the budget runs out part-way. Holes (no data at all) keep their place in front.
 */
export function rotateRetries(holes: readonly string[], stale: readonly string[], tick: number): string[] {
  const rest = stale.filter((s) => !holes.includes(s));
  if (!rest.length) return [...holes];
  const k = ((tick % rest.length) + rest.length) % rest.length;
  return [...holes, ...rest.slice(k), ...rest.slice(0, k)];
}
