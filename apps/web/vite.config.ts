import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg'],
      manifest: {
        name: 'Cannopy GO',
        short_name: 'Cannopy',
        description: 'Simple bookkeeping for Myanmar small businesses',
        lang: 'my',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f6f8f4',
        theme_color: '#1b7f4b',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Cache the app shell and fonts so Sell, Spend and Get paid open without signal.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // API reads are network-first with a short fallback; writes never touch the cache.
            urlPattern: /^\/api\/.*$/i,
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_URL ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: { sourcemap: true },
  test: {
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
  },
});
