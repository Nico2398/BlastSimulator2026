// BlastSimulator2026 — rebuilt scenario fixtures keep their original coverage (issue #1431)
//
// #1313 froze the mine once a level ends, which truncated several scenario
// fixtures. They were rebuilt so none ends in an unintended lose condition;
// the original step counts (pre-#1313, commit 633972b7) are the floor.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { SCENARIO_DIR } from '../../../scripts/shared/scenario-utils.js';

const MIN_STEPS: Record<string, number> = {
  'skill-progression': 72,
  'level2-playthrough-win': 188,
  'level3-playthrough-win': 78,
  'level1-playthrough-revolt': 92,
};

describe('rebuilt scenario fixtures restore original coverage (issue #1431)', () => {
  for (const [name, min] of Object.entries(MIN_STEPS)) {
    it(`${name} has at least ${min} steps`, () => {
      const def = JSON.parse(readFileSync(resolve(SCENARIO_DIR, `${name}.json`), 'utf-8')) as { steps: unknown[] };
      expect(def.steps.length).toBeGreaterThanOrEqual(min);
    });
  }
});
