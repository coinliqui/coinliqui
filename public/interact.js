/* THE SHARED FACTS COME FROM ONE FILE, AND THE VERSION TRAVELS WITH THE IMPORT.
   public/shared.js holds every rule this script and the server both need — the funding sign
   convention, the carry arithmetic, the percentage format, the age ladder. They used to be
   implemented here as well, which is the shape that has produced five separate defects on this
   project. Now there is one implementation and no second copy to drift.

   `?v=` IS FORWARDED DELIBERATELY. Pages serves public/ with max-age=14400, so a bare
   `import "./shared.js"` would let a browser run today's interact.js against a four-hour-old
   shared.js — the precise failure scripts/gen-assets.mjs exists to prevent, one import deeper.
   gen-assets hashes this file over its own bytes PLUS shared.js, so the version in our own URL
   changes whenever either does, and passing it along keeps the two halves of one deploy
   together. */
const __v = new URL(import.meta.url).searchParams.get("v");
const { paysClass, paysLabel, carryCost, spreadOf, pct, changeWords, ageWords, nf, qty, compact: compactUsd, usd, visiblePanel } =
  await import("./shared.js" + (__v ? `?v=${__v}` : ""));

/* =========================================================================================
   Interaction layer. Vanilla, no dependencies.

   THE RULE THIS FILE OBEYS: it never produces a number. Every value it shows was already in
   the HTML at first byte — the crosshair reads the same point list the chart was drawn from,
   and the heatmap readout reads the fill of the rect under the cursor and inverts the ramp
   the server published. If this script fails to load the page loses responsiveness and not
   one figure.

   THE OTHER RULE: it writes presentation attributes, never classes, onto generated SVG.
   Astro scopes `<style>` selectors to a data-astro-cid attribute that markup injected with
   set:html does not carry, so a class on generated SVG silently resolves to nothing and the
   shape falls back to black. That has shipped here three times.

   FEEL: the crosshair and its pills move on the same frame as the cursor. A transition on
   position would make the pill trail the line, which reads as broken rather than smooth —
   only opacity is animated, on enter and exit.
   ========================================================================================= */
