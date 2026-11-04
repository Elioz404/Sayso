// Sayso installs as an app on the owner's phone (Add to Home Screen): it opens on the shop, full
// screen, and can receive notifications. On Android, sharing a photo to Sayso drafts a product from it.
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/owner',
    name: 'Sayso',
    short_name: 'Sayso',
    description: 'Run your shop from your phone. Your agents ask; you give the say-so.',
    start_url: '/owner?source=app',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f6f2ec',
    theme_color: '#b04a22',
    categories: ['business', 'shopping', 'productivity'],
    icons: [
      { src: '/app-icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/app-icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/app-icon/maskable', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Waiting for you', short_name: 'Waiting', url: '/owner#waiting' },
      { name: 'Orders', url: '/owner/orders' },
      { name: 'Add from a photo', short_name: 'Add product', url: '/owner/catalog/new' },
    ],
    share_target: {
      action: '/owner/share',
      method: 'POST',
      enctype: 'multipart/form-data',
      params: { title: 'title', text: 'text', files: [{ name: 'photos', accept: ['image/*'] }] },
    },
  };
}
