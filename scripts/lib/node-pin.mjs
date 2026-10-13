/**
 * WHICH NODE THIS PROJECT RUNS ON — written down once, compared on every run.
 *
 * The move to a new Mac on 13 October 2026 changed the runtime from Node 25.8.1 to 24.21.0, and
 * nothing in the repository noticed: the gate passed, the deploy passed, and the difference
 * surfaced only because someone compared two machines by hand. A runtime that nothing records is
 * a variable that changes silently at every move, so the major version is pinned here and a
 * mismatch stops the gate and both deploys before they build anything.
 *
 * THE MAJOR, NOT THE PATCH. A patch release must not stop a deploy; a major is where behaviour
 * moves (--experimental-strip-types, fetch, module resolution). `.nvmrc` holds it for version
 * managers, `engines` holds it for npm (with engine-strict in .npmrc, `npm ci` refuses a wrong
 * Node), and this compares the two as well — two copies of one fact are allowed only while
 * something checks that they agree.
 */
export function nodePinVerdict({ running, nvmrc, engines }) {
  const major = (v) => Number(String(v ?? "").trim().replace(/^v/, "").split(".")[0]);
  const want = major(nvmrc);
  const problems = [];
  if (!Number.isInteger(want) || want <= 0) problems.push(`.nvmrc does not name a major version: ${JSON.stringify(nvmrc)}`);
  const m = /^>=\s*(\d+)(?:\.\d+){0,2}\s+<\s*(\d+)(?:\.0){0,2}$/.exec(String(engines ?? "").trim());
  if (!m) problems.push(`package.json engines.node is not of the form ">=N <N+1": ${JSON.stringify(engines)}`);
  else if (Number(m[1]) !== want || Number(m[2]) !== want + 1) problems.push(`engines.node "${engines}" disagrees with .nvmrc ${want}`);
  const got = major(running);
  if (Number.isInteger(want) && got !== want) problems.push(`running Node ${String(running).replace(/^v/, "")}, the project is pinned to Node ${want}`);
  return { ok: problems.length === 0, want, got, problems };
}
