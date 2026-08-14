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
  const nf = (n, dp) => n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const qty = (n) => {
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return n.toFixed(2);
  };
  const compact = (n) => "$" + qty(n).replace(/\.00$/, "");
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

  /* -------------------------------------------- price chart: crosshair + OHLCV tooltip */
  document.querySelectorAll("svg[data-xhair]").forEach((svg) => {
    const src = document.getElementById(svg.dataset.xhair);
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
        (Number.isFinite(apr) ? `<span>Funding</span><b class="${apr >= 0 ? "pays-l" : "pays-s"}">${(apr * 100).toFixed(2)}% APR</b>` : "") +
        `</div><div class="tip__f">${up ? "▲" : "▼"} ${nf(Math.abs((a[5] - a[2]) / (a[2] || 1)) * 100, 2)}% on the bar` +
        (Number.isFinite(apr) ? ` · ${apr >= 0 ? "longs paying shorts" : "shorts paying longs"}` : "") + `</div>`,
        cx, cy, touch,
      );
    });
    const off = () => { g.setAttribute("opacity", "0"); fade(false); hideTip(); };
    svg.addEventListener("pointerleave", off);
    svg.addEventListener("pointercancel", off);
  });

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
      showTip(
        `<div class="tip__h">$${nf(bandLo, 0)} – $${nf(bandHi, 0)}</div>` +
        `<div class="tip__g">` +
        (i > 0
          ? `<span>Modelled</span><b>${compact(bound(i - 0.5))} – ${compact(bound(i + 0.5))}</b>`
          : `<span>Modelled</span><b class="dim">nothing standing here</b>`) +
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
  const openRight = () => document.querySelectorAll(".chart").forEach((c) => {
    if (c.scrollWidth > c.clientWidth + 4 && !c._sx) { c.scrollLeft = c.scrollWidth; c._sx = 1; }
  });
  openRight();
  addEventListener("resize", openRight, { passive: true });

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
    const panels = document.querySelectorAll(`[data-tfpanel][data-group="${id}"]`);
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
          `<td class="num ${f ? (q[7] >= 0 ? "pays-l" : "pays-s") : "faint"}">${f ? (q[7] * 100).toFixed(2) + "%" : "—"}</td>` +
          "</tr>";
      }).join("");
      table.querySelector("[data-tflabel]").textContent = label;
      table.querySelector("[data-tfcount]").textContent = String(pts.length);
    };

    const apply = (label) => {
      const key = hasModes && mode ? `${tf}.${mode}` : tf;
      panels.forEach((p) => p.toggleAttribute("data-on", p.dataset.tfpanel === key));
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
      try { history.replaceState(null, "", location.pathname); } catch {}
    };

    group.querySelectorAll("[data-tf], [data-mode]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        if (btn.dataset.tf) tf = btn.dataset.tf; else mode = btn.dataset.mode;
        apply(btn.dataset.tf ? btn.textContent.trim() : null);
      });
    });
  });

  /* --------------------------------------------------------- live freshness ticker */
  const fresh = document.querySelector("[data-fresh]");
  if (fresh) {
    /* Re-read the attribute every tick rather than closing over it once. The live layer
       below rewrites data-fresh when it pulls a newer quote, and the first version captured
       the value at load — so the page could show a thirty-second-old price under a label
       reading "5 min ago". The label and the number it labels have to come from one source. */
    const at = () => +fresh.dataset.fresh;
    // Same unit ladder as the server renders, or the number would change form on hydration.
    const tick = () => {
      const m = Math.max(0, Math.round((Date.now() - at()) / 60000));
      const next =
        m === 0 ? "just now"
        : m === 1 ? "1 min ago"
        : m < 60 ? `${m} min ago`
        : m < 48 * 60 ? `${Math.round(m / 60)} h ago`
        : `${Math.round(m / 1440)} d ago`;
      if (fresh.textContent !== next) fresh.textContent = next;
    };
    tick();
    setInterval(tick, 20000);
  }

  /* ------------------------------------------------------------------ live spot prices
     A LAYER OVER SERVER-RENDERED VALUES, NEVER THEIR SOURCE. Every figure it touches was
     already correct in the HTML at first byte — that is what gets indexed and cited, and it
     is what stays on screen if this never runs. There is no loading state and no skeleton,
     because there is nothing to wait for.

     Same origin only. Both Hyperliquid and Coinbase publish WebSocket feeds a browser could
     subscribe to directly, and either would be a request to a third-party domain on every
     page view — which /privacy says does not happen. So the page asks this site, and this
     site reads the value the cron already stored.

     No layout shift by construction: only textContent changes, inside boxes whose size is
     fixed by tabular figures and CSS. Nothing is inserted, removed or resized.

     Failure is silence. A 500, a timeout, an offline tab or a blocked request all leave the
     served numbers exactly where they were. */
  const spotEls = [...document.querySelectorAll("[data-spot]")];
  if (spotEls.length) {
    const dpOf = (el) => +(el.dataset.dp || 2);
    const money = (v, dp) => "$" + nf(v, dp);
    let last = {};

    /* THE CHART'S PRICE MARKER MOVES TOO.
       It used to show the last CANDLE close — up to two hours old, because the candle feed is
       on a two-hour gate while the quote is on a one-minute cron. On BTC that put $62,725 on
       the chart under a hero reading $62,977.52: two prices for one asset on one screen, both
       looking current. The bars are closed and stay put; the marker is what "now" means on a
       price chart, so it is what has to follow the quote. */
    const marks = [...document.querySelectorAll("svg[data-xhair][data-plot]")]
      .map((svg) => {
        const g = {
          sym: svg.dataset.unit,
          dp: +(svg.dataset.dp || 0),
          axisX: +svg.dataset.axx,
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
    const moveMark = (sym, v) => {
      for (const m of marks) {
        if (m.sym !== sym || !Number.isFinite(v)) continue;
        const y = m.yOf(v);
        m.line.setAttribute("y1", y.toFixed(1));
        m.line.setAttribute("y2", y.toFixed(1));
        m.pill.setAttribute("y", (y - 10).toFixed(1));
        m.txt.setAttribute("y", (y + 4).toFixed(1));
        m.txt.textContent = "$" + (m.dp ? v.toFixed(m.dp) : Math.round(v).toLocaleString("en-US"));
      }
    };

    const paint = (d) => {
      for (const el of spotEls) {
        const s = d.spot[el.dataset.sym];
        const mk = d.mark[el.dataset.sym];
        let next = null;
        if (el.dataset.spot === "last" && s) next = money(s.last, dpOf(el));
        else if (el.dataset.spot === "mark" && Number.isFinite(mk)) next = money(mk, dpOf(el));
        else if (el.dataset.spot === "chg" && s && s.open24h > 0) {
          const c = s.last / s.open24h - 1;
          next = `${c >= 0 ? "\u25b2" : "\u25bc"} ${(Math.abs(c) * 100).toFixed(2)}%`;
        } else if (el.dataset.spot === "basis" && s && Number.isFinite(mk) && s.last > 0) {
          const b = (mk / s.last - 1) * 1e4;
          next = el.classList.contains("card__value")
            ? `${b >= 0 ? "+" : ""}${b.toFixed(1)} bps`
            : `${b >= 0 ? "+" : ""}${b.toFixed(1)}`;
        }
        if (next === null || el.textContent === next) continue;
        const key = el.dataset.spot + el.dataset.sym;
        const prev = last[key];
        el.textContent = next;
        last[key] = next;
        if (prev !== undefined && !reduced) {
          el.setAttribute("data-moved", "1");
          setTimeout(() => el.removeAttribute("data-moved"), 700);
        }
      }
      for (const sym in d.spot) moveMark(sym, d.spot[sym].last);
      // The freshness label now describes the value actually on screen.
      if (fresh && d.at > +fresh.dataset.fresh) {
        fresh.dataset.fresh = String(d.at);
        fresh.setAttribute("datetime", new Date(d.at).toISOString());
      }
    };

    /* ALWAYS TICK, SKIP WHILE HIDDEN.
       The first version started the interval only if the tab was visible at load and otherwise
       waited for a visibilitychange. A context that is hidden when the script runs and never
       fires that event — a restored session, a prerendered tab, a headless pane — then polls
       NEVER, and the page sits on its load-time price for as long as it is open while the
       label counts up beside it. Reproduced in three minutes flat. The timer is unconditional
       now and the fetch is what is skipped, so there is no state the page cannot leave. */
    const pull = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch("/api/spot.json", { headers: { accept: "application/json" }, cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        if (d && d.spot) paint(d);
      } catch { /* keep what the server rendered */ }
    };
    pull();
    setInterval(pull, 30000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) pull(); });
  }
})();
