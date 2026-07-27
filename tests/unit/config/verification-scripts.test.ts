// BlastSimulator2026 — Verification channel npm scripts
// Every verification channel an agent is told to use must be reachable through
// a named npm script. A missing script silently removes a verification channel.

import { describe, it, expect } from 'vitest';
import pkg from '../../../package.json' with { type: 'json' };

const scripts = pkg.scripts as Record<string, string>;

describe('verification channel npm scripts', () => {
  it('exposes a preflight that reports channel availability', () => {
    expect(scripts['verify:env']).toContain('scripts/verify-env.ts');
  });

  it('exposes a context file validator', () => {
    expect(scripts['validate:context']).toContain('scripts/validate-context.ts');
  });

  it('typechecks both src/ and scripts/', () => {
    const script = scripts['typecheck'];
    expect(script).toContain('tsc --noEmit');
    expect(script).toContain('scripts/tsconfig.json');
  });

  describe('scenario channel', () => {
    it('runs a single scenario', () => {
      expect(scripts['scenario']).toContain('scripts/scenario-test.ts');
    });

    it('runs the full batch in command mode', () => {
      expect(scripts['scenarios']).toContain('scripts/run-all-scenarios.ts');
      expect(scripts['scenarios']).not.toContain('--mode interaction');
    });

    it('runs the full batch in interaction mode', () => {
      expect(scripts['scenarios:interaction']).toContain('scripts/run-all-scenarios.ts');
      expect(scripts['scenarios:interaction']).toContain('--mode interaction');
    });
  });

  describe('visual channel', () => {
    it.each([
      ['screenshot', 'scripts/screenshot.ts'],
      ['a11y', 'scripts/a11y-check.ts'],
      ['ui:diagnostic', 'scripts/ui-diagnostic.ts'],
      ['validate:state', 'scripts/validate-state-schema.ts'],
    ])('%s runs %s', (name, target) => {
      expect(scripts[name]).toContain(target);
    });
  });

  describe('playability channel', () => {
    it('runs the playtest harness', () => {
      expect(scripts['playtest']).toContain('scripts/playtest.ts');
    });
  });
});
