import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Load pg from node_modules at runtime instead of bundling it (its native bindings are optional).
  serverExternalPackages: ['pg'],
  // Shop photos from Wikimedia Commons (the demo shop's openly licensed pictures): fetched once by the
  // image optimizer, then served resized from this site instead of asking Wikimedia on every visit.
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'upload.wikimedia.org', pathname: '/wikipedia/commons/**' }],
  },
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
