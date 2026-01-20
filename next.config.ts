import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: false,
  turbopack: {
    rules: {
      // This tells Turbopack to use raw-loader for all .txt files
      "*.py": {
        loaders: ["raw-loader"],
        // 'as' is crucial: it tells Turbopack to treat the output as a JS module
        as: "*.js",
      },
    },
  },
};

export default nextConfig;
