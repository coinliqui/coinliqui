/* Interaction layer. Vanilla, no dependencies.
 *
 * Rule this file obeys: it NEVER produces a number. Every value it displays was already
 * rendered into the HTML by the server — the crosshair reads the same point list the chart
 * was drawn from, and cell tooltips read an attribute written server-side. If this script
 * fails to load, the page loses responsiveness and not one figure.
 */
(() => {
  "use strict";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------------------------------------------------------- tooltip */
  let tip;
  const tipEl = () => {
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "tip";
      tip.setAttribute("role", "status");
      document.body.appendChild(tip);
    }
    return tip;
  };
  const showTip = (html, cx, cy, touch) => {
    const el = tipEl();
    el.innerHTML = html;
    el.classList.add("is-on");
    const r = el.getBoundingClientRect();
    const pad = 14;
    let x = cx + pad;
    // keep it on screen, and never under the thumb on touch
    if (x + r.width > innerWidth - 8) x = cx - r.width - pad;
    if (x < 8) x = 8;
    let y = touch ? cy - r.height - 26 : cy - r.height / 2;
    if (y < 8) y = touch ? cy + 26 : 8;
    if (y + r.height > innerHeight - 8) y = innerHeight - r.height - 8;
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };
  const hideTip = () => tip && tip.classList.remove("is-on");

  const nf = (n, dp) => n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const compact = (n) => {
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return (n / 1e3).toFixed(2) + "K";
    return n.toFixed(2);
  };

  /* ------------------------------------------------------------- crosshair */
  const fmtWhen = (t, tf) =>
    new Date(t).toLocaleString("en-GB",
      tf === "long" ? { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" }
                    : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

  document.querySelectorAll("svg[data-xhair]").forEach((svg) => {
    const src = document.getElementById(svg.dataset.xhair);
    if (!src) return;
    let pts;
    try { pts = JSON.parse(src.textContent); } catch { return; }
    if (!pts || !pts.length) return;

    const vb = svg.viewBox.baseVal;
    const dp = +(svg.dataset.dp || 2);
    const axX = +(svg.dataset.axx || 0);
    const [plotX, plotY, plotW, plotH] = (svg.dataset.plot || "0,0,0,0").split(",").map(Number);
    const [pLo, pHi] = (svg.dataset.prange || "0,1").split(",").map(Number);
    const g = svg.querySelector(".xh");
    if (!g) return;
    const vline = g.querySelector(".xh-v"), hline = g.querySelector(".xh-h"), dot = g.querySelector(".xh-dot");
    const pyG = g.querySelector(".xh-py"), txG = g.querySelector(".xh-tx");
    const pyRect = pyG && pyG.querySelector("rect"), pyText = pyG && pyG.querySelector("text");
    const txRect = txG && txG.querySelector("rect"), txText = txG && txG.querySelector("text");

    let raf = 0, pending = null;
    const draw = () => {
      raf = 0;
      if (!pending) return;
      const { vx, vy, cx, cy, touch } = pending;
      let lo = 0, hi = pts.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (pts[m][0] < vx) lo = m + 1; else hi = m; }
      if (lo > 0 && Math.abs(pts[lo - 1][0] - vx) < Math.abs(pts[lo][0] - vx)) lo--;
      // [x, t, o, h, l, c, v, apr, closeY]
      const a = pts[lo];
      g.removeAttribute("hidden");
      vline.setAttribute("x1", a[0]); vline.setAttribute("x2", a[0]);
      dot.setAttribute("cx", a[0]); dot.setAttribute("cy", a[8]);

      // horizontal line follows the CURSOR, and the right axis reads the price there —
      // that is what makes it an instrument rather than a hover effect
      const clampY = Math.max(plotY, Math.min(plotY + plotH, vy));
      hline.setAttribute("y1", clampY); hline.setAttribute("y2", clampY);
      const priceAt = pHi - ((clampY - plotY) / plotH) * (pHi - pLo);
      if (pyRect) {
        pyRect.setAttribute("y", clampY - 10);
        pyText.setAttribute("y", clampY + 4);
        pyText.textContent = "$" + nf(priceAt, dp);
      }
      if (txRect) {
        const label = fmtWhen(a[1]);
        txText.textContent = label;
        const w = Math.max(84, label.length * 6.6);
        txRect.setAttribute("width", w);
        txRect.setAttribute("x", Math.max(plotX, Math.min(axX - w, a[0] - w / 2)));
        txText.setAttribute("x", Math.max(plotX + w / 2, Math.min(axX - w / 2, a[0])));
      }

      const up = a[5] >= a[2];
      const apr = a[7];
      showTip(
        `<div class="tip__h">${fmtWhen(a[1])} UTC</div>` +
        `<div class="tip__g">` +
        `<span>Open</span><b>$${nf(a[2], dp)}</b>` +
        `<span>High</span><b>$${nf(a[3], dp)}</b>` +
        `<span>Low</span><b>$${nf(a[4], dp)}</b>` +
        `<span>Close</span><b>$${nf(a[5], dp)}</b>` +
        `<span>Volume</span><b>${compact(a[6])}</b>` +
        (Number.isFinite(apr)
          ? `<span>Funding</span><b class="${apr >= 0 ? "pays-l" : "pays-s"}">${(apr * 100).toFixed(2)}%</b>`
          : "") +
        `</div>` +
        `<div class="tip__f">${up ? "▲" : "▼"} ${nf(Math.abs((a[5] - a[2]) / (a[2] || 1)) * 100, 2)}% on the bar` +
        (Number.isFinite(apr) ? ` · ${apr >= 0 ? "longs paying" : "shorts paying"}` : "") + `</div>`,
        cx, cy, touch,
      );
    };

    const move = (e) => {
      const r = svg.getBoundingClientRect();
      pending = {
        vx: ((e.clientX - r.left) / r.width) * vb.width,
        vy: ((e.clientY - r.top) / r.height) * vb.height,
        cx: e.clientX, cy: e.clientY, touch: e.pointerType === "touch",
      };
      if (!raf) raf = requestAnimationFrame(draw);
      if (e.pointerType === "touch") e.preventDefault();
    };
    const leave = () => { g.setAttribute("hidden", ""); hideTip(); };
    svg.addEventListener("pointermove", move, { passive: false });
    svg.addEventListener("pointerdown", move, { passive: false });
    svg.addEventListener("pointerleave", leave);
    svg.addEventListener("pointercancel", leave);
  });

  /* ------------------------------- crosshair with axis labels, no point list (grids) */
  document.querySelectorAll("svg[data-xhair-axes]").forEach((svg) => {
    const vb = svg.viewBox.baseVal;
    const dp = +(svg.dataset.dp || 2);
    const axX = +(svg.dataset.axx || 0);
    const [plotX, plotY, plotW, plotH] = (svg.dataset.plot || "0,0,0,0").split(",").map(Number);
    const [pLo, pHi] = (svg.dataset.prange || "0,1").split(",").map(Number);
    const ax = (svg.dataset.timeAxis || "").split(",").map(Number);
    const g = svg.querySelector(".xh");
    if (!g) return;
    const vline = g.querySelector(".xh-v"), hline = g.querySelector(".xh-h");
    const pyR = g.querySelector(".xh-py rect"), pyT = g.querySelector(".xh-py text");
    const txR = g.querySelector(".xh-tx rect"), txT = g.querySelector(".xh-tx text");
    let raf = 0, pend = null;
    const draw = () => {
      raf = 0;
      if (!pend) return;
      const { vx, vy } = pend;
      const cxv = Math.max(plotX, Math.min(plotX + plotW, vx));
      const cyv = Math.max(plotY, Math.min(plotY + plotH, vy));
      g.removeAttribute("hidden");
      vline.setAttribute("x1", cxv); vline.setAttribute("x2", cxv);
      hline.setAttribute("y1", cyv); hline.setAttribute("y2", cyv);
      const price = pHi - ((cyv - plotY) / plotH) * (pHi - pLo);
      pyR.setAttribute("y", cyv - 10); pyT.setAttribute("y", cyv + 4);
      pyT.textContent = "$" + nf(price, dp);
      if (ax.length === 4 && !Number.isNaN(ax[0])) {
        const idx = Math.max(0, Math.round((cxv - ax[2]) / ax[3]));
        const label = new Date(ax[0] + idx * ax[1]).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
        txT.textContent = label;
        const w = Math.max(84, label.length * 6.6);
        txR.setAttribute("width", w);
        txR.setAttribute("x", Math.max(plotX, Math.min(axX - w, cxv - w / 2)));
        txT.setAttribute("x", Math.max(plotX + w / 2, Math.min(axX - w / 2, cxv)));
      }
    };
    svg.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      pend = { vx: ((e.clientX - r.left) / r.width) * vb.width, vy: ((e.clientY - r.top) / r.height) * vb.height };
      if (!raf) raf = requestAnimationFrame(draw);
    }, { passive: true });
    svg.addEventListener("pointerleave", () => g.setAttribute("hidden", ""));
  });

  /* ---------------------------------------------- tooltips on grid/bar cells */
  const tipHost = (el) => el.closest("[data-tip]");
  document.querySelectorAll("svg").forEach((svg) => {
    if (!svg.querySelector("[data-tip]")) return;
    const axis = (svg.dataset.timeAxis || "").split(",").map(Number); // t0,stepMs,x0,colW
    const vb = svg.viewBox.baseVal;
    svg.addEventListener("pointermove", (e) => {
      const host = tipHost(e.target);
      if (!host) { hideTip(); svg.querySelectorAll(".is-hot").forEach((n) => n.classList.remove("is-hot")); return; }
      svg.querySelectorAll(".is-hot").forEach((n) => n !== host && n.classList.remove("is-hot"));
      host.classList.add("is-hot");
      let html = host.dataset.tip;
      if (axis.length === 4 && !Number.isNaN(axis[0])) {
        const r = svg.getBoundingClientRect();
        const vx = ((e.clientX - r.left) / r.width) * vb.width;
        const idx = Math.max(0, Math.round((vx - axis[2]) / axis[3]));
        const d = new Date(axis[0] + idx * axis[1]);
        html += `<div class="tip__f">${d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC</div>`;
      }
      showTip(html, e.clientX, e.clientY, e.pointerType === "touch");
      if (e.pointerType === "touch") e.preventDefault();
    }, { passive: false });
    svg.addEventListener("pointerleave", () => {
      hideTip();
      svg.querySelectorAll(".is-hot").forEach((n) => n.classList.remove("is-hot"));
    });
  });

  /* ------------------------------------------------------ timeframe switcher */
  document.querySelectorAll("[data-tfgroup]").forEach((group) => {
    const panels = document.querySelectorAll(`[data-tfpanel][data-group="${group.dataset.tfgroup}"]`);
    const stats = document.querySelectorAll(`[data-tfstat][data-group="${group.dataset.tfgroup}"]`);
    group.querySelectorAll("[data-tf]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const tf = btn.dataset.tf;
        group.querySelectorAll("[data-tf]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
        panels.forEach((p) => p.classList.toggle("is-on", p.dataset.tfpanel === tf));
        stats.forEach((s) => {
          const next = s.dataset[`v${tf.replace(/\W/g, "")}`];
          if (next === undefined || s.textContent === next) return;
          if (reduced) { s.textContent = next; return; }
          s.classList.add("is-swap");
          setTimeout(() => { s.textContent = next; s.classList.remove("is-swap"); }, 110);
        });
        // keep the URL clean: one query, one page. No history entry per timeframe.
        try { history.replaceState(null, "", location.pathname); } catch {}
      });
    });
  });

  /* --------------------------------------------------- live freshness ticker */
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
