import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

// SSR, not SSG: every displayed number must be in the server HTML at first byte, and the
// data changes every few minutes. Static rebuilds cannot deliver that inside Cloudflare's
// 500-builds/month free tier, so pages render from KV at request time and are cached at
// the edge (s-maxage=120, stale-while-revalidate=600).
export default defineConfig({
  output: "server",
  adapter: cloudflare({ imageService: "passthrough" }),
  site: "https://basis.example",
  devToolbar: { enabled: false },
});
