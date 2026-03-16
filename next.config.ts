import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: { serverActions: { allowedOrigins: ['localhost:3000'] } },
};

export default config;
