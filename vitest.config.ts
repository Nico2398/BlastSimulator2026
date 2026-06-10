import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // TODO: implementer will fill in actual coverage thresholds
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/**/*.d.ts',
        'src/**/__tests__/**',
        'src/**/__mocks__/**',
      ],
      thresholds: {
        perFile: true,
        statements: 0,
        branches: 0,
        functions: 0,
        lines: 0,
      },
    },
  },
});
