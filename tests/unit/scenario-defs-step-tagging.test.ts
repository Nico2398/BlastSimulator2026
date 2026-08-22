import { describe, it, expect } from 'vitest';
import type { ScenarioStepDef } from '../../scripts/shared/scenario-types.js';
import { loadScenarioDef, SCENARIO_DIR } from '../../scripts/shared/scenario-utils.js';
import { ALL_SCENARIO_NAMES, UI_DRIVEN_SCENARIO_NAMES } from './scenario-defs-fixtures.js';

// Step metadata tagging checks (interaction array presence, UI-driven
// scenarios, role/commandOutcome field validity) — split out of
// tests/unit/scenario-defs.test.ts (#703).
// TODO: implement — real describe blocks land here in the next phase.

describe.skip('Every scenario step has a dual-play interaction array', () => {});
describe.skip('UI-driven scenarios click real controls', () => {});
describe.skip('Step role field is a recognized value when present', () => {});
describe.skip('Step commandOutcome field is a recognized value when present', () => {});
