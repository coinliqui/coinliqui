# Contributing

This is a single-operator project. Pull requests are welcome and there is no team waiting to
review them, so the useful thing to know before spending time is what the gate asks for.

## The gate

```
npm run check
```

That runs, in order: a typecheck, a full build, thirty-odd assertion suites, a seeded fixture
store, a smoke pass that renders every route against it, and a degraded pass that renders every
route against a store with holes in it. It must exit 0. There is no partial green.

`npm run deploy:site` runs the same gate and then verifies the deployed site from the outside —
every URL in every sitemap, fetched as a crawler, checked for status, completeness, structured
data, freshness and analytics coverage.

## The rules the checks encode

These are not style preferences. Each one is in `scripts/checks.mjs` because it shipped as a
defect first, and the comment above each check says which one.

- **Server-rendered at first byte.** Every number a reader sees is in the HTML before any script
  runs. A crawler that executes no JavaScript sees exactly what a person sees.
- **A label must measure what it names.** The most expensive bugs in this repository were not
  wrong values; they were correct values under names that asserted something else. If a variable
  is called `crawled` it must not hold `discovered`.
- **A check must be able to fail.** Every assertion has a standing fixture proving it fires on
  the fault and stays silent on the clean case. `npm run check` prints the count and refuses a
  check that has never been falsified.
- **No claim the site cannot keep.** A date, a cadence, a source, a permission — if the page
  states it, something has to be able to verify it. Where it cannot, the page says so instead.
- **No new dependencies.** The runtime dependency list in `package.json` fits in one glance, and
  it is meant to stay that way. A dependency is a permanent liability for a project with one
  maintainer. (A count is not written here on purpose — this repository has a check whose whole
  job is refusing numbers in prose that nothing keeps current.)

## What a good change looks like

Small, with the reasoning in the commit message rather than in a comment nobody will find, and
with the measurement that justified it. "Fixed the funding table" is not reviewable; "the quoted
rate printed at seven decimals did not multiply out to the APR beside it on 29 of 143 cells,
measured on the live snapshot" is.

## What will be declined

Redesigns, framework migrations, dependency additions, and anything that moves a number out of
the server render and into a client script. None of those are about taste — each one costs
something the project is built to keep.

## Contact

**hello@coinliqui.com**. Security reports: see [SECURITY.md](SECURITY.md).
