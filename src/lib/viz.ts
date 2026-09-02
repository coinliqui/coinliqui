/* =========================================================================================
   SMALL SERVER-RENDERED FIGURES, FOR THE PAGES THAT HAD NONE.

   Twenty of this site's twenty-six templates carried no visual at all — measured, not guessed:
   only the funding, coins and liquidation contract pages draw anything, and everything else is
   type and tables. A reader who arrives from a chart-shaped site and lands on /open-interest or
   /tools/leverage sees a wall of correct numbers and nothing to look at.

   WHY THESE ARE NOT CHARTS. src/lib/chart.ts builds the big ones: a 1260-unit viewBox, an axis
   ladder, a crosshair, and below 760px a 1140px minimum width with horizontal scrolling, because
   220 candles cannot be read in 317 pixels. Nothing here needs that. These are figures a reader
   takes in at a glance and does not interrogate, so they fit the column at every width and never
   scroll. A 600-unit viewBox renders at 0.53 scale on a 375px phone and near 2x on a desktop
   column, which is a 4x range no single type size survives — so LABELS LIVE IN HTML BESIDE THE
   FIGURE, never inside the viewBox. Geometry scales; words do not.

   WHY THEY ARE NOT DECORATION. Every mark is a value the page already computes and already
   states in words nearby. That is the condition for adding weight to a page on this site at all:
   the picture is a second reading of a number the reader can check, not an illustration of a
   mood. It is also what keeps them useful to a machine — the figures carry <title> and the page
   keeps the sentence.

   COLOUR IS BORROWED, NEVER INVENTED. Signed quantities use var(--pays-l) and var(--pays-s),
   the funding pair, because that is what a sign means on this site; magnitudes use the neutral
   inks. Green and red are the candles' and appear nowhere here. Using CSS variables rather than
   hex means these follow the tokens if the tokens ever move.
   ========================================================================================= */
import { INK, esc, rect, line } from "./chart.ts";

