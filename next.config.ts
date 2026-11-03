import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Load pg from node_modules at runtime instead of bundling it (its native bindings are optional).
  serverExternalPackages: ['pg'],
  // The APIMatic docs portal (public/developers) is a static site: each page is a folder with an
  // index.html. Files are served as they are; page URLs without an extension get their index.html.
  async rewrites() {
    return [
      { source: '/developers', destination: '/developers/index.html' },
      { source: '/developers/:path((?:(?!\\.).)*)', destination: '/developers/:path/index.html' },
    ];
  },
};

export default nextConfig;
