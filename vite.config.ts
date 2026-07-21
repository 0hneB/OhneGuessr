import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [svelte()],
  // MapLibre is intentionally lazy-loaded with the game; its minified bundle is
  // large but only ~287 kB compressed, so splitting it again adds no useful win.
  build: { chunkSizeWarningLimit: 1100 },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/data': 'http://127.0.0.1:8000'
    }
  }
});
