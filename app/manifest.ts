import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FitCheck',
    short_name: 'FitCheck',
    description: '给认真举铁的人，一块干净的力量训练仪表。',
    start_url: '/train',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0e0f10',
    theme_color: '#0e0f10',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
