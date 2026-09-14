import { defineNitroConfig } from "nitro/config";

export default defineNitroConfig({
  routeRules: {
    // Empêcher le cache navigateur sur les pages HTML (SPA/SSR).
    // Les assets statiques (JS/CSS) ont déjà un hash content-based dans leur nom.
    "/**": {
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    },
  },
});
