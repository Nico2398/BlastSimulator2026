import { describe, it, expect } from 'vitest';
import type { ScenarioStepDef } from '../../scripts/shared/scenario-types.js';
import { loadScenarioDef, SCENARIO_DIR } from '../../scripts/shared/scenario-utils.js';
import { checkStepActionAllowed } from '../../scripts/shared/interaction-executor.js';

// Narrow per-scenario regression locks (#514, #694) — split out of
// tests/unit/scenario-defs.test.ts (#703).
// TODO: implement — real describe blocks land here in the next phase.

describe.skip('The 3 known un-converted player steps are converted to real UI interactions (#514)', () => {});
describe.skip('blast-visual-full.json H1/H2 charge-override steps click the per-hole button with clickIfPresent (#694)', () => {});
