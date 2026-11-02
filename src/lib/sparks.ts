/* =========================================================================================
   THE FUNDING SHAPE PER CONTRACT, SMALL ENOUGH TO PUT IN A TABLE ROW.

   WHY IT EXISTS. /funding and /coins state a rate and nothing about how it got there. A rate is
   a level; a reader deciding whether 10.95% is worth anything needs to know whether the contract
   has sat there all week or arrived this morning, and the table could not say. The contract pages
   have carried that shape since the funding band was drawn under their candles — one contract at
   a time, thirteen per cent of one chart's height, on two templates.

   READ, NOT COMPUTED, and the measurement behind that. This is the same rule the flip feed
   follows. The obvious implementation is a grouped scan of funding_snapshot per render; measured
   against production D1, `WHERE venue='HlPerp' AND at >= ?` reads 813,101 rows whatever window it
   asks for, because neither index covers a venue filter and the planner takes the table. Naming
   the symbols instead lets idx_fs_sym do its job: the same aggregate over an explicit IN list of
   fifty symbols reads 201,599 rows for a seven-day backfill and 4,900 for one four-hour bucket.
   So the worker appends one bucket at a time and the page performs a single KV get.

   FOUR-HOUR BUCKETS OVER SEVEN DAYS, which is 42 points and 16,752 bytes for fifty contracts —
   measured on the real series, not estimated. Hourly would be 168 points and four times the
   payload for a mark that is twelve pixels tall.
   ========================================================================================= */

/** Milliseconds per bucket. A sparkline point is the mean funding APR over this window. */
export const SPARK_STEP_MS = 4 * 3_600_000;
/** Points kept per symbol: 42 four-hour buckets is seven days. */
export const SPARK_POINTS = 42;
/** KV key the worker writes and the pages read. */
export const SPARK_KEY = "spark:funding";

export interface SparkMap {
  /** Schema version, so a reader can refuse a shape it does not understand rather than guess. */
  v: 1;
  /** Bucket index of the newest point, in units of SPARK_STEP_MS since the epoch. */
  bucket: number;
  /** When the map was last written. */
  at: number;
  /** Annualised mean funding per bucket, oldest first. Series may be shorter than SPARK_POINTS. */
  series: Record<string, number[]>;
}

export type SparkResult =
  /** A map exists. `covered` is the longest series in it, in buckets. */
  | { status: "ready"; map: SparkMap; covered: number }
  /** No binding, no key, or a shape this version does not understand. Says nothing. */
  | { status: "absent" };

export interface KVLike {
  get(key: string, type: "json"): Promise<unknown>;
}

/** The bucket a moment falls in. Exported because the worker and the reader must agree on it. */
export const bucketOf = (ms: number) => Math.floor(ms / SPARK_STEP_MS);

/**
 * THE MAP, OR THE HONEST ABSENCE OF ONE.
 *
 * A missing key is not an empty series and must not render as a flat line at zero — that would be
 * a claim that funding did not move. Every caller branches on the status.
 */
export async function readSparks(kv: KVLike | undefined): Promise<SparkResult> {
  if (!kv) return { status: "absent" };
  try {
    const raw = (await kv.get(SPARK_KEY, "json")) as SparkMap | null;
    if (!raw || raw.v !== 1 || !raw.series || typeof raw.series !== "object") return { status: "absent" };
    const covered = Math.max(0, ...Object.values(raw.series).map((s) => (Array.isArray(s) ? s.length : 0)));
    if (!covered) return { status: "absent" };
    return { status: "ready", map: raw, covered };
  } catch {
    return { status: "absent" };
  }
}

/* =========================================================================================
   THE SHARED SCALE, WHICH IS THE WHOLE POINT OF DRAWING THESE AT ALL.

   Few's rule for sparklines in a table: pin the axis across every row, because per-row axes make
   a five per cent move and a fifty per cent move the same picture, and the reader is then
   comparing shapes that are not comparable. A column of independently-scaled sparklines is
   decoration that looks like a comparison, which is worse than no column.

   AND THE REASON IT CANNOT SIMPLY BE THE MAXIMUM. This book's funding is one value with a long
   tail: thirty-six contracts sit exactly on a venue constant while one prints −60% a year. Pinned
   to that maximum, forty-nine rows are a flat line through the middle and the column says nothing
   — the same failure the heat scale on this site already has a note about, where a percentile of
   the magnitude landed on the mass and lit every cell.

   SO THE DOMAIN IS A HIGH PERCENTILE OF |apr| ACROSS EVERY SERIES DRAWN, SYMMETRIC ABOUT ZERO,
   and what falls outside it is CLIPPED AND COUNTED rather than quietly flattened. Symmetric
   because the mark's meaning is which side of zero it is on; clipped points are marked in the
   drawing and the count is stated under the table, so a reader is told that a row is off the
   scale rather than shown a bar that stops for no reason.
   ========================================================================================= */
export interface SparkScale {
  /** Half-height of the shared domain: the drawn range is −max .. +max. */
  max: number;
  /** How many points across all series fall outside it. */
  clipped: number;
  /** How many points were considered. */
  of: number;
}

/**
 * `percentile` is of the ABSOLUTE value, over every point of every series shown together.
 *
 * Returns null when there is nothing finite to scale, which a caller must render as no column
 * rather than as an empty one.
 */
export function sparkScale(series: readonly (readonly number[])[], percentile = 0.96): SparkScale | null {
  const all: number[] = [];
  for (const s of series) for (const v of s) if (Number.isFinite(v)) all.push(Math.abs(v));
  if (!all.length) return null;
  all.sort((a, b) => a - b);
  const idx = Math.min(all.length - 1, Math.max(0, Math.floor(percentile * (all.length - 1))));
  /* A floor, so a book resting entirely on one value does not divide by zero and does not draw a
     full-height mark for a rounding difference. 1% APR is below anything a reader would act on. */
  const max = Math.max(all[idx], 0.01);
  return { max, clipped: all.filter((v) => v > max).length, of: all.length };
}

export interface SparkPoint {
  /** 0..100, left to right. */
  x: number;
  /** 0..100 from the TOP, so it can be used as an SVG y directly. 50 is the zero line. */
  y: number;
  /** True when the value fell outside the shared domain and was pinned to the edge. */
  clipped: boolean;
}

/**
 * Points for one row, on the shared scale. Geometry only — no colour decision here.
 *
 * The caller draws the zero line at y=50 itself; it is a property of the scale rather than of any
 * one row, and every row in the column must put it in the same place or the shared axis is a lie.
 */
export function sparkPoints(values: readonly number[], scale: SparkScale): SparkPoint[] {
  const n = values.length;
  if (!n) return [];
  return values.map((v, i) => {
    const finite = Number.isFinite(v) ? v : 0;
    const clamped = Math.max(-scale.max, Math.min(scale.max, finite));
    return {
      x: n === 1 ? 50 : (i / (n - 1)) * 100,
      y: 50 - (clamped / scale.max) * 50,
      clipped: Math.abs(finite) > scale.max,
    };
  });
}
