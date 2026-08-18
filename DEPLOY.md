# Deploying coinliqui.com — dashboard only

Every step is a web UI. The one exception is pushing the repository to GitHub the first
time, and there is a GUI app for that too (step 5).

**Order matters.** Data must be flowing *before* the domain is attached. The point of
deploying now is to start accruing funding history, and history cannot be backfilled — but
you also do not want Google to meet the site on a `*.pages.dev` hostname. So: worker and
database first, DNS last.

About 50 minutes. All of it on free tiers.

Names used below, all fixed — copy them exactly:

| Thing | Name |
|---|---|
| Domain | `coinliqui.com` |
| KV namespace | `coinliqui-snapshot` |
| D1 database | `coinliqui` |
| Ingest worker | `coinliqui-ingest` |
| Pages project | `coinliqui` |
| GitHub repo | `coinliqui` (public) |
| R2 bucket | `coinliqui-og` |

---

## 1. Cloudflare account

1. Sign up at **dash.cloudflare.com** — Free plan.
2. Verify the email, then **My Profile → Authentication → Two-Factor Authentication** and
   turn it on. Do this before anything is attached to the account.

---

## 2. Add coinliqui.com to Cloudflare, and repoint it at Namecheap

Cloudflare has to be authoritative for the zone; Pages custom domains do not work otherwise.

1. Dashboard → **Add a domain** → type `coinliqui.com` → **Continue**.
2. Choose the **Free** plan.
3. Cloudflare scans existing DNS. There is nothing to keep on a fresh domain — **Continue**.
4. Cloudflare shows **two nameservers**, like
   `adam.ns.cloudflare.com` and `bree.ns.cloudflare.com`. **They are unique to your
   account — use the two it shows you, not these.** Copy both.
5. In a second tab, **namecheap.com → Sign in → Domain List → Manage** next to
   `coinliqui.com`.
6. On the **Domain** tab find **NAMESERVERS**. Change the dropdown from *Namecheap
   BasicDNS* to **Custom DNS**.
7. Paste nameserver 1 and nameserver 2. Remove any other rows. Click the **green tick** to
   save — Namecheap does not save until you click it.
8. Back on Cloudflare → **Check nameservers now**.

Status goes **Pending → Active**. Usually 5–30 minutes, occasionally a few hours. **Carry
on with steps 3–7 while you wait** — none of them need DNS.

> Namecheap may show "Domain is not using Namecheap BasicDNS" as a warning. That is the
> intended state.

---

## 3. KV namespace — what the pages read from

1. Dashboard → **Storage & Databases → KV**.
2. **Create namespace**, name `coinliqui-snapshot`.
3. Copy the **Namespace ID** into a scratch note. You need it once.

---

## 4. D1 database — the history that cannot be backfilled

1. Dashboard → **Storage & Databases → D1 SQL Database**.
2. **Create database**, name exactly `coinliqui`.
3. Open it → **Console** tab.
4. Open `db/paste-into-d1-console.sql` in the repo, copy the whole file, paste, **Execute**.
5. Confirm two tables exist: `funding_snapshot` and `upstream_check`.

That file is both migrations concatenated, so there is nothing to run in order.

---

## 5. GitHub repository — public

1. **github.com/new** → name `coinliqui` → **Public** → do *not* add a README, .gitignore
   or licence (the repo has them) → **Create repository**.
2. Push the local repo. GUI route: **GitHub Desktop** → *Add → Add Existing Repository* →
   `~/Documents/basis` → **Publish repository** → untick *Keep this code private*.

**What is in it:** 64 tracked files, scanned — no credential patterns, no `.env`, no
`.dev.vars`. The KV and D1 IDs that go in `wrangler.toml` are identifiers rather than
secrets: they are reachable only through a binding on a Worker inside your account. This
project has no API keys at all, because it reads public market data and stores nothing
private. The only environment variable is `SITE_URL`, and it is a public URL.

Public is deliberate: GitHub Actions minutes are unlimited only on public repositories,
and that is where OG image rendering will run.

