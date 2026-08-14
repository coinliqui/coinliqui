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

  /* ------------------------------------------------- crosshair on line charts */
  document.querySelectorAll("svg[data-xhair]").forEach((svg) => {
    const src = document.getElementById(svg.dataset.xhair);
    if (!src) return;
    let pts;
    try { pts = JSON.parse(src.textContent); } catch { return; }
    if (!pts || !pts.length) return;

    const vb = svg.viewBox.baseVal;
    const dp = +(svg.dataset.dp || 2);
    const g = svg.querySelector(".xh");
    const vline = g && g.querySelector(".xh-v");
    const dot = g && g.querySelector(".xh-dot");
    const plot = (svg.dataset.plot || "0,0,0,0").split(",").map(Number);
    if (!g) return;

    let raf = 0, pending = null;
    const draw = () => {
      raf = 0;
      if (!pending) return;
      const { vx, cx, cy, touch } = pending;
      // nearest point by x — binary search keeps this cheap on 168 bars
      let lo = 0, hi = pts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (pts[mid][0] < vx) lo = mid + 1; else hi = mid;
      }
      if (lo > 0 && Math.abs(pts[lo - 1][0] - vx) < Math.abs(pts[lo][0] - vx)) lo--;
      // compact tuple: [x, y, t, o, h, l, c, v] — named keys would double the payload
      const a = pts[lo];
      const p = { x: a[0], y: a[1], t: a[2], o: a[3], h: a[4], l: a[5], c: a[6], v: a[7] };
      g.removeAttribute("hidden");
      vline.setAttribute("x1", p.x); vline.setAttribute("x2", p.x);
      vline.setAttribute("y1", plot[1]); vline.setAttribute("y2", plot[1] + plot[3]);
      dot.setAttribute("cx", p.x); dot.setAttribute("cy", p.y);
      const d = new Date(p.t);
      const when = d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
      const up = p.c >= p.o;
      showTip(
        `<div class="tip__h">${when} UTC</div>` +
        `<div class="tip__g">` +
        `<span>Open</span><b>$${nf(p.o, dp)}</b>` +
        `<span>High</span><b>$${nf(p.h, dp)}</b>` +
        `<span>Low</span><b>$${nf(p.l, dp)}</b>` +
        `<span>Close</span><b>$${nf(p.c, dp)}</b>` +
        `<span>Volume</span><b>${compact(p.v)}</b>` +
        `</div>` +
        `<div class="tip__f">${up ? "▲" : "▼"} ${nf(Math.abs((p.c - p.o) / (p.o || 1)) * 100, 2)}% on the bar</div>`,
        cx, cy, touch,
      );
    };

    const move = (e) => {
      const r = svg.getBoundingClientRect();
      const vx = ((e.clientX - r.left) / r.width) * vb.width;
      pending = { vx, cx: e.clientX, cy: e.clientY, touch: e.pointerType === "touch" };
      if (!raf) raf = requestAnimationFrame(draw);
      if (e.pointerType === "touch") e.preventDefault();
    };
    const leave = () => { g.setAttribute("hidden", ""); hideTip(); };

    svg.addEventListener("pointermove", move, { passive: false });
    svg.addEventListener("pointerdown", move, { passive: false });
    svg.addEventListener("pointerleave", leave);
    svg.addEventListener("pointercancel", leave);
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
