## What changed

<!-- One sentence. What a reader of the site would notice, not what files moved. -->

## What made you sure

<!-- The measurement. This project's expensive bugs were all correct-looking values under wrong
     labels, so "it works" is not evidence. A before/after number, a URL and a timestamp, or the
     output of the check that now fails without your change — any of those. -->

## Checklist

- [ ] `npm run check` exits 0
- [ ] Any new assertion has a standing fixture proving it fires on the fault and stays silent on
      the clean case (`scripts/check-blind-cases.mjs`)
- [ ] No new runtime dependency
- [ ] Nothing moved out of the server render into a client script
- [ ] No personal name, handle or email address anywhere in the diff, including commit metadata

<!-- See CONTRIBUTING.md for why each of those is there. Security issues: SECURITY.md — please
     report privately rather than opening a public pull request. -->
