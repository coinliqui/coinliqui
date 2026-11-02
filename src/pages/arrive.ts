import type { APIRoute } from "astro";
import { classifyBeacon, ENTRY_UPSERT, BEACON_GIF } from "../lib/entries.ts";

/* The confirmation half of the arrival count — see src/lib/entries.ts. Always answers the image,
   counted or not, and never lets a cache keep it: every page view must ask again. */
export const GET: APIRoute = async ({ request, locals, site }) => {
  const rt = (locals as any)?.runtime;
  const country = String((request as any).cf?.country ?? rt?.cf?.country ?? "??");
  const entry = site ? classifyBeacon(request, site.origin, Date.now(), country) : null;
  const db = rt?.env?.DB;
  if (entry && db && rt?.ctx?.waitUntil) {
    rt.ctx.waitUntil(db.prepare(ENTRY_UPSERT).bind(entry.day, entry.path, entry.src, entry.how, entry.device, entry.country).run().catch(() => {}));
  }
  return new Response(BEACON_GIF, {
    headers: { "content-type": "image/gif", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
};
