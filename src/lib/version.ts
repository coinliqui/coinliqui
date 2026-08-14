/**
 * The worker bundle the site expects to be talking to.
 *
 * `worker-dist/ingest.bundle.js` is copied into the Cloudflare dashboard by hand, which
 * means the deployed worker can drift behind this repository with no error anywhere — the
 * pages keep rendering, the timestamps keep updating, and only whatever the newer worker
 * was supposed to write is quietly absent. /status compares this with the stamp the worker
 * writes to KV on every run.
 *
 * Bump this and WORKER_BUILD in worker/ingest.ts together, then rebuild and re-paste.
 */
export const EXPECTED_WORKER_BUILD = "2026-08-14e";
