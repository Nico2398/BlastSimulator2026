import { describe, it, expect } from 'vitest';
import type { ScenarioStepDef } from '../../scripts/shared/scenario-types.js';
import { loadScenarioDef, SCENARIO_DIR } from '../../scripts/shared/scenario-utils.js';
import { getAllVehicleRoles } from '../../src/core/entities/Vehicle.js';
import { ALL_SCENARIO_NAMES, KNOWN_COMMANDS } from './scenario-defs-fixtures.js';

// Command-string legality checks (unknown commands, contract id format,
// vehicle role validity) — split out of tests/unit/scenario-defs.test.ts (#703).
// TODO: implement — real describe blocks land here in the next phase.

describe.skip('No steps use unknown commands', () => {});
describe.skip('"contract" commands use type:/material:, not a numeric id (issue #597)', () => {});
describe.skip('No step contains a literal data-contract-id="N" DOM selector (issue #654)', () => {});
describe.skip('"vehicle buy" steps use a valid VehicleRole', () => {});
