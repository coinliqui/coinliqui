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
    const { html, cx, cy, touch } = tipNext;
    const el = tipEl();
    if (el._h !== html) { el.innerHTML = html; el._h = html; }
    el.setAttribute("data-on", "1");
    const r = el.getBoundingClientRect(), pad = 16;
    let x = cx + pad;
    if (x + r.width > innerWidth - 10) x = cx - r.width - pad;
    if (x < 10) x = 10;
    let y = touch ? cy - r.height - 30 : cy - r.height / 2;
    if (y < 10) y = touch ? cy + 30 : 10;
    if (y + r.height > innerHeight - 10) y = innerHeight - r.height - 10;
    el.style.transform = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
  };
  const showTip = (html, cx, cy, touch) => {
    tipNext = { html, cx, cy, touch };
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
    const vl = g.querySelector('[data-xh="v"]'), hl = g.querySelector('[data-xh="h"]');
    const dot = g.querySelector('[data-xh="dot"]');
    const py = g.querySelector('[data-xh="py"]'), tx = g.querySelector('[data-xh="tx"]');
    // Column wash, behind the crosshair lines so candles stay legible through it.
    const col = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    col.setAttribute("fill", "#8ab4f8");
    col.setAttribute("opacity", ".10");
    col.setAttribute("y", plotY);
    col.setAttribute("height", plotH);
    g.insertBefore(col, g.firstChild);

    wire(svg, ({ vx, vy, cx, cy, touch }) => {
      let lo = 0, hi = pts.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (pts[m][0] < vx) lo = m + 1; else hi = m; }
      if (lo > 0 && Math.abs(pts[lo - 1][0] - vx) < Math.abs(pts[lo][0] - vx)) lo--;
      const a = pts[lo];
      g.setAttribute("opacity", "1");
      vl.setAttribute("x1", a[0]); vl.setAttribute("x2", a[0]);
      const cwv = Math.max(3.2, slot);   // a 1px wash is not a selection anyone can see
      col.setAttribute("x", (a[0] - cwv / 2).toFixed(2));
      col.setAttribute("width", cwv.toFixed(2));
      dot.setAttribute("cx", a[0]); dot.setAttribute("cy", a[8]);
      const y = Math.max(plotY, Math.min(plotY + plotH, vy));
      hl.setAttribute("y1", y); hl.setAttribute("y2", y);
      const price = pHi - ((y - plotY) / plotH) * (pHi - pLo);
      setPill(py, axisX + 5, y - 9.5, "$" + nf(price, dp));
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
    const off = () => { g.setAttribute("opacity", "0"); hideTip(); };
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
    const rows = +svg.dataset.rows, cols = +svg.dataset.cols;
    const g = svg.querySelector('[data-xh="g"]');
    if (!g) return;
    const vl = g.querySelector('[data-xh="v"]'), hl = g.querySelector('[data-xh="h"]');
    const py = g.querySelector('[data-xh="py"]'), tx = g.querySelector('[data-xh="tx"]');
    /* Inverting the transfer gives the value BOUNDS of the ramp step under the cursor. The
       readout is a band, not a point, because a band is genuinely what the colour encodes. */
    const bound = (i) => scale * Math.pow(Math.max(0, i) / (ramp.length - 1), 1 / gamma);

    wire(svg, ({ vx, vy, cx, cy, touch, target }) => {
      const x = Math.max(plotX, Math.min(plotX + plotW, vx));
      const y = Math.max(plotY, Math.min(plotY + plotH, vy));
      g.setAttribute("opacity", "1");
      vl.setAttribute("x1", x); vl.setAttribute("x2", x);
      hl.setAttribute("y1", y); hl.setAttribute("y2", y);
      const price = pHi - ((y - plotY) / plotH) * (pHi - pLo);
      const ci = Math.max(0, Math.min(cols - 1, Math.floor(((x - plotX) / plotW) * cols)));
      const ri = Math.max(0, Math.min(rows - 1, Math.floor(((y - plotY) / plotH) * rows)));
      const bandLo = pHi - ((ri + 1) / rows) * (pHi - pLo);
      const bandHi = pHi - (ri / rows) * (pHi - pLo);
      setPill(py, axisX + 5, y - 9.5, "$" + nf(price, 0));
      setPill(tx, x, plotY + plotH + 5, stamp(t0 + ci * stepMs, true), plotX, axisX);

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
        cx, cy, touch,
      );
    });
    const off = () => { g.setAttribute("opacity", "0"); hideTip(); };
    svg.addEventListener("pointerleave", off);
    svg.addEventListener("pointercancel", off);
  });

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
  document.querySelectorAll("[data-tfgroup]").forEach((group) => {
    const id = group.dataset.tfgroup;
    const panels = document.querySelectorAll(`[data-tfpanel][data-group="${id}"]`);
    const stats = document.querySelectorAll(`[data-tfstat][data-group="${id}"]`);
    group.querySelectorAll("[data-tf]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const tf = btn.dataset.tf;
        group.querySelectorAll("[data-tf]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
        panels.forEach((p) => p.toggleAttribute("data-on", p.dataset.tfpanel === tf));
        stats.forEach((s) => {
          const next = s.dataset["v" + tf.replace(/\W/g, "")];
          if (next === undefined || s.textContent === next) return;
          if (reduced) { s.textContent = next; return; }
          s.setAttribute("data-swap", "1");
          setTimeout(() => { s.textContent = next; s.removeAttribute("data-swap"); }, 110);
        });
        try { history.replaceState(null, "", location.pathname); } catch {}
      });
    });
  });

  /* --------------------------------------------------------- live freshness ticker */
  const fresh = document.querySelector("[data-fresh]");
  if (fresh) {
    const at = +fresh.dataset.fresh;
    const tick = () => {
      const m = Math.max(0, Math.round((Date.now() - at) / 60000));
      const next = m === 0 ? "just now" : m === 1 ? "1 min ago" : `${m} min ago`;
      if (fresh.textContent !== next) fresh.textContent = next;
    };
    tick();
    setInterval(tick, 20000);
  }
})();
