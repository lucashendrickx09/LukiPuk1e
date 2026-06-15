import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// base: './' keeps asset URLs relative, so the same build works on Vercel,
// Netlify, and GitHub Pages project sites (served under /<repo>/) without
// needing to hard-code a repository name. See README for details.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    // Installable PWA: "Add to Home Screen" on iPhone, "Install" on Android /
    // desktop Chrome & Edge. autoUpdate swaps in new builds on next launch.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon-180x180.png', 'favicon-48x48.png'],
      manifest: {
        name: 'Study Calendar',
        short_name: 'Study',
        description: 'Personal IBDP summer study calendar — 17 Jun to 15 Aug.',
        theme_color: '#0d1117',
        background_color: '#0d1117',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
})
