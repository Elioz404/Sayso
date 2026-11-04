import type { NextConfig } from 'next';

const dev = process.env.NODE_ENV !== 'production';

// What pages may load and who may frame them. Next.js bootstraps with inline scripts, so scripts are
// limited to this site (plus eval in development, for hot reload); nothing can frame Sayso, so a page
// can't be dressed up around the approval buttons.
// The shopping assistant also loads PayPal's own checkout button (script, its frames and its API).
const PAYPAL = 'https://*.paypal.com https://*.paypalobjects.com';
const csp = (evalAllowed: boolean, paypal = false) => [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${evalAllowed ? " 'unsafe-eval'" : ''}${paypal ? ` ${PAYPAL}` : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${paypal ? ` ${PAYPAL}` : ''}`,
  ...(paypal ? [`frame-src ${PAYPAL}`] : []),
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = (evalAllowed = dev, paypal = false) => [
  { key: 'Content-Security-Policy', value: csp(evalAllowed, paypal) },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Cross-site requests get the origin only, never a path (some paths carry personal MCP keys).
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), publickey-credentials-get=(self), publickey-credentials-create=(self)' },
  ...(dev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }]),
];

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
  async headers() {
    return [
      // Everything but the generated developer portal (it brings its own scripts and styles) and the
      // Making board, whose scheduler component (Bryntum) compiles code at runtime, and the buyer's pages
      // (the shopping assistant, the shops), which load PayPal's checkout button.
      { source: '/((?!developers|owner/production|assistant|shops|shop/).*)', headers: securityHeaders() },
      { source: '/assistant', headers: securityHeaders(dev, true) },
      { source: '/shops', headers: securityHeaders(dev, true) },
      { source: '/shop/:path*', headers: securityHeaders(dev, true) },
      { source: '/owner/production', headers: securityHeaders(true) },
      { source: '/developers/:path*', headers: securityHeaders().filter((h) => h.key !== 'Content-Security-Policy') },
      // The service worker must always be fresh, or a fix to it would wait for the cache to expire.
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    ];
  },
};

export default nextConfig;