---

## 6. The ingest worker

1. Dashboard → **Compute (Workers) → Create → Start with Hello World** → **Deploy**.
   Name it `coinliqui-ingest`.
2. **Edit code**.
3. Open `worker-dist/ingest.bundle.js` from the repo on GitHub, click **Raw**, select all,
   copy. In the Cloudflare editor select all and paste over it. **Deploy**.

   *(That file is a build artefact committed on purpose, so it can be copied from GitHub's
   web UI with no build step. If you ever change `worker/ingest.ts`, the bundle must be
   rebuilt and re-pasted — the dashboard does not build from source.)*

4. Worker → **Settings → Bindings → Add binding**:
   - **KV namespace** — variable name `SNAPSHOT`, namespace `coinliqui-snapshot`
   - **D1 database** — variable name `DB`, database `coinliqui`

   The variable names must be exactly `SNAPSHOT` and `DB`, capitals included.

5. Worker → **Settings → Triggers → Cron Triggers → Add Cron Trigger** → **Schedule**
   → `*/5 * * * *` → **Add**.

---

## 7. Start the clock

1. Open `https://coinliqui-ingest.<your-subdomain>.workers.dev/ingest` in a tab. The
   subdomain is shown on the worker's page.
2. Expect JSON with `"ok": true` and roughly 75 rows.
3. D1 → `coinliqui` → Console:
   ```sql
   SELECT COUNT(*) AS rows, MAX(at) AS newest FROM funding_snapshot;
   ```
   Non-zero means history is accruing. **From this moment the funding history is
   recording**, whether or not the site is public. That is the thing that cannot be
   backfilled.

If `ok` is false, the JSON carries the upstream status and the error string. Do not
continue until it is true — a deployed site with an empty KV serves 503s by design.

---

## 8. The Pages project

1. Dashboard → **Compute (Workers) → Pages → Connect to Git**.
2. Authorise GitHub, select the `coinliqui` repo.
3. Build settings:
   - Framework preset **Astro**
   - Build command `npm run build`
   - Build output directory `dist`
4. **Environment variables (Production and Preview) → Add variable**:

   | Name | Value |
   |---|---|
   | `SITE_URL` | `https://coinliqui.com` |

   Exactly that. No trailing slash, `https`, apex with no `www`.

5. **Save and Deploy.**

> **`SITE_URL` is not optional.** The build throws if it is missing on Cloudflare. Without
> it, canonicals and the sitemap would point at a placeholder while the site was live on
> `*.pages.dev` — which is how indexing starts on a URL you then have to migrate away from.
> A failed build is the cheaper outcome.

6. After the first deploy: **Settings → Bindings → Add** the same two:
   KV `SNAPSHOT` → `coinliqui-snapshot`, D1 `DB` → `coinliqui`.
7. **Deployments → … → Retry deployment.** Bindings only attach on a fresh deploy, so the
   first build does not have them.

At this point `https://coinliqui-xxx.pages.dev` works and deliberately refuses indexing:
`robots.txt` returns `Disallow: /` and every response carries
`X-Robots-Tag: noindex, nofollow`, because the request host does not match `SITE_URL`.
That is the host guard. It switches itself off the moment the real domain resolves.

---

## 9. Attach the domain

Requires step 2 to show **Active**.

1. Pages project → **Custom domains → Set up a custom domain** → `coinliqui.com` →
   **Activate domain**. Cloudflare creates the record itself (CNAME, flattened at the
   apex). Do not hand-create an A record; there is no IP to point at.
2. Add a second custom domain: `www.coinliqui.com`.
3. **Rules → Redirect Rules → Create rule**:
   - Name: `www to apex`
   - When incoming requests match → **Custom filter expression**:
     Field *Hostname*, Operator *equals*, Value `www.coinliqui.com`
   - Then → **Dynamic redirect**, Type **301**, Expression:
     ```
     concat("https://coinliqui.com", http.request.uri.path)
     ```
   - **Deploy**
