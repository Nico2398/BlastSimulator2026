// BlastSimulator2026 — Progression probe integration: reinvest against the opening
//
// Over 6000 ticks of one site, reinvesting fires strictly more blasts than the opening alone. Split from progression-probe.integration.test.ts so the probe's
// long runs execute in parallel (tests/helpers/progressionProbe.ts says why).

import { describe, it, expect } from 'vitest';
import { runProbe } from '../../scripts/shared/probe-strategies.js';
import { expectFiniteOrAllowedNull } from '../helpers/progressionProbe.js';

describe('progression probe integration', () => {
  it('reinvest fires strictly more blasts than the opening on the same setup (#1974)', () => {
    const base = { seed: 42, biome: 'desert_badlands', kit: 'digger', horizon: 6000 } as const;
    const opening = runProbe({ ...base, strategy: 'opening' });
    const reinvest = runProbe({ ...base, strategy: 'reinvest' });
    expectFiniteOrAllowedNull(reinvest, 6000);
    expect(reinvest.metrics.blastsFired).toBeGreaterThan(opening.metrics.blastsFired);
  }, 300000);
});
