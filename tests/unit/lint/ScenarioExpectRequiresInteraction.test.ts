// BlastSimulator2026 — every state-dependent scenario goal has a real
// interaction (issue #738)
//
// `executeInteractionActions` (scripts/shared/puppeteer-utils.ts) treats a
// missing/empty `interaction` array as a total no-op — it does NOT fall back
// to running the step's raw `command` string in-browser. A `role: 'player'`
// step whose `expect` asserts state (`equals`/`increased`/`decreased`/
// `changedBy`) but carries no `interaction` array therefore asserts against
// stale, unchanged page state in interaction mode.
//
// This suite is the structural lint closing that gap: same shape as
// `tests/unit/lint/ScenarioStepsHaveRole.test.ts` — walk every scenario file's
// every step, flag any step whose `expect` contains a state-dependent goal but
// has no non-empty `interaction` array.
//
// SKELETON PHASE (#738): stub only. @test-writer fills in the real
// assertions; @implementer edits scripts/scenario-defs/ore-haul-dispatch.json
// to satisfy them.

import { describe, it } from 'vitest';
import type { ScenarioStepDef } from '../../../scripts/shared/scenario-types.js';
import { scenarioFiles, loadScenarioDef, SCENARIO_DIR } from '../../../scripts/shared/scenario-utils.js';

// Re-exported for @test-writer: the real suite walks scenarioFiles(SCENARIO_DIR)
// and loads each via loadScenarioDef, the same pattern ScenarioStepsHaveRole.test.ts
// uses. Referenced here (not just imported) so the skeleton stays type-valid
// under noUnusedLocals until the real test body lands.
export const ALL_SCENARIO_NAMES: string[] = scenarioFiles(SCENARIO_DIR);
export const loadScenario = loadScenarioDef;

interface InteractionViolation {
  file: string;
  stepIndex: number;
  command: string;
}

// TODO: implement — format a violation list for a failure message, mirroring
// ScenarioStepsHaveRole.test.ts's formatViolations.
export function formatViolations(_violations: InteractionViolation[]): string {
  return undefined as unknown as string;
}

// TODO: implement — walk every scenario file's every step, collecting the
// ones for which `isViolation` returns true, mirroring
// ScenarioStepsHaveRole.test.ts's collectViolations.
export function collectViolations(
  _isViolation: (step: ScenarioStepDef) => boolean,
): InteractionViolation[] {
  return undefined as unknown as InteractionViolation[];
}

describe.skip('repo-wide — every state-dependent scenario goal has an interaction (issue #738)', () => {
  it.todo('sanity: the scenario directory is non-empty (guards against a silently broken glob)');

  it.todo(
    'every step whose expect has equals/increased/decreased/changedBy has a non-empty interaction array',
  );
});