4. **SSL/TLS → Overview** → mode **Full (strict)**.
5. **SSL/TLS → Edge Certificates** → **Always Use HTTPS: ON**. Wait for the certificate to
   read **Active** (usually under 15 minutes).

The apex is canonical because `SITE_URL` is the apex. Two hostnames serving the same
content with no redirect is a duplicate-content split.

---

## 10. Bot protection — the step that decides whether this project is visible at all

Easiest to skip, most expensive to get wrong. DeFiLlama is effectively invisible to AI
assistants because of settings like these. **Cloudflare has blocked AI crawlers by default
on new zones since July 2025**, so the default is against you — this is not a
belt-and-braces check.

Go to the **domain's** dashboard (`coinliqui.com`, not the Pages project) and set every one:

| Where | Setting | Must be |
|---|---|---|
| **AI Crawl Control** (was *AI Audit*) | every crawler's action | **Allow.** Check `GPTBot`, `OAI-SearchBot`, `ChatGPT-User`, `ClaudeBot`, `Claude-User`, `Claude-SearchBot`, `PerplexityBot`, `Google-Extended`, `Applebot-Extended`, `Bytespider`, `Amazonbot` |
| Security → Bots | **Bot Fight Mode** | **OFF** — it challenges non-browser traffic, which is every crawler we want |
| Security → Settings | **Block AI bots** / *AI Scrapers and Crawlers* | **OFF** |
| Security → Settings | **AI Labyrinth** | **OFF** — serves crawlers decoy pages |
| Security → Settings | **Browser Integrity Check** | **OFF** — drops clients with unusual user agents |
| Security → Settings | **Security Level** | **Medium** or lower. Never *I'm Under Attack*: it challenges Googlebot |
| Scrape Shield | **Managed robots.txt** | **OFF** — Cloudflare would otherwise append AI-blocking rules to the file we serve |
| Security → WAF → Custom rules | — | none blocking by user agent, ASN or country |
| Security → WAF → Rate limiting rules | — | none matching `/robots.txt`, `/sitemap-index.xml` or `/sitemaps/*` |
| Caching → Configuration | **Crawler Hints** | ON (optional, harmless, helps freshness) |

Cloudflare moves these around between dashboard versions. If a row is not where the table
says, use the dashboard's search box with the setting's name — the required value does not
change.

**Then prove it from outside**, not from the dashboard. In a terminal on any machine, or
ask me to run them:

```bash
curl -sI -A "GPTBot/1.1"       https://coinliqui.com/funding/btc | head -1
curl -sI -A "ClaudeBot/1.0"    https://coinliqui.com/           | head -1
curl -sI -A "PerplexityBot/1.0" https://coinliqui.com/robots.txt | head -1
curl -sI -A "Googlebot/2.1"    https://coinliqui.com/sitemap-index.xml | head -1
```

All four must be `HTTP/2 200`. A `403`, a `503`, or an HTML challenge page means one of the
rows above is still on.

---

## 11. Email on the domain

Free, and it gives you `hello@coinliqui.com` without a mailbox to run.

1. Domain dashboard → **Email → Email Routing** → **Get started**.
2. Cloudflare offers to add the MX and TXT records for you → **Add records automatically**.
3. **Destination addresses → Create** → your personal address → confirm the verification
   email Cloudflare sends to it.
4. **Routing rules → Create address**: `hello@coinliqui.com` → forward to that destination.
5. Optional but worth it: **Catch-all address → Enable** → forward to the same place. That
   catches typos and anything you print later.

Sending *from* the address needs an SMTP provider and is a separate job; receiving is done.

---

## 12. R2 bucket — create it now, use it later

Needed for OG images, which are the next task after the charts.

1. Dashboard → **R2 → Create bucket** → `coinliqui-og`, location Automatic.
2. Bucket → **Settings → Public access → Custom domains → Connect domain** →
   `img.coinliqui.com`. Cloudflare creates the DNS record.

Free tier: 10 GB storage, 1M writes/month. OG images total a few hundred KB.

---

## 13. Google Search Console

