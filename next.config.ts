import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@openai/agents", "openai", "xlsx"],
  poweredByHeader: false,
  devIndicators: false,
};

export default nextConfig;
