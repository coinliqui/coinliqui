// Client-side typeahead over a small local index. Every suggestion is a real <a href> to a
// real page. There is deliberately no /search?q= results page: Google removed the sitelinks
// searchbox on 2024-11-21, so SearchAction has no consumer, and a results template would be
// one more thin page spending crawl budget on a 37-page site.
const input = document.getElementById("q");
const out = document.getElementById("qr");
if (input && out) {
  let index = null;
  const load = async () => index ?? (index = await (await fetch("/search-index.json")).json());
  // Labels come from an upstream symbol list, so they are escaped rather than trusted.
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const render = (rows) => {
    out.innerHTML = rows
      .map((r) => `<a href="${esc(r.href)}">${esc(r.label)}<span class="dim"> — ${esc(r.kind)}</span></a>`)
      .join("");
    out.style.display = rows.length ? "block" : "none";
  };
  input.addEventListener("input", async () => {
    const q = input.value.trim().toLowerCase();
    if (!q) return render([]);
    const idx = await load();
    const hit = (r) =>
      r.label.toLowerCase().includes(q) || (r.alt ?? "").toLowerCase().includes(q) || r.kind.toLowerCase().includes(q);
    // One row per destination. A coin matches on its name and on its ticker, and offering the
    // same page twice — "Solana" above "SOL", both going to /coins/solana — reads as two
    // different answers to one question.
    const seen = new Set();
    render(idx.filter((r) => hit(r) && !seen.has(r.href) && seen.add(r.href)).slice(0, 8));
  });
  input.addEventListener("blur", () => setTimeout(() => (out.style.display = "none"), 150));
  input.addEventListener("focus", () => { if (input.value.trim()) out.style.display = "block"; });
}
