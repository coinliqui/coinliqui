import type { APIRoute } from "astro";

/**
 * Rail collapse state, stored in a cookie and applied during server rendering.
 *
 * Deliberately a form POST rather than client-side state: the collapsed/expanded class is
 * decided on the server, so there is no flash and no layout shift, and a crawler — which
 * sends no cookie — always receives the expanded rail with visible labels.
 */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  /* THE BUTTON NO LONGER SENDS THE STATE, so this reads it. That is not a refactor for its own
     sake: the value the button used to submit was rendered from the cookie, which made the
     document differ per visitor and forced `Vary: Cookie` on every response. Toggling here
     leaves the markup identical for everyone and the response cacheable. */
  const nowCollapsed = cookies.get("rail")?.value === "0";
  cookies.set("rail", nowCollapsed ? "1" : "0", {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  const referer = request.headers.get("referer");
  let back = "/";
  if (referer) {
    try {
      back = new URL(referer).pathname || "/";
    } catch {
      /* keep default */
    }
  }
  return redirect(back, 303);
};
