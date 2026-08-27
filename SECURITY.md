# Security

## Reporting

Email **hello@coinliqui.com**. This is the same address published in
[`/.well-known/security.txt`](https://coinliqui.com/.well-known/security.txt) on the live site,
and it is the only reporting route — there is no bug bounty, no platform, and no form.

Please include what you did, what happened, and what you expected. A URL and a timestamp are
usually enough to reproduce anything here, because every page is server-rendered and every
figure on it states its own age.

Expect a reply within a few days. This is a one-person project with no company behind it and no
on-call rotation; that is stated plainly rather than dressed up as an SLA.

## What is in scope

`coinliqui.com` and everything served from it, and the source in this repository.

## What an attacker cannot reach here, and why it is short

There are no user accounts, no sign-up, no password, no session beyond a single preference
cookie, no payment path, no wallet connection and no API key belonging to a reader. Nothing on
the site can accept money or a credential, so there is no store of either to breach. The one
thing a reader can save — a pinned coin list — never leaves their own browser.

That is not a claim about how carefully the site is operated. It is a description of what is
built, and it is checkable: read [`/privacy`](https://coinliqui.com/privacy), which describes
what runs measured on the day it was edited, and the Content-Security-Policy in any response
header, which names exactly one off-origin host.

## What is worth reporting anyway

- Anything that lets one reader's input reach another reader's page.
- A figure that is wrong in a way the page presents as certain. A wrong number stated
  confidently is the failure mode this project takes most seriously, and several of the checks
  in `scripts/` exist because one shipped.
- A page that claims something the site cannot support — a date it cannot keep, a source it
  does not read, a permission it has not been granted.
- Anything reachable that names a private individual. The one hard rule in this repository is
  that no personal email address appears anywhere: not on a page, not in structured data, not
  in commit metadata, not in a package manifest.

## Disclosure

Report privately first. There is no embargo policy to negotiate and nothing to coordinate
across vendors — a fix here is a deploy. Once it is out, publish whatever you like.
