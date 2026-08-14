# Deploying Basis — dashboard only

Every step below is a web UI. No terminal, no CLI, no wrangler.

**Order matters.** Data must be flowing *before* the domain is attached. The point of
deploying now is to start accruing funding history, and history cannot be backfilled — but
you also do not want Google to meet the site on a `*.pages.dev` hostname. So: worker and
database first, DNS last.

Total: about 45 minutes, all of it free tier.

---

## 0. What to buy, before anything else

**Buy one domain.** Register it at **Cloudflare Registrar** (Dashboard → Domain
Registration → Register Domain). Cloudflare sells at wholesale cost with no markup and
includes WHOIS privacy, and buying it there means the DNS zone is already in the account —
which removes the entire nameserver step below.

If you buy elsewhere (Porkbun and Namecheap are both fine), you must then point the
domain's **nameservers** at Cloudflare — the registrar gives you two `*.ns.cloudflare.com`
addresses when you add the site. Nothing else works: Cloudflare Pages custom domains
require Cloudflare to be authoritative for the zone.

**What to buy:**

- `.com` if you can get it. Not `.io` (rising renewals, and it has a live ccTLD-retirement
  question hanging over it), not `.xyz` or `.finance` (spam-adjacent in this niche).
- One or two words, no hyphens, no numbers.
- **Do not buy a "Basis" domain on my say-so.** "Basis" is a working name in the code, not
  a cleared one — it is a common financial term and almost certainly conflicts. Run the
  name through the [USPTO TESS search](https://tmsearch.uspto.gov/) and the
  [EUIPO register](https://euipo.europa.eu/eSearch/) before you spend money. Renaming
  after launch means redirecting every indexed URL, which is exactly the cost we are
  deploying early to avoid.

**Where DNS points:** nowhere yet. You attach the domain in step 8, and Cloudflare creates
the record itself. Do not hand-create an A record to an IP — there isn't one.

---

## 1. Cloudflare account

1. Sign up at **dash.cloudflare.com** — free plan.
2. Verify the email. Enable 2FA (My Profile → Authentication) before anything is attached
   to this account.

Nothing here costs money and nothing below leaves the free tier.

---

## 2. KV namespace — where pages read from

1. Dashboard → **Storage & Databases → KV**.
2. **Create namespace**. Name it `basis-snapshot`.
3. Copy the **Namespace ID** into a scratch note. You need it twice.

---

## 3. D1 database — the history that cannot be backfilled

1. Dashboard → **Storage & Databases → D1 SQL Database**.
2. **Create database**. Name it exactly `basis`.
3. Copy the **Database ID** into your note.
4. Open the database → **Console** tab.
5. Open `db/paste-into-d1-console.sql` from the repo, copy the whole file, paste it into
   the console, and run it.
6. Confirm two tables now exist: `funding_snapshot` and `upstream_check`.

---

## 4. The ingest worker

1. Dashboard → **Compute (Workers) → Create → Start with Hello World** → **Deploy**.
   Name it `basis-ingest`.
2. Click **Edit code**.
3. Open `worker-dist/ingest.bundle.js` from the repo. Select all, copy, and replace the
   entire contents of the editor with it. **Deploy**.

   *(This file is a build artifact committed on purpose, so it can be copied from GitHub's
   web UI without a build step.)*

4. Worker → **Settings → Bindings → Add**:
   - **KV namespace** — variable name `SNAPSHOT`, namespace `basis-snapshot`.
   - **D1 database** — variable name `DB`, database `basis`.

   The variable names must be exactly `SNAPSHOT` and `DB`.

5. Worker → **Settings → Triggers → Cron Triggers → Add**: `*/5 * * * *` (every 5 minutes).

---

## 5. Start the clock

1. Open `https://basis-ingest.<your-subdomain>.workers.dev/ingest` in a browser tab.
2. You should get JSON with `"ok": true` and roughly 75 rows.
3. Go back to the D1 console and run:
   ```sql
   SELECT COUNT(*) FROM funding_snapshot;
   ```
   Non-zero means history is accruing. **From this moment the 24-hour clock on the flip
   feed is running**, whether or not the site is public.

If `ok` is false, the JSON carries the upstream status and error string. Nothing else in
this checklist depends on it succeeding, but don't continue until it does — a deployed site
with an empty store serves 503s.

---

## 6. GitHub repository — public

1. **github.com/new**.
2. Name it `basis`. Set it to **Public**.
3. Do not add a README, .gitignore or licence — the repo already has them.
4. Create.

Public is deliberate: GitHub Actions minutes are unlimited only on public repos, and that
is where OG image rendering and any heavy ETL will run. Private would meter all of it.

**Before you make it public, know what is in it.** I checked: no credential patterns, no
`.env`, no `.dev.vars`, 49 files. The KV and D1 IDs in `wrangler.toml` are identifiers, not
secrets — they are reachable only through a binding on a Worker inside your account. There
are no API keys anywhere in this project because the site reads public market data and
stores nothing private.

Pushing the local repository needs a terminal once. If you want to stay GUI-only, use
**GitHub Desktop** → Add Local Repository → `~/Documents/basis` → Publish repository
(uncheck "Keep this code private").

---

## 7. The Pages project

1. Dashboard → **Compute (Workers) → Pages → Connect to Git**.
2. Authorise GitHub, pick the `basis` repo.
3. Build settings:
   - Framework preset: **Astro**
   - Build command: `npm run build`
   - Build output directory: `dist`
4. **Environment variables → Add** (Production *and* Preview):
   - `SITE_URL` = `https://yourdomain.com` — the final domain, exactly, no trailing slash.
5. **Save and Deploy.**

> **`SITE_URL` is not optional.** The build throws if it is missing on Cloudflare. That is
> deliberate: without it, canonicals and the sitemap would point at a placeholder while the
> site is live on `*.pages.dev`, which is how indexing starts on a URL you later have to
> migrate away from. A failed build is the cheaper outcome.

6. After the first deploy: **Settings → Bindings → Add** the same two bindings as the
   worker — KV `SNAPSHOT` → `basis-snapshot`, D1 `DB` → `basis`. Then **Deployments →
   Retry deployment**, because bindings only attach on a fresh deploy.

At this point `https://basis-xxx.pages.dev` works, and it serves
`robots.txt` containing `Disallow: /` plus an `X-Robots-Tag: noindex` header on every
response, because the request host does not match `SITE_URL`. That is intended. It stays
that way until the real domain is attached.

---

## 8. Attach the domain

1. If the domain is not in this account: Dashboard → **Add a site**, enter the domain, pick
   **Free**, and set the nameservers at your registrar as instructed. Wait for "Active"
   (minutes to a few hours).
2. Pages project → **Custom domains → Set up a custom domain**.
3. Enter the apex, `yourdomain.com`. Cloudflare creates the CNAME itself (flattened at the
   apex). Accept it.
4. Add `www.yourdomain.com` as a second custom domain.
5. Decide which one is canonical — **use the apex**, since `SITE_URL` is the apex. Then
   Dashboard → **Rules → Redirect Rules → Create**:
   - When incoming requests match: `Hostname equals www.yourdomain.com`
   - Then: **Dynamic redirect**, 301, expression
     `concat("https://yourdomain.com", http.request.uri.path)`

   Two hostnames serving the same content with no redirect is a duplicate-content split.

6. Wait for the certificate to say **Active** (usually under 15 minutes).

The moment the apex resolves, `robots.txt` flips to the full crawler allowlist and the
`noindex` header disappears — the host guard is what did that, automatically.

---

## 9. Bot protection — the settings that decide whether this project is visible at all

This is the step that matters most and is easiest to skip. DeFiLlama is effectively
invisible to AI assistants because of settings like these. Go to the **domain's** dashboard
(not the Pages project) and confirm every one:

| Where | Setting | Must be |
|---|---|---|
| Security → Bots | **Bot Fight Mode** | **OFF** — it challenges non-browser traffic, which is every crawler we want |
| Security → Settings | **Block AI bots** / AI Scrapers and Crawlers | **OFF** — this is the DeFiLlama failure exactly |
| Security → Settings | **AI Labyrinth** | **OFF** — feeds crawlers decoy pages |
| Security → Settings | **Security Level** | **Medium** or lower. Never "I'm Under Attack" — it challenges Googlebot |
| Security → Settings | **Browser Integrity Check** | **OFF** — it drops clients with unusual user agents |
| Scrape Shield | **Managed robots.txt** | **OFF** — Cloudflare would otherwise append AI-blocking rules to the file we serve |
| Security → WAF | Custom rules | none blocking by user agent or ASN |
| Security → Settings | Rate limiting | none on `/sitemaps/*` or `/robots.txt` |

Then verify from outside, in a browser:

- `https://yourdomain.com/robots.txt` → the full allowlist, ending with a `Sitemap:` line
  on your real domain.
- `https://yourdomain.com/sitemap-index.xml` → 5 child sitemaps, 38 URLs total.
- `https://yourdomain.com/status` → snapshot age under 15 minutes, per-venue row counts all
  non-zero.

---

## 10. R2 bucket — create it now, use it later

Needed for OG images. Making it now means the next task has nothing blocking it.

1. Dashboard → **R2 → Create bucket**. Name it `basis-og`. Location: automatic.
2. Bucket → **Settings → Public access → Connect a domain** → `img.yourdomain.com`.
   Cloudflare creates the DNS record.

Free tier: 10 GB storage, 1M writes/month. OG images are a few hundred KB total.

---

## 11. Search Console — start the indexing clock

1. **search.google.com/search-console** → Add property → **Domain** → `yourdomain.com`.
2. It asks for a TXT record. Cloudflare DNS → Records → Add → TXT, paste, save. Verify.
3. Sitemaps → submit `sitemap-index.xml`.
4. Bing Webmaster Tools (**bing.com/webmasters**) — import directly from Search Console.
   Worth doing: Bing's index feeds ChatGPT search.

Submit sitemaps **only after** step 8. Submitting while the site is on `pages.dev` teaches
Google the wrong hostname.

---

## What is already done, that you do not need to do

- D1 migrations are written and consolidated into one pasteable file.
- The worker is bundled to a single file with no build step.
- Cron schedule, canary table and `/status` are built.
- `robots.txt`, sitemaps and canonicals derive from `SITE_URL` — nothing is hardcoded, and
  no `*.pages.dev` origin appears anywhere in the build output.
- The git repository is initialised with a `.gitignore` covering `.env`, `.dev.vars`,
  `.wrangler` and `dist`, and four commits of history.
- Pages read KV only. An upstream outage can make the timestamp older and nothing else.
