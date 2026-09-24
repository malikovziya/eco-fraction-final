import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The floating dev badge would overlap demo UI on stage
  devIndicators: false,
};

export default nextConfig;
