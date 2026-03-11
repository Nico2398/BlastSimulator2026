import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
  server: {
    port: 5173,
  },
  test: {
    // Run in Node.js — core logic tests require no browser
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
});
