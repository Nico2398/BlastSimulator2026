import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'tests/integration/full-level/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/**/*.d.ts',
        'src/**/__tests__/**',
        'src/**/__mocks__/**',
        'src/audio/**',
        'src/renderer/**',
        'src/ui/**',
        'src/persistence/**',
        'src/console/commands/**',
        'src/console/ConsoleFormatter.ts',
        'src/core/i18n/**',
        'src/core/events/FollowUpEvents.ts',
        'src/core/events/OreReportEvents.ts',
        'src/core/events/TrafficJamEvents.ts',
        'src/core/events/UnqualifiedTaskEvents.ts',
        'src/main.ts',
        'src/console.ts',
      ],
      thresholds: {
        perFile: true,
        statements: 60,
        branches: 45,
        functions: 40,
        lines: 60,
      },
    },
  },
});
