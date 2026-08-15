import type { APIRoute } from "astro";
import { IDENTITY, origin } from "../../lib/site.ts";

/**
 * RFC 9116 security.txt.
 *
 * Two reasons it is here. The first is the intended one: someone who finds a problem should
 * have an obvious, standard place to look for where to send it.
 *
 * The second is that it is a legitimacy signal, and this domain needs those. A site that
 * publishes a security contact, an expiry it has to keep current, and a preferred language is
 * doing something no throwaway clone bothers with — and "no throwaway clone bothers with it" is
 * precisely why automated assessments weigh it.
 *
 * EXPIRES IS COMPUTED, NOT TYPED. The RFC requires the field and an expired file is worse than
 * no file, because it reads as abandoned. Anything hardcoded here would be correct for a year
 * and then quietly wrong, which is this codebase's most familiar failure mode. A rolling
 * horizon from the request means the answer is always live and always honest.
 */
export const GET: APIRoute = async ({ site }) => {
  const base = origin(site);
  const expires = new Date(Date.now() + 180 * 86400_000).toISOString().replace(/\.\d{3}Z$/, "Z");

  const body = `# Security contact for ${base}
# This site holds no user accounts, funds or personal data — see ${base}/privacy —
# so the interesting reports are about incorrect data, or about this site being
# impersonated somewhere else. Both are welcome.

Contact: mailto:${IDENTITY.contact}
Expires: ${expires}
Preferred-Languages: en
Canonical: ${base}/.well-known/security.txt
Policy: ${base}/about

# Not affiliated with ${IDENTITY.notAffiliated.join(", ")}.
# ${base} is the only domain this project publishes. If you have found a site
# using this name at another address, that is a report we very much want.
`;

  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, s-maxage=3600" },
  });
};
