// BlastSimulator2026 — effectiveStepTimeoutMs (item 4 of the PR #616 CI-gate
// follow-up)
//
// scenario-interaction-runner.ts / run-all-scenarios.ts / bench-scenarios.ts
// each race a step's own declared `timeout` (seconds) against every inner
// `interaction[].timeoutMs` (ms) independently, in a fresh `setTimeout`. When
// the declared value is lower, the outer race always wins regardless of what
// the inner action was actually waiting on, producing a generic
// "Step N timed out after 60000ms" instead of that action's own, more useful
// error — PR #616 fixed 53 files' worth of this by hand and still missed 12.
// effectiveStepTimeoutMs closes the class instead of the instances: the
// runners now race the *derived* value, so a new step with a large
// `timeoutMs` and no `timeout` of its own is correct by construction.

import { describe, it, expect } from 'vitest';
import { effectiveStepTimeoutMs } from '../../../../scripts/shared/scenario-utils.js';
import type { ScenarioStepDef } from '../../../../scripts/shared/scenario-types.js';

const DEFAULT_OUTER_SECONDS = 60;

const step = (over: Partial<ScenarioStepDef> = {}): ScenarioStepDef => ({
  command: 'tick 1',
  ...over,
});

describe('effectiveStepTimeoutMs', () => {
  it('falls back to the default outer timeout with no declared timeout and no interaction', () => {
    expect(effectiveStepTimeoutMs(step(), DEFAULT_OUTER_SECONDS)).toBe(60000);
  });

  it('uses the step\'s own declared timeout when no interaction needs more', () => {
    expect(effectiveStepTimeoutMs(step({ timeout: 30 }), DEFAULT_OUTER_SECONDS)).toBe(30000);
  });

  it('derives past the default when a waitUntil timeoutMs exceeds it, PR #616\'s exact shape', () => {
    // tutorial-interactive.json step 17, pre-fix: timeout absent (defaults to
    // 60s) but the waitUntil action underneath waited up to 180000ms.
    const s = step({
      interaction: [{ type: 'waitUntil', field: 'holeCount', equals: 9, maxTicks: 400, timeoutMs: 180000 }],
    });
    expect(effectiveStepTimeoutMs(s, DEFAULT_OUTER_SECONDS)).toBe(180000 + 5000);
  });

  it('keeps the declared timeout when it already covers the inner timeoutMs', () => {
    const s = step({
      timeout: 200,
      interaction: [{ type: 'waitUntil', field: 'holeCount', equals: 9, maxTicks: 400, timeoutMs: 180000 }],
    });
    expect(effectiveStepTimeoutMs(s, DEFAULT_OUTER_SECONDS)).toBe(200000);
  });

  it('takes the slowest of several interaction actions on the same step', () => {
    const s = step({
      interaction: [
        { type: 'resolveEventIfPending', timeoutMs: 90000 },
        { type: 'waitUntil', field: 'orderedChargeCount', equals: 0, maxTicks: 3000, timeoutMs: 30000 },
      ],
    });
    expect(effectiveStepTimeoutMs(s, DEFAULT_OUTER_SECONDS)).toBe(90000 + 5000);
  });

  it('applies resolveEventIfPending\'s own 30000ms default when timeoutMs is absent', () => {
    const s = step({ interaction: [{ type: 'resolveEventIfPending' }] });
    // 30000 + margin is still under the 60s default outer timeout, so the
    // declared default wins -- this is the ordinary case, not a derivation.
    expect(effectiveStepTimeoutMs(s, DEFAULT_OUTER_SECONDS)).toBe(60000);
  });

  it('does not derive anything from actions with no timeoutMs concept', () => {
    const s = step({ interaction: [{ type: 'click', x: 1, y: 1 }] });
    expect(effectiveStepTimeoutMs(s, DEFAULT_OUTER_SECONDS)).toBe(60000);
  });

  it('does not let a clickIfPresent\'s default-0 settle lower an otherwise-derived value', () => {
    const s = step({
      interaction: [
        { type: 'clickIfPresent', selector: '#x' },
        { type: 'waitUntil', field: 'f', equals: 1, maxTicks: 10, timeoutMs: 120000 },
      ],
    });
    expect(effectiveStepTimeoutMs(s, DEFAULT_OUTER_SECONDS)).toBe(120000 + 5000);
  });
});
