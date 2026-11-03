import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Load pg from node_modules at runtime instead of bundling it (its native bindings are optional).
  serverExternalPackages: ['pg'],
};

export default nextConfig;
