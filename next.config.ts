import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Render runs `next start`; nothing special needed. Keep server-only code out of client bundles.
  serverExternalPackages: [],
};

export default nextConfig;
