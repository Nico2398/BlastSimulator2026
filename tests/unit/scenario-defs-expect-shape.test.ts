import { describe, it, expect } from 'vitest';
import type { ScenarioStepDef } from '../../scripts/shared/scenario-types.js';
import { loadScenarioDef, SCENARIO_DIR } from '../../scripts/shared/scenario-utils.js';
import { ALL_SCENARIO_NAMES } from './scenario-defs-fixtures.js';

// `expect` field shape checks — split out of tests/unit/scenario-defs.test.ts
// (#703).
// TODO: implement — real describe blocks land here in the next phase.

describe.skip('Step expect field is shaped correctly when present', () => {});
describe.skip('expect.changedBy shape (issue #596)', () => {});
