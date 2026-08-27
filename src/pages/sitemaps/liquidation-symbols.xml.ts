import type { APIRoute } from "astro";
import { xml, dataStamp } from "../../lib/sitemap.ts";
import { origin } from "../../lib/site.ts";
import { getSnapshot } from "../../lib/hyperliquid.ts";
import { liqMapPaths } from "../../lib/routes.ts";
import { type MarginTable } from "../../lib/margin.ts";
import tables from "../../data/margin-tables.json";

/**
 * ONE MAP PER CONTRACT, AND ITS OWN SITEMAP FILE.
 *
 * WHY NOT FOLDED INTO liquidations.xml. That file carries three URLs whose indexation is
 * read weekly, per template, in reports/indexation-*.md. Adding forty-nine URLs to it would
 * move the template from 1-of-3 indexed to 1-of-52 overnight and make the series meaningless
 * in both directions — the existing pages' progress and the new template's would be summed
 * into one number describing neither. A separate file means the first question anybody asks
 * about this change ("did giving them URLs work?") has an answer next Monday.
 *
 * TWO EXCLUSIONS, both because the URL would not answer 200:
 *   - the pinned default, which lives at /liquidations and is linked from it (liqMapPaths);
 *   - any contract with no committed margin tier table, which the route 404s, because
 *     without one there is no maintenance margin, no corridor and no liquidation price.
 * Measured 27 August 2026: all fifty covered contracts map onto the ten committed tables, so
 * the second filter currently removes nothing. It is here for the window between upstream
 * adding a tier table and this repository committing one — the window pickPerp exists for.
 */
export const GET: APIRoute = async ({ locals, site }) => {
  const snap = await getSnapshot((locals as any)?.runtime?.env?.SNAPSHOT, import.meta.env.DEV);
  const lastmod = dataStamp(snap.fetchedAt);
  const TABLES = tables as Record<string, MarginTable>;
  const symbols = snap.perps
    .filter((p) => Object.prototype.hasOwnProperty.call(TABLES, String(p.marginTableId)))
    .map((p) => p.symbol);
  return xml(liqMapPaths(symbols).map((path) => ({ path, lastmod })), origin(site));
};
