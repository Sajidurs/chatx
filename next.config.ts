import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Default 1MB is too small for knowledge-source document uploads (PDF/docx).
    serverActions: { bodySizeLimit: "20mb" },
  },
  // The embed widget's floating bubble anchors to the same bottom-right
  // corner Next's own dev-mode indicator badge uses, inside the same small
  // iframe viewport -- the two overlap and the dev badge wins the click.
  // Dev-only, has no effect on production builds.
  devIndicators: false,
};

export default nextConfig;
