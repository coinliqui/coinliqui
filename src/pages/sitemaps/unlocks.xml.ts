import type { APIRoute } from "astro";
import { xml } from "../../lib/sitemap.ts";
import { origin } from "../../lib/site.ts";
import register from "../../data/vesting-contracts.json";

/* NEITHER OF THE TWO OBVIOUS ANSWERS IS RIGHT HERE, so this route states its own.
 *
 * The git date was wrong: the page changes on its own, because it values on-chain amounts at
 * live prices, and a diff across a snapshot rotation shows the table moving. But the snapshot
 * stamp would be worse - it would claim hourly change for a register whose substance, the
 * contracts and the amounts they hold, moves only when the chain is re-read. A crawler
 * scheduling on that would refetch twelve times an hour to find the same eth_call results.
 *
 * lastmod describes when the CONTENT changed, and the content of this page is the register.
 * So it takes the register's own verification stamp, which is both more accurate than the git
 * date and, as it happens, newer than it. */
export const GET: APIRoute = ({ site }) =>
  xml([{ path: "/unlocks", lastmod: new Date((register as { verifiedAt: string }).verifiedAt).toISOString() }], origin(site));
