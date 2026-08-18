import type { APIRoute } from "astro";
import { INDEXNOW_KEY } from "../../worker/indexnow.ts";

/**
 * INDEXNOW OWNERSHIP PROOF. The protocol authenticates by asking the host to serve the key at
 * a path the submission names, so publishing it IS the mechanism — there is nothing secret
 * here and treating it as a secret would only make it harder to see what is going on.
 *
 * Served from the key constant rather than a committed static file, so the two can never
 * disagree: a key file that no longer matches what the worker submits is worse than none,
 * because submissions fail silently and nobody looks at a text file again.
 */
export const GET: APIRoute = ({ params }) =>
  params.key === INDEXNOW_KEY
    ? new Response(INDEXNOW_KEY, {
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" },
      })
    : new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
