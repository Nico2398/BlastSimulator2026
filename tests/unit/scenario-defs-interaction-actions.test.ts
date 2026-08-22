import { describe, it, expect } from 'vitest';
import type { ScenarioStepDef } from '../../scripts/shared/scenario-types.js';
import { loadScenarioDef, SCENARIO_DIR } from '../../scripts/shared/scenario-utils.js';
import { ALL_SCENARIO_NAMES, KNOWN_INTERACTION_ACTION_TYPES } from './scenario-defs-fixtures.js';

// Dual-play scenario steps — interaction array validation (data-driven) —
// split out of tests/unit/scenario-defs.test.ts (#703).
// TODO: implement — real describe block lands here in the next phase.

describe.skip('Dual-play scenario steps — data-driven validation', () => {});
