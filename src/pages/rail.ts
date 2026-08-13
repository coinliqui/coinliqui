import type { APIRoute } from "astro";

/**
 * Rail collapse state, stored in a cookie and applied during server rendering.
 *
 * Deliberately a form POST rather than client-side state: the collapsed/expanded class is
 * decided on the server, so there is no flash and no layout shift, and a crawler — which
 * sends no cookie — always receives the expanded rail with visible labels.
 */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const collapsed = form.get("collapsed") === "1";
  cookies.set("rail", collapsed ? "0" : "1", {
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
