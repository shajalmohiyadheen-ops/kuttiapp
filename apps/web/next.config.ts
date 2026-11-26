import type { NextConfig } from "next";

// The admin app is fully signed-in and data changes constantly, so we keep
// classic dynamic rendering instead of Cache Components.
const nextConfig: NextConfig = {
  transpilePackages: ["@kuttiapp/shared"],
};

export default nextConfig;
