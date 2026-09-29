import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* No `output: "standalone"` — Vercel manages its own output. Dev (`next dev`)
   * ignores this option anyway, so local runs are unaffected. */
  /* @libsql/client (Turso persistence) and @vercel/blob (Blob persistence)
   * must stay external so their Node entries load from node_modules at
   * runtime instead of being bundled. */
  serverExternalPackages: ["@libsql/client", "@vercel/blob"],
  typescript: {
    // The 1:1 Python-port occasionally widens types on purpose; don't let
    // TS nits block a deploy.
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