(() => {
  "use strict";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p2 = (n) => String(n).padStart(2, "0");
  /* nf, qty and compactUsd ALL CAME FROM public/shared.js NOW. They were three separate
     implementations of rules the server also implements, kept in step by a magnitude sweep in
     scripts/checks.mjs — and two of them had already drifted in production before that sweep
     existed. The sweep stays as a guard against a fourth copy appearing; it no longer has two
     implementations to compare, because there are not two. */
  const stamp = (t, withTime) => {
    const d = new Date(t);
    return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}` +
      (withTime ? `, ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}` : "");
  };

  /* ------------------------------------------------------------------------- tooltip */
  let tip, tipRaf = 0, tipNext = null;
  const tipEl = () => {
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "tip";
      tip.setAttribute("role", "status");
      document.body.appendChild(tip);
    }
    return tip;
  };
  const placeTip = () => {
    tipRaf = 0;
    if (!tipNext) return;
    const { html, cx, cy, touch, clear } = tipNext;
    const el = tipEl();
    /* Measuring is the expensive part, so it happens only when the content changed shape. */
    if (el._h !== html) { el.innerHTML = html; el._h = html; el._r = null; }
    el.setAttribute("data-on", "1");
    const r = el._r && el._r.height ? el._r : (el._r = el.getBoundingClientRect());
    const pad = 16;
    let x = cx + pad;
    if (x + r.width > innerWidth - 10) x = cx - r.width - pad;
    if (x < 10) x = 10;
    /* `clear` charts (the density field) put the card ABOVE or BELOW the cursor rather than
       centred on it, because centring lays it exactly over the band being read out. */
    let y = touch ? cy - r.height - 30
      : clear ? (cy < innerHeight / 2 ? cy + 26 : cy - r.height - 26)
      : cy - r.height / 2;
    if (y < 10) y = touch ? cy + 30 : 10;
    if (y + r.height > innerHeight - 10) y = innerHeight - r.height - 10;
    el.style.transform = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
  };
  const showTip = (html, cx, cy, touch, clear) => {
    tipNext = { html, cx, cy, touch, clear };
    if (!tipRaf) tipRaf = requestAnimationFrame(placeTip);
  };
  const hideTip = () => { tipNext = null; if (tip) tip.removeAttribute("data-on"); };

  /* ----------------------------------------------------------------------- crosshair */
  const setPill = (g, x, y, label, minX, maxX) => {
    if (!g) return;
    const r = g.firstElementChild, t = r.nextElementSibling;
    if (t.textContent !== label) t.textContent = label;
    const w = Math.max(52, label.length * 6.9 + 16);
    r.setAttribute("width", w.toFixed(1));
    t.setAttribute("x", (w / 2).toFixed(1));
    const px = minX === undefined ? x : Math.max(minX, Math.min(maxX - w, x - w / 2));
    g.setAttribute("transform", `translate(${px.toFixed(1)},${y.toFixed(1)})`);
    g.setAttribute("opacity", "1");
  };

  /* The live pill replaces the axis reading at that position, so the static ticks step back
     while it is on screen. Opacity only — nothing moves, nothing reflows. */
  const axisFade = (svg) => {
    const gs = [...svg.querySelectorAll('[data-ax]')];
    /* 0.22 measured 1.46:1 against the well — that is not stepping back, it is vanishing.
       0.45 is 2.39:1: clearly secondary, still readable. */
    return (on) => gs.forEach((g) => g.setAttribute("opacity", on ? "0.45" : "1"));
  };

  const wire = (svg, onMove) => {
    const vb = svg.viewBox.baseVal;
    let raf = 0, pend = null;
    const run = () => { raf = 0; if (pend) onMove(pend); };
    const move = (e) => {
      const r = svg.getBoundingClientRect();
      if (!r.width) return;
      pend = {
        vx: ((e.clientX - r.left) / r.width) * vb.width,
        vy: ((e.clientY - r.top) / r.height) * vb.height,
        cx: e.clientX, cy: e.clientY,
        touch: e.pointerType === "touch",
        target: e.target,
      };
      if (!raf) raf = requestAnimationFrame(run);
      /* No preventDefault on touch: `touch-action` decides whether the browser keeps the
         gesture, and stealing it here would make a scrollable chart un-scrollable. */
    };
    svg.addEventListener("pointermove", move, { passive: false });
    svg.addEventListener("pointerdown", move, { passive: false });
  };

  /* -------------------------------------------- price chart: crosshair + OHLCV tooltip
     RE-RUNNABLE, BECAUSE PANELS ARRIVE AFTER LOAD. This was an inline
     `document.querySelectorAll(...).forEach(...)` inside a one-shot IIFE, so it bound the chart
     the server rendered and nothing else. Every timeframe a reader switches to is fetched and
     inserted afterwards, and none of them ever got a crosshair or an OHLCV tooltip: the chart
     drew perfectly and did nothing on hover. No check could see it, because every one of them
     asks about markup rather than behaviour.
     Called once at load over the whole document, and again on each inserted panel. */
  const bindXhair = (root) => root.querySelectorAll("svg[data-xhair]").forEach((svg) => {
    if (svg.dataset.xhairBound) return;                  // idempotent: insertion re-scans
    /* THE PAYLOAD BELONGING TO THIS PANEL, not the first in the document with that id.
       Coin pages key the payload by timeframe while their panels are keyed timeframe.view, so
       the candle and line panels for one timeframe both carry `cpts-4h`. getElementById returns
       whichever came first, which is a different chart's point list. Looking inside the panel
       first cannot pick the wrong one; the document lookup stays for anything unpanelled. */
    const panel = svg.closest("[data-tfpanel]");
    const src = (panel && panel.querySelector(`script[type="application/json"][id="${svg.dataset.xhair}"]`))
      || document.getElementById(svg.dataset.xhair);
    let pts;
    try { pts = JSON.parse(src.textContent); } catch { return; }
    if (!pts || !pts.length) return;
    const dp = +(svg.dataset.dp || 0);
    const withTime = svg.dataset.intraday === "1";
    const axisX = +svg.dataset.axx;
    const [plotX, plotY, plotW, plotH] = svg.dataset.plot.split(",").map(Number);
    const [pLo, pHi] = svg.dataset.prange.split(",").map(Number);
    const slot = +(svg.dataset.slot || 4);
    const unit = svg.dataset.unit || "";
    const axisY = +(svg.dataset.taxisy || (0));
    const g = svg.querySelector('[data-xh="g"]');
    if (!g) return;
    const fade = axisFade(svg);
    const vl = g.querySelector('[data-xh="v"]'), hl = g.querySelector('[data-xh="h"]');
    const dot = g.querySelector('[data-xh="dot"]');
    const py = g.querySelector('[data-xh="py"]'), tx = g.querySelector('[data-xh="tx"]');
    // Column wash, behind the crosshair lines so candles stay legible through it.
    const col = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    col.setAttribute("fill", "#8ab4f8");
    col.setAttribute("opacity", ".13");
    col.setAttribute("y", plotY);
    col.setAttribute("height", plotH);
    g.insertBefore(col, g.firstChild);

    wire(svg, ({ vx, vy, cx, cy, touch }) => {
      let lo = 0, hi = pts.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (pts[m][0] < vx) lo = m + 1; else hi = m; }
      if (lo > 0 && Math.abs(pts[lo - 1][0] - vx) < Math.abs(pts[lo][0] - vx)) lo--;
      const a = pts[lo];
      g.setAttribute("opacity", "1");
      fade(true);
      vl.setAttribute("x1", a[0]); vl.setAttribute("x2", a[0]);
      const cwv = Math.max(5, slot);   // a 1px wash is not a selection anyone can see
      col.setAttribute("x", (a[0] - cwv / 2).toFixed(2));
      col.setAttribute("width", cwv.toFixed(2));
      dot.setAttribute("cx", a[0]); dot.setAttribute("cy", a[8]);
      /* Outside the price panel there is no price to report. Clamping produced a confident
         number at the top of the plot while the cursor was over the volume histogram. */
      const inPlot = vy >= plotY && vy <= plotY + plotH;
      const y = Math.max(plotY, Math.min(plotY + plotH, vy));
      hl.setAttribute("y1", y); hl.setAttribute("y2", y);
      hl.setAttribute("opacity", inPlot ? ".62" : "0");
      const price = pHi - ((y - plotY) / plotH) * (pHi - pLo);
      if (inPlot) setPill(py, axisX + 5, y - 10, "$" + nf(price, dp));
      else py.setAttribute("opacity", "0");
      setPill(tx, a[0], axisY || plotY + plotH + 5, stamp(a[1], withTime), plotX, axisX);

      const up = a[5] >= a[2], apr = a[7];
      showTip(
        `<div class="tip__h">${stamp(a[1], withTime)}${withTime ? " UTC" : ""}</div>` +
        `<div class="tip__g">` +
        `<span>Open</span><b>$${nf(a[2], dp)}</b>` +
        `<span>High</span><b>$${nf(a[3], dp)}</b>` +
        `<span>Low</span><b>$${nf(a[4], dp)}</b>` +
        `<span>Close</span><b>$${nf(a[5], dp)}</b>` +
        `<span>Volume</span><b>${qty(a[6])} ${unit}</b>` +
        (Number.isFinite(apr) ? `<span>Funding</span><b class="${paysClass(apr)}">${pct(apr)} APR</b>` : "") +
        `</div><div class="tip__f">${up ? "▲" : "▼"} ${nf(Math.abs((a[5] - a[2]) / (a[2] || 1)) * 100, 2)}% on the bar` +
        (Number.isFinite(apr) ? ` · ${paysLabel(apr)}` : "") + `</div>`,
        cx, cy, touch,
      );
    });
    const off = () => { g.setAttribute("opacity", "0"); fade(false); hideTip(); };
    svg.addEventListener("pointerleave", off);
    svg.addEventListener("pointercancel", off);
    /* STAMPED ON SUCCESS, NOT ON ATTEMPT. Set at the top, it marked a chart "bound" even when
       one of the early returns above fired — a missing payload, an empty point list, no
       crosshair group — and no later rescan would ever try again. The flag has to mean what it
       says, or it is one more claim that outlives what it described. */
    svg.dataset.xhairBound = "1";
  });
  bindXhair(document);

  /* -------------------------------------------------- heatmap: crosshair + band readout */
  document.querySelectorAll("svg[data-heat]").forEach((svg) => {
    const ramp = svg.dataset.ramp.split(",");
    const scale = +svg.dataset.scale, gamma = +svg.dataset.gamma;
    const axisX = +svg.dataset.axx;
    const [plotX, plotY, plotW, plotH] = svg.dataset.plot.split(",").map(Number);
    const [pLo, pHi] = svg.dataset.prange.split(",").map(Number);
    const [t0, stepMs] = svg.dataset.taxis.split(",").map(Number);
    const axisY = +(svg.dataset.taxisy || 0);
    const rows = +svg.dataset.rows, cols = +svg.dataset.cols;
    const g = svg.querySelector('[data-xh="g"]');
    if (!g) return;
    const fade = axisFade(svg);
    const vl = g.querySelector('[data-xh="v"]'), hl = g.querySelector('[data-xh="h"]');
    const py = g.querySelector('[data-xh="py"]'), tx = g.querySelector('[data-xh="tx"]');
    /* Inverting the transfer gives the value BOUNDS of the ramp step under the cursor. The
       readout is a band, not a point, because a band is genuinely what the colour encodes. */
    const bound = (i) => scale * Math.pow(Math.max(0, i) / (ramp.length - 1), 1 / gamma);

    wire(svg, ({ vx, vy, cx, cy, touch, target }) => {
      const x = Math.max(plotX, Math.min(plotX + plotW, vx));
      const y = Math.max(plotY, Math.min(plotY + plotH, vy));
      g.setAttribute("opacity", "1");
      fade(true);
      vl.setAttribute("x1", x); vl.setAttribute("x2", x);
      hl.setAttribute("y1", y); hl.setAttribute("y2", y);
      const price = pHi - ((y - plotY) / plotH) * (pHi - pLo);
      const ci = Math.max(0, Math.min(cols - 1, Math.floor(((x - plotX) / plotW) * cols)));
      const ri = Math.max(0, Math.min(rows - 1, Math.floor(((y - plotY) / plotH) * rows)));
      const bandLo = pHi - ((ri + 1) / rows) * (pHi - pLo);
      const bandHi = pHi - (ri / rows) * (pHi - pLo);
      setPill(py, axisX + 5, y - 10, "$" + nf(price, 0));
      setPill(tx, x, axisY || plotY + plotH + 5, stamp(t0 + ci * stepMs, true), plotX, axisX);

      const fill = target && target.getAttribute ? target.getAttribute("fill") : null;
      const i = fill ? ramp.indexOf(fill) : -1;
      /* THE TOP STEP IS OPEN-ENDED and must be read that way. src/lib/chart.ts:98 clamps the
         forward transfer with Math.min(1, …), so everything at or above `scale` lands in the
         last ramp index. Inverting that index as if it were a closed band printed
         "$29.65M – $30.41M" over the brightest cell while the legend beside it said "≥ $29.6M"
         and the caption above said the most crowded level holds $41.2M — three numbers for one
         cell, the tooltip understating it by about a third. bound(i + 0.5) also extrapolates
         past `scale`, so its upper edge was not correct under any reading.

         A colour that is not in the ramp is not a bucket at all: the white scar ticks are drawn
         before the pointer-events:none group, so they are hoverable, and reporting "nothing
         standing here" over a mark that means price traded THROUGH a standing level is the
         exact opposite of what it shows. They now decline to answer instead. */
      const top = ramp.length - 1;
      const band =
        i === top ? `≥ ${compactUsd(bound(top - 0.5))}`
        : i > 0 ? `${compactUsd(bound(i - 0.5))} – ${compactUsd(bound(i + 0.5))}`
        : null;
      const isCell = i >= 0;
      showTip(
        `<div class="tip__h">$${nf(bandLo, 0)} – $${nf(bandHi, 0)}</div>` +
        `<div class="tip__g">` +
        (band
          ? `<span>Modelled</span><b>${band}</b>`
          : isCell
            ? `<span>Modelled</span><b class="dim">nothing standing here</b>`
            : `<span>Modelled</span><b class="dim">— hover a shaded cell</b>`) +
        `<span>At</span><b>${stamp(t0 + ci * stepMs, true)} UTC</b></div>` +
        `<div class="tip__f">Model output, not an observed liquidation</div>`,
        cx, cy, touch, true,
      );
    });
    const off = () => { g.setAttribute("opacity", "0"); fade(false); hideTip(); };
    svg.addEventListener("pointerleave", off);
    svg.addEventListener("pointercancel", off);
  });

  /* --------------------------------------------------------- mobile: open at the right
     A scroll container starts at scrollLeft 0, which on a chart means the OLDEST bars with
     the price axis off screen entirely. The interesting end is the right one. */
  /* AND IT HAS TO RUN AGAIN WHEN A PANEL IS REVEALED, not only at load and on resize.
     A fetched panel is inserted with `data-on` removed, so it is display:none: scrollWidth and
     clientWidth are both 0 and it cannot be positioned yet. Nothing called this after apply()
     revealed it, so on a phone every timeframe a reader switched to opened at scrollLeft 0 —
     the oldest bars, with the price axis, the live price pill and the newest candles all off
     screen to the right. Measured on /funding/ondo at 375px: the server-rendered panel sits at
     scrollLeft 823 of 823, the fetched one at 0. The chart is there, and the reader is looking
     at the wrong quarter of it, which reads as "switching does not work".
     Rotating the phone fixed it, because resize fires — which is exactly what would make it
     feel intermittent. The `_sx` latch still means a panel is positioned once and a reader's
     own scrolling is never yanked back. */
  const openRight = (root) => (root || document).querySelectorAll(".chart").forEach((c) => {
    if (c.scrollWidth > c.clientWidth + 4 && !c._sx) { c.scrollLeft = c.scrollWidth; c._sx = 1; }
  });
  openRight();
  addEventListener("resize", () => openRight(), { passive: true });

  /* ------------------------------------------------- simple tooltips on marked shapes */
  document.querySelectorAll("svg[data-tips]").forEach((svg) => {
    svg.addEventListener("pointermove", (e) => {
      const host = e.target.closest("[data-tip]");
      if (!host) { hideTip(); return; }
      showTip(host.dataset.tip, e.clientX, e.clientY, e.pointerType === "touch");
      if (e.pointerType === "touch") e.preventDefault();
    }, { passive: false });
    svg.addEventListener("pointerleave", hideTip);
  });

  /* ------------------------------------------------------------- timeframe switcher */
  /* ------------------------------------------------- timeframe + chart-style groups
     TWO AXES, ONE MECHANISM. A contract page switches timeframe only; a coin page switches
     timeframe and candle-versus-line. Both are GET submit buttons so a crawler sees one URL
     and a reader without JavaScript still gets the panel from the server. With JavaScript the
     click is intercepted and the already-rendered panel is revealed, which is why every
     combination is in the page at first byte rather than fetched.

     A panel is keyed `tf` when there is one axis and `tf.mode` when there are two. The hidden
     carry inputs keep the OTHER axis when a no-JS submit happens, so pressing "Line" cannot
     silently reset the timeframe to the default. */
  document.querySelectorAll("[data-tfgroup]").forEach((group) => {
    const id = group.dataset.tfgroup;
    let panels = document.querySelectorAll(`[data-tfpanel][data-group="${id}"]`);
    const stats = document.querySelectorAll(`[data-tfstat][data-group="${id}"]`);
    const table = document.querySelector(`[data-tftable][data-group="${id}"]`);
    const pressed = (sel) => group.querySelector(`[${sel}][aria-pressed="true"]`);
    const hasModes = Boolean(group.querySelector("[data-mode]"));
    let tf = pressed("data-tf")?.dataset.tf ?? null;
    let mode = pressed("data-mode")?.dataset.mode ?? null;

    /* Rebuilt from the SAME pts-* JSON the chart was drawn from, which is server-rendered into
       the page. Switching timeframe used to swap the chart and leave the table showing the
       previous one — both individually true, a contradiction on one screen. */
    const syncTable = (key, label) => {
      if (!table) return;
      const src = document.getElementById(`pts-${key}`);
      const body = table.querySelector("tbody");
      if (!src || !body) return;
      let pts;
      try { pts = JSON.parse(src.textContent).slice(-200); } catch { return; }
      const dp = +table.dataset.dp || 2;
      const money = (v) => "$" + nf(v, dp);
      body.innerHTML = pts.map((q) => {
        const f = Number.isFinite(q[7]);
        return "<tr>" +
          `<td>${new Date(q[1]).toISOString().slice(0, 16).replace("T", " ")}</td>` +
          `<td class="num">${money(q[2])}</td><td class="num">${money(q[3])}</td>` +
          `<td class="num">${money(q[4])}</td><td class="num">${money(q[5])}</td>` +
          `<td class="num">${qty(q[6])}</td>` +
          `<td class="num ${f ? paysClass(q[7]) : "faint"}">${f ? pct(q[7]) : "—"}</td>` +
          "</tr>";
      }).join("");
      table.querySelector("[data-tflabel]").textContent = label;
      table.querySelector("[data-tfcount]").textContent = String(pts.length);
    };

    /* PANELS ARE FETCHED, NOT PRE-RENDERED.
       Only the active timeframe is in the document; the rest are pulled from the same page with
       ?tf= — the identical server render the no-JS path uses, so there is one source of truth
       and no second endpoint to drift. Fetched panels are cached in the DOM after first use, so
       a timeframe is fetched at most once per page view, and prefetched on hover/focus so the
       request is usually finished before the click lands. */
    const inflight = new Map();
    const panelUrl = (t, m) => {
      const u = new URL(location.pathname, location.origin);
      u.searchParams.set("tf", t);
      if (hasModes && m) u.searchParams.set("view", m);
      return u.toString();
    };
    const have = (key) => document.querySelector(`[data-tfpanel="${key}"][data-group="${id}"]`);
    const fetchPanel = (t, m) => {
      const key = hasModes && m ? `${t}.${m}` : t;
      if (have(key)) return Promise.resolve(key);
      if (inflight.has(key)) return inflight.get(key);
      const job = fetch(panelUrl(t, m), { headers: { accept: "text/html" } })
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
        .then((html) => {
          const doc = new DOMParser().parseFromString(html, "text/html");
          const incoming = doc.querySelector(`[data-tfpanel][data-group="${id}"]`);
          if (!incoming) throw new Error("no panel in response");
          /* NEXT TO ITS SIBLINGS, NOT AT THE END OF THE PAGE.
             This was `document.querySelector('[data-tfpanel]...').parentNode.appendChild(...)`,
             and that parent is <main>: the element that holds the whole page. So a fetched panel
             was appended as the LAST child of main — after the legend, the funding cards, the
             margin tiers, the related links and the FOOTER.
             Switching a timeframe therefore hid the chart where the reader was looking and
             revealed the new one about 1,400px further down, below the end of the page. Measured
             on /funding/ondo at 1280x900: the server-rendered 1d panel is child 5 at y=442, the
             fetched 4h panel was child 20 at y=1821, with the page scrolled to the top. The
             chart does not fail to arrive — it arrives somewhere nobody is looking.
             Every check missed it for the same reason: they asked whether a panel was visible,
             had a size and held bars, and it was, did and does. None asked WHERE.
             Inserting after the last panel of the group keeps them contiguous and keeps the live
             one exactly where the server put it. */
          /* REQUIRED TO EXIST. A document-wide query trusts document ORDER the way the bug
             this replaced trusted .parentNode; if `last` were ever undefined the TypeError
             would surface as a full page navigation on every press, via the catch below. */
          const siblings = document.querySelectorAll(`[data-tfpanel][data-group="${id}"]`);
          const last = siblings[siblings.length - 1];
          if (!last) throw new Error("no panel to insert beside");
          incoming.removeAttribute("data-on");
          const added = document.importNode(incoming, true);
          last.insertAdjacentElement("afterend", added);
          /* A CHART THAT ARRIVED AFTER LOAD STILL HAS TO BEHAVE LIKE ONE. The crosshair binder
             ran once over the document, so every fetched panel drew correctly and did nothing
             on hover. Bound here, on the panel that just arrived. */
          bindXhair(added);
          /* Stats come from the fetched document, PAIRED BY NAME rather than by ordinal.
             This walked both NodeLists with the same index, which assumes the i-th figure in the
             live document is the i-th in the fetched one. The live document is the one this
             script mutates by inserting panels; the fetched one is a virgin server render. They
             agreed only because no [data-tfstat] happened to sit inside a [data-tfpanel] — put
             a per-timeframe figure in its own panel, the obvious place for it, and after one
             fetch every stat from the second panel on is paired with a different figure. Period
             low in the period-high slot: silently wrong numbers, no exception, nothing a
             did-it-render check can see.
             Each stat now carries its own name, so the pairing cannot depend on document order
             at all. Falls back to the ordinal only if a template forgets to name one, which
             `unnamed` below makes visible rather than silent. */
          const from = new Map();
          let unnamed = 0;
          doc.querySelectorAll(`[data-tfstat][data-group="${id}"]`).forEach((el, i) => {
            const k = el.dataset.tfstat || `#${i}`;
            if (!el.dataset.tfstat) unnamed++;
            from.set(k, el.textContent);
          });
          document.querySelectorAll(`[data-tfstat][data-group="${id}"]`).forEach((el, i) => {
            const k = el.dataset.tfstat || `#${i}`;
            if (from.has(k)) el.dataset["v" + String(t).replace(/\W/g, "")] = from.get(k);
          });
          if (unnamed) console.warn(`[coinliqui] ${unnamed} unnamed data-tfstat in group ${id} — paired by position, which document order can break`);
          return key;
        })
        .catch((e) => { inflight.delete(key); throw e; });
      inflight.set(key, job);
      return job;
    };

    /* WHICH CLICK IS STILL THE READER'S. Every click starts a fetch and every fetch calls
       apply() when it lands, but `tf` and `mode` are shared by the whole group — so a fetch
       that resolves after a LATER click applied the later value. See the guard on `seq` below;
       this counter is what the two of them agree on. */
    let seq = 0;

    const apply = (label) => {
      const key = hasModes && mode ? `${tf}.${mode}` : tf;
      panels = document.querySelectorAll(`[data-tfpanel][data-group="${id}"]`);
      /* NEVER LEAVE THE READER WITH NO CHART.
         This was `panels.forEach(p => p.toggleAttribute("data-on", p.dataset.tfpanel === key))`,
         which hides everything when no panel matches — and no panel matches whenever apply()
         runs for a timeframe whose fetch has not landed yet. Measured on the live site:
         click 4H then 1W in the same task on a cold page and the 4H response calls apply() with
         `tf` already advanced to "1w", so every panel is hidden until the 1W response arrives.
         Blank for 13ms when both are fast; 4 SECONDS with 1.5s of latency on the second.
         That is the reported symptom exactly — the chart disappears rather than the new one
         appearing — and a serial sweep cannot produce it, because it waits for each panel
         before clicking the next.
         The guard on `seq` below is the fix for the cause. This is the invariant: a switch may
         show the wrong chart for a moment, never no chart. Keeping the outgoing panel up is
         also the better thing to look at while the next one loads. */
      const shownNow = [...panels].find((p) => p.hasAttribute("data-on"))?.dataset.tfpanel ?? null;
      const show = visiblePanel([...panels].map((p) => p.dataset.tfpanel), key, shownNow);
      if (show) {
        panels.forEach((p) => p.toggleAttribute("data-on", p.dataset.tfpanel === show));
        /* Positioned only now: until data-on is set the panel is display:none and has no
           measurable width to scroll. */
        openRight();
      }
      group.querySelectorAll("[data-tf]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tf === tf)));
      group.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
      const carryTf = group.querySelector('[data-tfcarry="tf"]');
      const carryView = group.querySelector('[data-tfcarry="view"]');
      if (carryTf) carryTf.value = tf;
      if (carryView && mode) carryView.value = mode;
      stats.forEach((s) => {
        const next = s.dataset["v" + String(tf).replace(/\W/g, "")];
        if (next === undefined || s.textContent === next) return;
        if (reduced) { s.textContent = next; return; }
        s.setAttribute("data-swap", "1");
        setTimeout(() => { s.textContent = next; s.removeAttribute("data-swap"); }, 110);
      });
      if (label) syncTable(tf, label);
      /* THE READER'S CHOICE BELONGS IN THE URL, and this line used to delete it.
         It wrote location.pathname, so picking 4H left the address bar saying /coins/bitcoin.
         The timeframe could then not be reloaded, bookmarked, shared or recovered with Back —
         every one of those puts the reader back on the default. "I set it to 4H and it keeps
         coming back to 1D" is the same page working exactly as written.
         Nothing was gained by it. <link rel="canonical"> on every one of these pages already
         points at the bare path (src/layouts/Base.astro), which is what tells a crawler that
         ?tf= is not a separate page — a job an address bar was never doing. And a shared
         ?tf=4h URL renders on the server for all sixty pages and both views, so the link works
         for whoever receives it, script or no script.
         The whole URL is carried rather than rebuilt, so a campaign parameter or a fragment
         someone arrived with is not quietly dropped along the way. */
      try {
        const u = new URL(location.href);
        u.searchParams.set("tf", tf);
        if (hasModes && mode) u.searchParams.set("view", mode);
        history.replaceState(null, "", u.pathname + u.search + u.hash);
      } catch {}
    };

    group.querySelectorAll("[data-tf], [data-mode]").forEach((btn) => {
      /* PREFETCH ON INTENT. A pointer landing on a button, or a keyboard focusing it, is a
         reliable signal the click is coming — and it arrives tens to hundreds of milliseconds
         early, which is the whole budget a fetch needs. Failures are swallowed on purpose: a
         prefetch that does not arrive must never surface, because the click will fetch again
         and the form submit is still there underneath as the honest fallback. */
      const warm = () => {
        const t = btn.dataset.tf || tf, m = btn.dataset.mode || mode;
        if (t) fetchPanel(t, m).catch(() => {});
      };
      btn.addEventListener("pointerenter", warm);
      btn.addEventListener("focus", warm);

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        if (btn.dataset.tf) tf = btn.dataset.tf; else mode = btn.dataset.mode;
        const label = btn.dataset.tf ? btn.textContent.trim() : null;
        /* ONLY THE LATEST CLICK MAY APPLY. Two clicks in flight means two fetches, and the
           first to land is usually the first requested — which is no longer what the reader
           asked for. Applying it toggled panels against a `tf` that had already moved on.
           Discarding the stale response is the fix; the invariant in apply() is the net. */
        const mine = ++seq;
        /* ACKNOWLEDGE THE PRESS BEFORE THE PANEL ARRIVES. aria-pressed was only moved inside
           apply(), which runs after the fetch resolves — so on anything slower than a warm
           prefetch the button stayed unpressed and the old chart stayed on screen, with no
           indication that anything had been asked for. A panel is 35-90KB; on a phone that is
           long enough to read as "the button does nothing". The state is corrected by apply()
           either way, and the fetch failure path navigates, so an optimistic press cannot end
           up lying about what is shown. */
        const sel = btn.dataset.tf ? "[data-tf]" : "[data-mode]";
        group.querySelectorAll(sel).forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
        group.setAttribute("aria-busy", "true");
        /* If the panel is already here — prefetched, or seen before — this resolves in the same
           task and the switch is indistinguishable from the old class toggle. */
        fetchPanel(tf, mode).then(() => {
          if (mine !== seq) return;                 // a later click owns the group now
          group.removeAttribute("aria-busy");
          apply(label);
        }).catch(() => {
          if (mine !== seq) return;
          group.removeAttribute("aria-busy");
          /* The server render is the fallback that always works: navigate the way the form
             would have, so a failed fetch degrades to the no-JS path rather than to nothing. */
          location.href = panelUrl(tf, mode);
        });
      });
    });
  });

  /* --------------------------------------------------------- live freshness ticker */
  /* Every element carrying data-fresh ages itself, not just the topbar pill: a page can now
     hold several clocks — a one-minute quote beside a five-minute snapshot — and one shared
     timestamp would be true of some figures and wrong about the rest. Each re-reads its own
     attribute every tick, because the live layer rewrites them when it pulls. */
  const clocks = [...document.querySelectorAll("[data-fresh]")];
  if (clocks.length) {
    /* The ladder is ageWords() in public/shared.js — the same function the server renders with.
       It was a second implementation here, and the split only appeared when the data was old. */
    const say = ageWords;
    const tick = () => {
      for (const el of clocks) {
        const m = Math.max(0, Math.round((Date.now() - +el.dataset.fresh) / 60000));
        const next = say(m);
        if (el.textContent !== next) el.textContent = next;
      }
    };
    tick();
    setInterval(tick, 20000);
  }

  const liveEls = [...document.querySelectorAll("[data-spot]")];
  if (liveEls.length) {
    const dpOf = (el) => +(el.dataset.dp || 2);
    const money = (v, dp) => "$" + nf(v, dp);
    let last = {};

    /* THE SPOT FREEZE MACHINERY IS GONE WITH THE SPOT BRANCHES. It suppressed `mark` on any page
       carrying a spot-derived cell, so that a live mark could not sit beside a pinned spot with a
       basis between them. That was right while the payload could carry spot. It became a trap the
       moment /coins was re-based onto the perpetual and kept the old attribute names: every coin
       page still declared spot cells, nothing served spot, so the guard fired permanently and
       froze the whole overlay — price, change, mark and the page clock — on the ten pages it was
       supposed to protect. No page emits a spot kind now, and none can: they are not handled. */

    /* THE CHART'S PRICE MARKER MOVES TOO.
       It used to show the last CANDLE close — up to two hours old, because the candle feed is
       on a two-hour gate while the quote is on a one-minute cron. On BTC that put $62,725 on
       the chart under a hero reading $62,977.52: two prices for one asset on one screen, both
       looking current. The bars are closed and stay put; the marker is what "now" means on a
       price chart, so it is what has to follow. */
    /* COLLECTED PER PULL, NOT ONCE. This was `const marks = [...]` evaluated at load, so the
       live price line and pill on any panel fetched later were never in the list — the marker
       froze at whatever the server drew when that panel was requested, on a page whose whole
       promise is a mark that moves. A handful of svgs per pull is nothing to re-query. */
    const collectMarks = () => [...document.querySelectorAll("svg[data-xhair][data-plot]")]
      .map((svg) => {
        const g = {
          sym: svg.dataset.unit,
          feed: svg.dataset.feed || "spot",
          dp: +(svg.dataset.dp || 0),
          line: svg.querySelector('[data-live="line"]'),
          pill: svg.querySelector('[data-live="pill"]'),
          txt: svg.querySelector('[data-live="txt"]'),
        };
        const [, priceY, , priceH] = svg.dataset.plot.split(",").map(Number);
        const [lo, hi] = svg.dataset.prange.split(",").map(Number);
        g.yOf = (v) => Math.max(priceY, Math.min(priceY + priceH, priceY + ((hi - v) / (hi - lo)) * priceH));
        return g.line && g.pill && g.txt ? g : null;
      })
      .filter(Boolean);
    const moveMark = (sym, feed, v) => {
      /* Re-queried on every call rather than closed over: a panel fetched since the last pull
         is otherwise invisible to the live marker forever. */
      for (const m of collectMarks()) {
        if (m.sym !== sym || m.feed !== feed || !Number.isFinite(v)) continue;
        const y = m.yOf(v);
        m.line.setAttribute("y1", y.toFixed(1));
        m.line.setAttribute("y2", y.toFixed(1));
        m.pill.setAttribute("y", (y - 10).toFixed(1));
        m.txt.setAttribute("y", (y + 4).toFixed(1));
        m.txt.textContent = "$" + (m.dp ? v.toFixed(m.dp) : Math.round(v).toLocaleString("en-US"));
      }
    };

    const paint = (d) => {
      for (const el of liveEls) {
        const sym = el.dataset.sym;
        const mk = d.mark[sym];
        const kind = el.dataset.spot;
        let next = null;
        if (kind === "mark" && Number.isFinite(mk)) next = money(mk, dpOf(el));
        else if (kind === "apr") {
          const a = d.apr[sym] && d.apr[sym][el.dataset.venue];
          if (Number.isFinite(a)) {
            next = pct(a);
            /* Colour on this site means the DIRECTION OF A FUNDING PAYMENT and nothing else,
               so when the sign flips the class has to flip with the number. Leaving it would
               print a positive rate in the colour that means shorts are paying. */
            el.classList.toggle("pays-l", paysClass(a) === "pays-l");
            el.classList.toggle("pays-s", paysClass(a) === "pays-s");
          }
        } else if (kind === "carry" || kind === "dir" || kind === "spread") {
          /* EVERYTHING DERIVED FROM A REPAINTED RATE MUST BE REPAINTED WITH IT.
             The overlay used to update the APR cell alone, so the weekly cost, the direction
             words and the spread beside it kept the value the server rendered five minutes
             earlier. Measured live on /coins/bitcoin: one row read 0.90% APR next to $2.30,
             and $2.30 is the weekly cost of the 1.20% that cell held before the pull. Adjacent
             cells of one row could not both be true — the same defect the funding fields had,
             arriving from the other end, through an overlay rather than a render.

             The arithmetic here is the whole reason these carry attributes: notional and days
             come from the markup, so this is not a second copy of a business rule, it is the
             same rule applied to a newer number. */
          const vs = d.apr[sym];
          if (vs) {
            if (kind === "spread") {
              const xs = Object.values(vs);
              const sp = spreadOf(xs);
              if (sp !== null) next = pct(sp);
            } else {
              const a = vs[el.dataset.venue];
              if (Number.isFinite(a)) {
                if (kind === "dir") {
                  next = a >= 0 ? (el.dataset.pay ?? "longs pay") : (el.dataset.recv ?? "longs receive");
                  el.classList.toggle("pays-l", paysClass(a) === "pays-l");
                  el.classList.toggle("pays-s", paysClass(a) === "pays-s");
                } else {
                  const notional = +el.dataset.notional || 10000;
                  const days = +el.dataset.days || 7;
                  const v = Math.abs(carryCost(notional, a, days));
                  next = "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                }
              }
            }
          }
        } else if (kind === "chgmark" && Number.isFinite(mk) && +el.dataset.prev > 0) {
          next = changeWords(mk / +el.dataset.prev - 1);
        }
        if (next === null || el.textContent === next) continue;
        const key = kind + sym + (el.dataset.venue || "");
        const prev = last[key];
        el.textContent = next;
        last[key] = next;
        if (prev !== undefined && !reduced) {
          el.setAttribute("data-moved", "1");
          setTimeout(() => el.removeAttribute("data-moved"), 700);
        }
      }
      /* Same rule for the picture as for the numbers: a marker that tracks the mark while the
         spot marker beside it is pinned to page load would put two "now"s on one chart. */
      for (const sym in d.mark) moveMark(sym, "mark", d.mark[sym]);

      /* Each figure carries its own clock. The page-wide pill tracks the fastest thing on the
         page, and anything slower prints its own age beside it — a single timestamp would be
         true of some numbers and a lie about the rest. */
      /* THE PAGE-WIDE CLOCK ADVANCES AGAIN. It was suppressed on any page showing a spot cell,
         so that a pill would not claim freshness for a price pinned at page load. With no spot
         cells left anywhere, that guard only ever fired on the coin pages it was meant to
         protect — freezing their clock permanently. Every figure the overlay repaints is now
         from one feed on one tick, so the clock is simply true. */
      document.querySelectorAll("[data-clock]").forEach((el) => {
        const at = d[el.dataset.clock];
        if (at) { el.dataset.fresh = String(at); el.setAttribute("datetime", new Date(at).toISOString()); }
      });
    };

    /* ------------------------------------------------------------------ failure signal
       An ageing label is true but quiet: a reader who does not read it sees a number that
       looks current. After two consecutive failures — about a minute — the page says so in
       words, and says it where the freshness already is rather than in a banner that moves
       the layout. One failure is a blip and is not worth shouting about. */
    const pill = document.querySelector(".freshness");
    let fails = 0;
    const setLost = (on) => {
      if (!pill) return;
      pill.toggleAttribute("data-lost", on);
      /* The words live here, not in the HTML. Rendered server-side they appeared in every
         page's extracted text alongside the age, so a machine reading this site was told both
         that it had updated four minutes ago and that it was not updating. */
      const off = pill.querySelector(".freshness__off");
      if (off) off.textContent = on ? "Not updating" : "";
      pill.setAttribute("title", on
        ? "The connection to this site dropped. The figures below are the last ones received — the timestamp is when."
        : "");
    };

    const pull = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch("/api/live.json", { headers: { accept: "application/json" }, cache: "no-store" });
        if (!r.ok) throw new Error(r.status);
        const d = await r.json();
        /* `d.mark` and NOT `d.spot`: the shape guard named spot once, so removing spot from the
           payload would have made every pull throw and the page declare "Not updating" while
           the endpoint was answering correctly. A shape guard has to name what the contract
           still requires. */
        if (!d || !d.mark) throw new Error("shape");
        paint(d);
        fails = 0;
        setLost(false);
      } catch {
        if (++fails >= 2) setLost(true);
      }
    };

    /* ALWAYS TICK, SKIP WHILE HIDDEN. Starting the interval only when the tab was visible at
       load left any context that is hidden at load and never fires visibilitychange polling
       NEVER — reproduced in three minutes flat. The timer is unconditional and the fetch is
       what skips, so there is no state the page cannot leave. */
    pull();
    setInterval(pull, 30000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) pull(); });
    addEventListener("offline", () => { fails = 2; setLost(true); });
    addEventListener("online", pull);
  }
})();
