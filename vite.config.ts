import { defineConfig } from 'vite';

export default defineConfig({
  // 상대 경로: GitHub Pages(https://<user>.github.io/<repo>/) 같은 하위 경로에서도 동작
  base: './',
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } },
  },
  preview: {
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: { include: ['tests/**/*.test.ts'] },
} as never);
