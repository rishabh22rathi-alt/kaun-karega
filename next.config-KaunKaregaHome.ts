import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    WA_VERIFY_TOKEN: process.env.WA_VERIFY_TOKEN,
  },
  /* config options here */
};

export default nextConfig;