Do this **only after step 9**, when the apex resolves. Submitting while the site is on
`pages.dev` teaches Google the wrong hostname.

1. **search.google.com/search-console** → **Add property** → **Domain** (the left box, not
   URL prefix) → `coinliqui.com`.
2. It gives you a TXT record. Cloudflare → **DNS → Records → Add record**:
   Type `TXT`, Name `@`, Content = the string Google gave you. **Save**.
3. Back in Search Console → **Verify**. If it fails, wait two minutes and retry — DNS
   propagation inside Cloudflare is fast but not instant.
4. **Sitemaps** → add `sitemap-index.xml` → **Submit**. One entry; Google reads the seven
   child sitemaps from it.
5. **Settings → Crawl stats** — check back in a week; it is the first place a bot block
   shows up.
6. **bing.com/webmasters** → **Import from Google Search Console**. Worth the two minutes:
   Bing's index is what ChatGPT search reads.

### What to watch from week 4

Search Console → **Pages** and **Performance**, filtered by URL path. One row per template:

| Filter | What it tells you | Healthy by week 6 |
|---|---|---|
| `/funding/` | the 25 entity pages — the volume play | 20+ indexed |
| `/tools/` | the 5 calculators — highest intent | all 5 indexed, impressions rising |
| `/liquidations` | the model pages | all 3 indexed |
| `/methodology`, `/data-sources` | the citation surface | indexed, few impressions, that is fine |
| `/` and `/funding` | the hubs | indexed first, always |

Two numbers matter more than rank: **Indexed vs Discovered-not-indexed** in the Pages
report, and **average position by template** in Performance. If a whole template sits in
*Discovered – currently not indexed* past week 6, the template is thin, not unlucky.

Also check **Performance → Search appearance** for the first branded queries. A domain with
no brand history takes 6–10 weeks before `coinliqui` returns the site first.

---

## Steps that fail silently

A wrong click here does not produce an error. It produces a site that looks completely
correct with something quietly missing, and the symptom shows up weeks later looking like
something else. Three of these used to be silent and are now loud — the rest still need a
deliberate check.

### Now loud — you cannot get past them

| Was silent | What it used to do | What happens now |
|---|---|---|
| `SITE_URL` with a trailing slash, `http://`, `www.`, or a `pages.dev` host | Built cleanly. The host guard then decided the live domain was *not* canonical and served `noindex, nofollow` on every page. Site perfect, invisible, discovered in week 3 with nothing on the site to see. | **The build fails in 20 seconds** with the exact reason. All six malformed shapes are rejected. |
| KV binding missing, misnamed, or added without the re-deploy | The site fell back to calling the upstream API on **every request**. Looked perfect at low traffic; the architecture guarantee was void; it would have collapsed under the first crawl. | **Pages return 503** with the cold-start notice, and `/status` prints `SNAPSHOT — MISSING`. |
| A `worker-dist` bundle older than the source | The worker kept running and kept writing *something*, so timestamps updated normally. Whatever the newer worker was meant to write was simply absent — an empty chart panel, not a deploy error. | The worker writes a **build stamp** on every run and `/status` shows `Worker bundle — STALE` with both values. |

### Still silent — check them deliberately

