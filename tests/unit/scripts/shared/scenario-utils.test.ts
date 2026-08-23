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

import { describe, it, expect, vi } from 'vitest';
import { resolve } from 'path';
import {
  effectiveStepTimeoutMs,
  collectScenarioViolations,
  formatScenarioViolations,
  SCENARIO_DIR,
  type ScenarioViolation,
} from '../../../../scripts/shared/scenario-utils.js';
import type { ScenarioDef, ScenarioStepDef } from '../../../../scripts/shared/scenario-types.js';

// collectScenarioViolations always reads scenario files through
// loadScenarioDef(name) with no dir override — it hardcodes SCENARIO_DIR the
// same way loadScenarioDef's own default does. So a unit test that wants
// controlled, multi-file fixture content (rather than whatever real files
// happen to live in scripts/scenario-defs/ today) has to intercept the fs
// reads loadScenarioDef makes, keyed by the exact resolved path it computes
// (`resolve(SCENARIO_DIR, \`${name}.json\`)`), and fall through to the real
// filesystem for every other path — mirroring how loadScenarioDef itself
// resolves paths (scripts/shared/scenario-utils.ts).
const fixtures = vi.hoisted(() => new Map<string, string>());

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readFileSync: (path: unknown, encoding?: BufferEncoding) => {
      const key = String(path);
      if (fixtures.has(key)) return fixtures.get(key)!;
      return actual.readFileSync(path as never, encoding as never);
    },
    existsSync: (path: unknown) => {
      const key = String(path);
      if (fixtures.has(key)) return true;
      return actual.existsSync(path as never);
    },
  };
});

/** Registers a fixture scenario file `loadScenarioDef` will read back from SCENARIO_DIR. */
function registerScenario(name: string, steps: ScenarioStepDef[]): void {
  const def: ScenarioDef = { name, description: `fixture: ${name}`, steps };
  fixtures.set(resolve(SCENARIO_DIR, `${name}.json`), JSON.stringify(def));
}

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

  // zoomOut/focusTile/clickEntity carry no `timeoutMs` field on their own
  // type (unlike awaitUsable, which shares their real 6000ms inner deadline
  // via interaction-driver.ts's DEFAULT_TIMEOUT_MS) -- a code-review round
  // on PR #638 found DEFAULT_INNER_TIMEOUT_MS's entries for these three were
  // unreachable dead code because of exactly that, contradicting this
  // function's own doc comment. These three low-declared-timeout cases would
  // have reproduced PR #616's own outer-race bug for a step whose only
  // action was one of them.
  it.each(['zoomOut', 'focusTile', 'clickEntity'] as const)(
    'derives past a low declared timeout for a lone %s action, via its 6000ms default',
    (type) => {
      const action = type === 'zoomOut' ? { type }
        : type === 'focusTile' ? { type, x: 1, z: 1 }
        : { type, kind: 'building' as const, id: 1 };
      const s = step({ timeout: 3, interaction: [action] });
      expect(effectiveStepTimeoutMs(s, DEFAULT_OUTER_SECONDS)).toBe(6000 + 5000);
    },
  );
});

describe('collectScenarioViolations', () => {
  it('collects matching steps across multiple scenario files, in file/step order', () => {
    registerScenario('fixture-alpha', [
      step({ command: 'new_game seed:1' }),
      step({ command: 'blast' }),
    ]);
    registerScenario('fixture-beta', [
      step({ command: 'tick 1' }),
      step({ command: 'blast' }),
      step({ command: 'blast' }),
    ]);

    const violations = collectScenarioViolations(
      (s) => s.command === 'blast',
      ['fixture-alpha', 'fixture-beta'],
    );

    expect(violations).toEqual<ScenarioViolation[]>([
      { file: 'fixture-alpha', stepIndex: 1, command: 'blast' },
      { file: 'fixture-beta', stepIndex: 1, command: 'blast' },
      { file: 'fixture-beta', stepIndex: 2, command: 'blast' },
    ]);
  });

  it('returns an empty array when scenarioNames is explicitly empty', () => {
    expect(collectScenarioViolations(() => true, [])).toEqual([]);
  });

  it('returns an empty array when the predicate matches nothing', () => {
    registerScenario('fixture-gamma', [
      step({ command: 'new_game seed:1' }),
      step({ command: 'tick 1' }),
    ]);

    expect(collectScenarioViolations(() => false, ['fixture-gamma'])).toEqual([]);
  });
});

describe('formatScenarioViolations', () => {
  it('formats a single violation as one indented line, no describeExtra', () => {
    const violations: ScenarioViolation[] = [
      { file: 'blast-basic', stepIndex: 3, command: 'blast' },
    ];
    expect(formatScenarioViolations(violations)).toBe(
      '  blast-basic.json step[3] ("blast")',
    );
  });

  it('joins multiple violations with newlines, in the order given', () => {
    const violations: ScenarioViolation[] = [
      { file: 'blast-basic', stepIndex: 3, command: 'blast' },
      { file: 'survey-then-blast', stepIndex: 0, command: 'new_game seed:1' },
    ];
    expect(formatScenarioViolations(violations)).toBe(
      '  blast-basic.json step[3] ("blast")\n'
      + '  survey-then-blast.json step[0] ("new_game seed:1")',
    );
  });

  it('returns an empty string for an empty violation list', () => {
    expect(formatScenarioViolations([])).toBe('');
  });

  it("appends describeExtra's return value verbatim, right after the closing paren, with no injected separator", () => {
    const violations: ScenarioViolation[] = [
      { file: 'blast-basic', stepIndex: 3, command: 'blast' },
    ];
    expect(
      formatScenarioViolations(violations, () => ' refused: boom'),
    ).toBe('  blast-basic.json step[3] ("blast") refused: boom');
  });
});
