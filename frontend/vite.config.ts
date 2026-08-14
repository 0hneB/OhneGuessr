import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  plugins: [svelte()],
  server: { fs: { allow: ['..'] } },
  test: { include: ['src/**/*.test.ts', '../internal/plugins/**/*.test.ts', '../plugins/**/*.test.js'] },
  // MapLibre is intentionally lazy-loaded with the game; its minified bundle is
  // large but only ~287 kB compressed, so splitting it again adds no useful win.
  build: { chunkSizeWarningLimit: 1100 }
});
