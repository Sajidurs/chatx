import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Default 1MB is too small for knowledge-source document uploads (PDF/docx).
    serverActions: { bodySizeLimit: "20mb" },
  },
};

export default nextConfig;
