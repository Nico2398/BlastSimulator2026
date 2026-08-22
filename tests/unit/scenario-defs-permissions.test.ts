import { describe, it, expect } from 'vitest';
import type { ScenarioStepDef } from '../../scripts/shared/scenario-types.js';
import { loadScenarioDef, SCENARIO_DIR } from '../../scripts/shared/scenario-utils.js';
import { checkStepActionAllowed, isAllowedBootstrapCommand } from '../../scripts/shared/interaction-executor.js';
import { ALL_SCENARIO_NAMES } from './scenario-defs-fixtures.js';

// checkStepActionAllowed / bootstrap-guard rule checks — split out of
// tests/unit/scenario-defs.test.ts (#703).
// TODO: implement — real describe blocks land here in the next phase.

describe.skip('Role-marked steps obey checkStepActionAllowed (issue #479)', () => {});
describe.skip('isAllowedBootstrapCommand (issue #515)', () => {});
describe.skip('Role-marked steps obey checkStepActionAllowed for bootstrap/guard (issue #515)', () => {});
