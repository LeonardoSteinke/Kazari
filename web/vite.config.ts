import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const BUILD_ID = env?.BUILD_ID || new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
function versionFile(): Plugin {
  return { name: 'kazari-version-file', apply: 'build', generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
  } };
}

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react(), versionFile(), VitePWA({
    registerType: 'autoUpdate', includeAssets: ['brand/app-icon.svg','brand/header.svg','apple-touch-icon.png','icons/ajustes.svg','icons/catalogo.svg','icons/categorias.svg','icons/lixeira.svg','icons/sem-itens.svg'],
    manifest: {
      name: 'Kazari — Catálogo pessoal', short_name: 'Kazari', description: 'A casa, peça por peça.',
      theme_color: '#F6F1E7', background_color: '#F6F1E7', display: 'standalone', orientation: 'portrait', start_url: '/', scope: '/',
      icons: [
        { src: '/brand/app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      skipWaiting: true, clientsClaim: true, cleanupOutdatedCaches: true,
      globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2}'],
      navigateFallbackDenylist: [/^\/api/], globIgnores: ['**/version.json'],
      runtimeCaching: [{ urlPattern: ({ url }) => url.pathname.startsWith('/api/'), handler: 'NetworkOnly' }],
    },
  })],
  server: { host: true, proxy: { '/api': 'http://localhost:3000' } },
});