| Step | Wrong click | Symptom | How to catch it |
|---|---|---|---|
| **10** | Any one bot setting left on | The site is flawless in a browser and invisible to crawlers. **This is the DeFiLlama failure.** | The four `curl` checks in §10. Nothing in the dashboard tells you. |
| **10** | Cloudflare *Managed robots.txt* left on | Cloudflare appends AI-blocking rules to the file we serve. `robots.txt` looks fine until you read to the end. | Open `https://coinliqui.com/robots.txt` and read the **whole** file. |
| **9** | `www` added as a custom domain, redirect rule not created — or created and not **Deployed** | Both hostnames serve 200. Google splits the site in two and picks one. | `curl -sI https://www.coinliqui.com/` must return `301`, not `200`. |
| **6** | D1 binding missed, KV added | Every page renders correctly forever. No funding history accrues, and the flip feed stays empty. | `/status` → `DB — MISSING`. Also `SELECT COUNT(*) FROM funding_snapshot` stops climbing. |
| **6** | Cron trigger typed but **Add** not clicked | Step 7's manual `/ingest` succeeds, so everything looks right. Data then freezes five minutes later. | `/status` → snapshot age over 15 min turns red. Check it an hour after deploy, not immediately. |
| **4** | Only the first SQL statement executed in the D1 console | `funding_snapshot` exists, `upstream_check` does not. Ingest keeps working; the canary silently writes nothing. | `/status` → *Canary table unreadable*. |
| **8** | Env var or bindings set on Preview only, or Production only | Cloudflare keeps the two sets separate. One environment works and the other does not, and you will be looking at the one that works. | Set both. Then check the **production** URL, not a preview deployment. |
| **13** | Search Console property added as *URL prefix* instead of *Domain* | Verifies and reports — on a subset of hostnames. Numbers look plausible and are incomplete. | The left-hand box on the add-property screen, not the right. |
| **13** | Sitemap submitted before step 9 | Teaches Google the `pages.dev` hostname, which then has to be migrated away from. | Submit only after the apex resolves. |
| **11** | Email Routing destination never confirmed | Rule shows as created. Mail to `hello@` is discarded with no bounce. | Cloudflare marks the destination *unverified* — send yourself a test. |

### The one-minute check, an hour after deploy

Open `https://coinliqui.com/status`. Everything above that can be caught from inside the
site is on that page: both bindings, the worker build stamp, snapshot age, per-venue
coverage and the last 24 canary runs. If those are green, the only thing left that can
still be silently wrong is bot protection — and that is what §10's four `curl` checks are
for.

---

## What is already done, that you do not have to do

- The build is verified against `https://coinliqui.com`: 42 URLs across 7 sitemaps, every
  one resolving, every one on the apex, and **zero occurrences of any `pages.dev` or
  `localhost` origin anywhere in the build output**.
- The host guard is verified: on any hostname that is not `SITE_URL`, `robots.txt` returns
  `Disallow: /` and every response carries `X-Robots-Tag: noindex, nofollow`.
- D1 migrations are consolidated into one pasteable file.
- The worker is bundled to a single file with no build step, rebuilt from the current
  source on 14 Aug 2026 — it includes the funding-history accumulation the price chart
  needs.
- Cron schedule, canary table and `/status` are built.
- Pages read KV only. Verified in the compiled output: the page passes `false` for the dev
  read-through, so with a KV binding present an upstream outage can make the timestamp
  older and nothing else.
- No accounts, no notification channel, no secrets to provision.

## Weekly report credentials

Both sections of the weekly report degrade to "not available" without these, and the site is
unaffected either way — nothing a reader sees depends on them.

These steps used to be printed by the report itself, which meant `/status/indexation` published
the console path, the required permission level and the exact `wrangler secret put` commands on
the open web. That page is `noindex`, but noindex is not access control: it is fetchable by
anyone who asks. No credential was ever exposed, but a map of which credentials exist and how
they are installed was. It lives here now.

**B. Search Console — `GSC_SA_KEY`**

1. Google Cloud console: create a project, enable the **Google Search Console API**, create a
   **service account**, download a **JSON key**.
2. Search Console → the `coinliqui.com` Domain property → Settings → Users and permissions →
   Add user: the service account's `client_email`, permission **Owner**.
3. `npx wrangler secret put GSC_SA_KEY`, paste the whole JSON key file.

Owner, not Full. Search Analytics works for any verified user, but the URL Inspection API used
for the per-template indexed share is owner-only and returns `PERMISSION_DENIED` for a Full
user. A service account added as a delegated owner is the supported arrangement.

**C. Crawler fetches — `CF_ANALYTICS_TOKEN`, `CF_ZONE_ID`**

A Cloudflare token scoped to this zone with **Analytics → Read**, then
`npx wrangler secret put CF_ANALYTICS_TOKEN` and `npx wrangler secret put CF_ZONE_ID`.
