import type { APIRoute } from "astro";
import { getSnapshot } from "../lib/hyperliquid.ts";

// Small local index for the shell typeahead. Every entry is a real page.
export const GET: APIRoute = async ({ locals }) => {
  const snap = await getSnapshot((locals as any)?.runtime?.env?.SNAPSHOT);
  const rows = [
    ...snap.perps.map((p) => ({ label: p.symbol, href: `/funding/${p.symbol.toLowerCase()}`, kind: "funding" })),
    { label: "Position size", href: "/tools/position-size", kind: "tool" },
    { label: "Funding rates", href: "/funding", kind: "section" },
    { label: "Open interest", href: "/open-interest", kind: "section" },
    { label: "Methodology", href: "/methodology", kind: "reference" },
    { label: "Why we don't publish liquidation totals", href: "/methodology/liquidations", kind: "reference" },
    { label: "Data sources", href: "/data-sources", kind: "reference" },
  ];
  return new Response(JSON.stringify(rows), {
    headers: { "content-type": "application/json", "cache-control": "public, s-maxage=300" },
  });
};
