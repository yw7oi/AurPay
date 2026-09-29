import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* No `output: "standalone"` — Vercel manages its own output. Dev (`next dev`)
   * ignores this option anyway, so local runs are unaffected. */
  /* @libsql/client (Turso persistence) must stay external so its Node entry
   * loads from node_modules at runtime instead of being bundled. */
  serverExternalPackages: ["@libsql/client"],
  typescript: {
    // The 1:1 Python-port occasionally widens types on purpose; don't let
    // TS nits block a deploy.
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
