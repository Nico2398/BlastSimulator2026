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
      // Everything in src/ is measured except these. The list is short on
      // purpose: it used to hold `src/ui/**`, `src/renderer/**`,
      // `src/console/commands/**`, `src/audio/**`, `src/persistence/**` and
      // `src/core/i18n/**` — a third of the tree, which meant the coverage
      // number described a slice rather than the codebase. What is left are
      // files a Node test run cannot meaningfully execute, plus one that has
      // no executable code at all.
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/**/*.d.ts',
        'src/**/__tests__/**',
        'src/**/__mocks__/**',

        // Entry points. Both construct the whole application against a live
        // host — a DOM and a WebGL context for main.ts, a TTY for console.ts —
        // so what they do is proven by the `scenario` and `visual` channels,
        // which drive them in a real browser, not by the unit suite.
        'src/main.ts',
        'src/console.ts',

        // Thin wrappers over host APIs that exist only in a browser: a
        // WebGLRenderer and its post-processing passes, an AudioContext, an
        // IndexedDB connection, an anchor-click download. A unit test here
        // asserts against a mock of the API, not against our own behaviour.
        'src/renderer/SceneManager.ts',
        'src/renderer/post/PostPipeline.ts',
        'src/audio/AudioHooks.ts',
        'src/persistence/IndexedDBPersistence.ts',
        'src/persistence/DownloadPersistence.ts',

        // A constants table — string keys, no functions, no branches. Nothing
        // imports it today either, so it is a candidate for deletion rather
        // than for tests.
        'src/core/i18n/keys.ts',
      ],
      thresholds: {
        // Applied to every file individually, not to the codebase average:
        // one neglected file fails the run even while the total looks healthy.
        perFile: true,

        // The floor for every measured file that is not named below.
        statements: 85,
        branches: 75,
        functions: 65,
        lines: 85,

        // Event definition tables — the `*Events*.ts` files only, not the
        // machinery beside them (EventResolver, EventSystem, EventBuilder,
        // EventPool, MafiaActions all hold the floor above and are matched by
        // none of this). Their module bodies are fully executed, so statements
        // and branches stay high; `functions` counts whether each event's own
        // handler was invoked, and those fire through the scenario channel
        // rather than the unit suite.
        'src/core/events/*Events*.ts': { statements: 95, branches: 90, functions: 0, lines: 95 },

        // ── Coverage debt ──
        // Each entry is a file that cannot meet the floor above today, pinned
        // just under where it actually sits so it cannot get worse while its
        // tests are written. These are not exemptions: delete the entry once
        // the file clears the floor, and the floor applies to it again.
        'src/console/commands/mining/ramp.ts': { statements: 95, branches: 65, functions: 100, lines: 95 },
        'src/core/nav/Pathfinding.ts': { statements: 80, branches: 90, functions: 90, lines: 80 },
        'src/core/weather/WeatherEffects.ts': { statements: 70, branches: 75, functions: 75, lines: 70 },
        'src/renderer/GameRendererBlastVisuals.ts': { statements: 85, branches: 65, functions: 100, lines: 85 },
        'src/renderer/GameRendererPicking.ts': { statements: 75, branches: 100, functions: 40, lines: 75 },
        'src/renderer/GameRendererTerrain.ts': { statements: 85, branches: 55, functions: 70, lines: 85 },
        'src/renderer/SelectionOverlay.ts': { statements: 85, branches: 70, functions: 85, lines: 85 },
        'src/ui/BuildMenu.ts': { statements: 75, branches: 70, functions: 55, lines: 75 },
        'src/ui/MiniMap.ts': { statements: 65, branches: 100, functions: 60, lines: 65 },
        'src/ui/UIManager.ts': { statements: 85, branches: 65, functions: 50, lines: 85 },
        'src/ui/accidentLookup.ts': { statements: 100, branches: 70, functions: 100, lines: 100 },
        'src/ui/miniMapLayers.ts': { statements: 40, branches: 50, functions: 10, lines: 40 },
        'src/ui/panels/blastSteps/Drill.ts': { statements: 90, branches: 90, functions: 60, lines: 90 },
        'src/ui/scene/PlacementKit.ts': { statements: 95, branches: 60, functions: 100, lines: 95 },
        'src/ui/shell/ActivityLog.ts': { statements: 65, branches: 80, functions: 50, lines: 65 },
        'src/ui/shell/SelectionBar.ts': { statements: 95, branches: 90, functions: 45, lines: 95 },
        'src/ui/shell/Toasts.ts': { statements: 50, branches: 80, functions: 60, lines: 50 },
        'src/ui/uiActionProbe.ts': { statements: 80, branches: 65, functions: 60, lines: 80 },
      },
    },
  },
});