/** Rounds a limit up to something a person would choose, so the axis ends on a real number. */
function niceLimit(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

const svgOpen = (w: number, h: number, title: string) =>
  `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}" preserveAspectRatio="xMidYMid meet">` +
  `<title>${esc(title)}</title>`;

export interface DistributionOpts {
  /** Signed data centres the axis on zero and colours each side. Unsigned starts at zero. */
  signed?: boolean;
  buckets?: number;
  w?: number;
  h?: number;
  /** Share of the data the axis must cover. The rest is clamped into the end buckets and counted. */
  cover?: number;
  /* WHICH COLOUR LANGUAGE THE SIGN SPEAKS, and it is not a preference. This site keeps two and
     they are not interchangeable: amber/cyan mean the direction of a FUNDING payment, green/red
     mean price up and down, and src/lib/chart.ts explains at length why funding is the one that
     moved. The first breadth figure on the home page drew a 24-hour PRICE change in amber and
     cyan — the same defect as the /coins legend that labelled price arrows with funding words,
     committed a day later by the person who had just fixed it. */
  tone?: "funding" | "price";
  title: string;
}

export interface DistributionResult {
  svg: string;
  lo: number;
  hi: number;
  /** Values that fell outside the axis and were clamped into its end buckets. */
  over: number;
  /** Bucket width, so a caption can say what "near zero" means. */
  step: number;
  /** Zero's position as a percentage of the width, or null when zero is an end of the axis. */
  zeroAt: number | null;
}

/**
 * WHERE A WHOLE COLUMN OF NUMBERS SITS, in one figure.
 *
 * A table of fifty funding rates answers "what is ETH paying" and not "what is the market
 * doing" — the second question needs every row at once, which is what a distribution is.
 *
 * NO TEXT IN THE SVG, AND THAT WAS LEARNED BY DRAWING IT. The first version put the axis labels
 * inside the viewBox at a size chosen for a 375px phone, where the figure renders at 0.53 scale.
 * On a 1180px desktop column the same figure renders at ~1.97, so "−100.00%" arrived at 35px —
 * twice the size of the heading above it. One size cannot serve a 2x scale range, so the labels
 * left the picture: the function returns its bounds and the page prints them as HTML, at whatever
 * size the stylesheet says. They are also selectable and extractable there, which they were not.
 *
 * THE AXIS IS A PERCENTILE, NOT THE MAXIMUM, for the same reason the liquidation map clips: one
 * contract at 81% against a median near 10% flattens every other bar to nothing, and a figure
 * where 46 of 50 values share two pixels of height is not a distribution, it is a spike. The
 * values beyond the axis are not dropped — they are clamped into the end buckets and counted, and
 * the caller is handed that count to say so.
 */
export function distribution(values: number[], opts: DistributionOpts): DistributionResult | null {
  const { signed = true, buckets, w = 600, h = 120, cover = 0.8, tone = "funding", title } = opts;
  const vals = values.filter((v) => Number.isFinite(v));
  if (!vals.length) return null;

  const padT = 8, padB = 8;
  const plotH = h - padT - padB;

  /* THE AXIS IS NOT SYMMETRIC, AND FORCING IT TO BE WASTED HALF THE PICTURE. Funding is almost
     entirely positive: on a normal day forty-six of fifty contracts pay longs, the median sits
     near 10% and the deepest negative is a few percent. A symmetric axis therefore spent its
     whole left half on four contracts and squeezed the mass into two buckets on the right — the
     shape a reader came for, flattened by a geometry chosen for tidiness. Each end is taken from
     its own percentile now and rounded outward independently, and zero is always included so the
     sign still has a place to change. */
  const asc = [...vals].sort((a, b) => a - b);
  const tail = (1 - cover) / 2;
  const pick = (q: number) => asc[Math.min(asc.length - 1, Math.max(0, Math.round((asc.length - 1) * q)))];
  /* ROUNDED TO A STEP, NOT TO THE NEXT ROUND LIMIT. niceLimit answers "what is the next tidy
     ceiling", which is the right question for one bound and the wrong one for two: a low end of
     -47% became -50% and an upper end of 21% became 20%, so a distribution whose median is 11%
     was drawn on an axis running to minus fifty. Both ends round outward to a multiple of one
     step now, and the step is chosen from the range they enclose. */
  const rawLo = signed ? Math.min(0, pick(tail)) : 0;
  const rawHi = Math.max(pick(1 - tail), rawLo);
  const step0 = niceLimit((rawHi - rawLo) / 6) || 1;
  let lo = Math.floor(rawLo / step0) * step0;
  const hi = Math.max(Math.ceil(rawHi / step0) * step0, lo + step0);
  /* A SIDE THAT EXISTS MUST HAVE SOMEWHERE TO BE DRAWN. With forty-six of fifty contracts
     positive, the tenth percentile is itself positive, so the axis started at zero and the four
     contracts paying shorts had no band at all — a figure showing no cyan under a caption saying
     "4 pay shorts to longs". A picture contradicting the sentence beneath it is the defect this
     whole site is built against, so when a sign is present the axis keeps one step for it and
     the caption reports what was clamped. */
  if (signed && vals.some((v) => v < 0)) lo = Math.min(lo, -step0);

  /* THE BUCKET COUNT COMES FROM THE SAMPLE, and twenty-one was a number I typed. Fifty values
     across twenty-one buckets filled six of them: the figure read as a picket fence with one
     tall post, which is what a histogram looks like when it is asked for more resolution than
     the data has. Square root of the count is the ordinary choice and gives seven or eight here,
     which is also close to what Sturges gives at this size.

     An odd count puts one bucket astride zero, so the centre bar is the values that are near
     flat rather than an edge between two colours. */
  const auto = Math.max(5, Math.min(15, Math.round(Math.sqrt(vals.length))));
  const want = buckets ?? auto;
  const n = signed && want % 2 === 0 ? want + 1 : want;
  const counts = new Array<number>(n).fill(0);
  const step = (hi - lo) / n;
  let over = 0;
  for (const v of vals) {
    if (v < lo || v > hi) over++;
    const i = Math.min(n - 1, Math.max(0, Math.floor((v - lo) / step)));
    counts[i]++;
  }
  const peak = Math.max(...counts, 1);

  const bw = w / n;
  let body = rect(0, padT, w, plotH, INK.well, `rx="6"`);
  for (let i = 0; i < n; i++) {
    if (!counts[i]) continue;
    const bh = Math.max(3, (counts[i] / peak) * plotH);
    const mid = lo + (i + 0.5) * step;
    /* The centre bucket straddles zero and belongs to neither side, so it stays neutral rather
       than being coloured by the sign of its midpoint, which is an artefact of the bucketing. */
    const fill = !signed
      ? INK.dim
      : Math.abs(mid) < step * 0.5
        ? INK.dim
        : mid > 0
          ? (tone === "price" ? INK.up : "var(--pays-l)")
          : (tone === "price" ? INK.down : "var(--pays-s)");
    body += rect(i * bw + 1, padT + plotH - bh, Math.max(1, bw - 2), bh, fill, `rx="2"`);
  }
  if (signed) {
    const zeroX = ((0 - lo) / (hi - lo)) * w;
    body += line(zeroX, padT - 2, zeroX, padT + plotH + 2, INK.zero, 1.5);
  }
  /* A REFERENCE TO MEASURE AGAINST. Bars in an empty well can be compared with each other and
     with nothing else; one gridline at half the tallest bucket turns "that one is big" into "that
     one is most of them". Drawn under nothing, in the gridline ink, so it never competes. */
  const halfY = padT + plotH / 2;
  body += line(0, halfY, w, halfY, INK.hair, 1);
  body += line(0, padT + plotH, w, padT + plotH, INK.hair, 1);

  /* Where zero falls as a share of the width, so a caller can put the label at the mark rather
     than in the middle of a row that is only sometimes symmetric. Null when zero is an end. */
  const zeroAt = signed && lo < 0 && hi > 0 ? ((0 - lo) / (hi - lo)) * 100 : null;
  return { svg: svgOpen(w, h, title) + body + "</svg>", lo, hi, over, step, zeroAt };
}

/* THE OTHER THREE FIGURES ARE NOT HERE, AND THAT IS THE POINT OF WHAT THIS FILE LEARNED.
   Ranked bars, a labelled scale and a split share were drafted as SVG builders alongside the
   distribution, and every one of them was mostly TEXT — a label, a value, a tick caption. Text
   inside a viewBox inherits the figure's scale, which ranges 4x between a phone and a desktop
   column, and it cannot be selected, searched or extracted. Drawn as HTML they cost no scaling
   problem, no accessibility work and almost no bytes, and they reuse `.magnitude`, the CSS bar
   this site has had in its tables all along.

   So they live as classes in src/layouts/Base.astro — `.bars` and `.scale` — and the pages
   compose them. Only the distribution stays here, because twenty-one bucket heights are geometry
   and nothing else. See the class comments there. */
