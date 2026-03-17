import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  // Add the VPS IP to allowed origins so Next.js doesn't block _next/ static files and Clerk scripts
  allowedDevOrigins: ["173.212.240.143", "localhost"],
};

export default nextConfig;
