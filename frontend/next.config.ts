import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  // Keep dev origins domain-based so production no longer depends on the retired VPS IP.
  allowedDevOrigins: ["localhost", "127.0.0.1", "clause.id", "www.clause.id"],
};

export default nextConfig;
