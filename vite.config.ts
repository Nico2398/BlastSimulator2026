import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
    // Itch.io deployment: inline small assets, chunk split for Three.js
    assetsInlineLimit: 4096,
    // Produce a minimal asset structure suitable for itch.io zip upload
    rollupOptions: {
      output: {
        // Split vendor (Three.js) from game code for better caching
        manualChunks: (id) => {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/cannon-es')) return 'physics';
          if (id.includes('node_modules/simplex-noise')) return 'noise';
        },
      },
    },
    // Generate source maps for debugging (can be excluded from itch.io zip)
    sourcemap: false,
    // Minify for smaller download size
    minify: 'esbuild',
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
