import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Dev-only: allow HMR + font resources when the app is opened via 127.0.0.1
  // (Next otherwise blocks them as cross-origin and the page never hydrates).
  allowedDevOrigins: ["127.0.0.1"],
  // three.js is a large client dependency; keep it out of the server bundle.
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
