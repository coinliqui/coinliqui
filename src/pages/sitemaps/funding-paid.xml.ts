import type { APIRoute } from "astro";
import { xml, dataStamp } from "../../lib/sitemap.ts";
import { origin } from "../../lib/site.ts";
import { readFundingPaid } from "../../lib/funding-paid.ts";

/* DATED BY THE NEWEST HOUR THE SUM REACHES, which is what the page's dateModified says. The
   snapshot's instant would be hours newer than the figures whenever the settled rates lag the
   store, and the gate compares the two surfaces. */
export const GET: APIRoute = async ({ locals, site }) => {
  const env = (locals as any)?.runtime?.env;
  const read = await readFundingPaid(env?.DB, env?.SNAPSHOT, Date.now(), 30, import.meta.env.DEV);
  const lastmod = read.status === "ready" ? dataStamp(read.paid.last) : undefined;
  return xml(read.status === "ready" ? [{ path: "/funding/paid", lastmod }] : [], origin(site));
};
