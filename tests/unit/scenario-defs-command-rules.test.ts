import { describe, it, expect } from 'vitest';
import type { ScenarioStepDef } from '../../scripts/shared/scenario-types.js';
import { loadScenarioDef, SCENARIO_DIR } from '../../scripts/shared/scenario-utils.js';
import { getAllVehicleRoles } from '../../src/core/entities/Vehicle.js';
import { ALL_SCENARIO_NAMES, KNOWN_COMMANDS } from './scenario-defs-fixtures.js';

// Command-string legality checks (unknown commands, contract id format,
// vehicle role validity) — split out of the former scenario-defs.test.ts (#703).

// ──────────────────────────────────────────────
// 8. No steps use unknown / unregistered commands
// ──────────────────────────────────────────────
describe('No steps use unknown commands', () => {
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — no step references an unknown command`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      const unknownCommands: string[] = [];
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i] as ScenarioStepDef;
        // A waitUntil step's `command` field is descriptive only (issue #590)
        // — command mode drives the tick loop from step.interaction instead
        // of executing this string, so it is exempt from the known-command
        // check that every real command string must pass.
        if ((step.interaction ?? []).some(a => a.type === 'waitUntil')) continue;
        const cmdStr = typeof step === 'string' ? step : (step as any).command;
        const firstToken = cmdStr.trim().split(/\s+/)[0];
        if (!KNOWN_COMMANDS.includes(firstToken)) {
          unknownCommands.push(`step[${i}]: "${cmdStr}"`);
        }
      }
      expect(unknownCommands).toEqual([]);
    });
  }
});

// ──────────────────────────────────────────────
// 7b. "contract" commands use the type:/material: selector, not a raw
// numeric id (issue #597). `CONTRACT_REFRESH_INTERVAL` keeps cycling the
// offer pool, so a bare id or `id:N` names a moving target — the recurring
// class of flake behind PR #616's own review round (contract offer ids
// drifted 1->4->14, 19->20 across three separate prior fixes in
// level3-playthrough-win.json alone) and the review's own explicit
// suggested check.
// ──────────────────────────────────────────────
describe('"contract" commands use type:/material:, not a numeric id (issue #597)', () => {
  const CONTRACT_SUB = /^contract\s+(accept|decline|deliver|negotiate)\b(.*)$/;

  const usesNumericId = (rest: string): boolean =>
    !/\btype:/.test(rest) && (/\bid:\d+/.test(rest) || /^\s*\d+/.test(rest));

  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — no contract command uses a bare/id: numeric selector`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      const offenders: string[] = [];

      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i] as ScenarioStepDef;
        const commands = [step.command, ...(step.interaction ?? [])
          .filter((a): a is Extract<typeof a, { type: 'command' }> => a.type === 'command')
          .map(a => a.command)];

        for (const cmd of commands) {
          const match = CONTRACT_SUB.exec(cmd.trim());
          if (match && usesNumericId(match[2] ?? '')) {
            offenders.push(`step[${i}]: "${cmd}"`);
          }
        }
      }

      expect(offenders).toEqual([]);
    });
  }
});

// ──────────────────────────────────────────────
// 7c. No step's FUNCTIONAL fields — the ones that actually drive DOM
// targeting or command dispatch (`command`, `interaction[].command`,
// `interaction[].selector` on any action that carries one, and
// `expect.blocked`/`expect.usable`) — contain a literal `data-contract-id="N"`
// DOM selector (issue #654). The contract-offer pool rotates on
// `CONTRACT_REFRESH_INTERVAL`, so an id baked straight into a guard selector
// (e.g. `#bs-contract-panel [data-contract-id="26"] .bs-contract-deliver`)
// pins to whatever the pool happened to resolve to at authoring time and
// breaks the moment an upstream timing change shifts tick counts — the same
// class of flake 7b already guards against for `contract` command strings,
// widened here to catch the id showing up in any functional field of a step.
//
// Deliberately scoped to those fields, NOT the whole `JSON.stringify(step)`
// (post-review fix, issue #654): a step's free-text `description` narrates
// its own authoring history in prose and can legitimately quote an old,
// already-fixed selector (e.g. "...previously scoped to
// `[data-contract-id=\"19\"] .bs-contract-accept`...") without that prose
// being a live violation. Scanning the whole step produced a false positive
// on level3-playthrough-win.json step 79, whose live `command`/`selector`/
// `expect` fields are already migrated to `type:`/`data-contract-type`
// selectors — only its description mentions the old id it moved away from.
//
// level1-win-efficient.json is exempted by name: it has its own pre-existing
// literal `data-contract-id="N"` selectors in real `selector`/`expect.blocked`
// fields that predate #654 and need a separate migration. That migration is
// out of scope for #654 — this is a deliberate, named skip, not a loophole.
// ──────────────────────────────────────────────
describe('No step contains a literal data-contract-id="N" DOM selector (issue #654)', () => {
  // Matches the pattern in a step's raw field value (data-contract-id="26").
  const LITERAL_CONTRACT_ID = /data-contract-id="\d+"/;

  // Deliberate, named exemption — see comment above. Not part of #654's scope.
  const EXEMPT_SCENARIOS = new Set(['level1-win-efficient']);

  /** Every functional (DOM/command-dispatching) string field of a step, not free text like `description`. */
  const functionalStrings = (step: ScenarioStepDef): string[] => {
    const values: string[] = [step.command];
    if (step.expect?.blocked !== undefined) values.push(step.expect.blocked);
    if (step.expect?.usable !== undefined) values.push(step.expect.usable);
    for (const action of step.interaction ?? []) {
      if ('command' in action && typeof action.command === 'string') values.push(action.command);
      if ('selector' in action && typeof action.selector === 'string') values.push(action.selector);
    }
    return values;
  };

  for (const name of ALL_SCENARIO_NAMES) {
    if (EXEMPT_SCENARIOS.has(name)) {
      it.skip(`${name} — exempted from data-contract-id lint (issue #654, separate follow-up)`, () => {});
      continue;
    }

    it(`${name} — no step's functional fields contain a literal data-contract-id="N" selector`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      const offenders: string[] = [];

      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i] as ScenarioStepDef;
        for (const value of functionalStrings(step)) {
          const match = LITERAL_CONTRACT_ID.exec(value);
          if (match) {
            offenders.push(`step[${i}]: ${match[0]}`);
          }
        }
      }

      expect(offenders).toEqual([]);
    });
  }
});

// ──────────────────────────────────────────────
// 8b. "vehicle buy" steps pass a valid VehicleRole
// Regression: scripts/scenario-defs/vehicle-traffic.json used to pass
// "hauler" as the role argument, which is not a member of VehicleRole
// (the valid id is "debris_hauler"). Because the console command layer
// rejects the buy with CommandResult.success:false rather than throwing,
// `npm run scenarios` (command-mode runner) never surfaced the bug — it
// only fails a step on a thrown exception. This test catches invalid
// role tokens directly against the VehicleRole set instead of relying on
// runtime command execution. See issue #445.
//
// Widened to every scenario in ALL_SCENARIO_NAMES (see issue #450):
// level3-playthrough-win.json, level1-lose-bankruptcy.json,
// level2-playthrough-win.json, level2-playthrough-bankruptcy.json, and
// tutorial-playthrough.json all still carry invalid legacy VehicleRole
// tokens (e.g. "excavator", "truck", "bulldozer", "hauler") in their
// "vehicle buy" steps. This check now covers all of them, not just
// vehicle-traffic.json.
// ──────────────────────────────────────────────
describe('"vehicle buy" steps use a valid VehicleRole', () => {
  const validRoles = getAllVehicleRoles();

  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — every "vehicle buy" step's role is a valid VehicleRole`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      const invalidRoleSteps: string[] = [];
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        const cmdStr = typeof step === 'string' ? step : (step as ScenarioStepDef).command;
        if (!cmdStr.startsWith('vehicle buy ')) continue;
        const role = cmdStr.trim().split(/\s+/)[2];
        if (!validRoles.includes(role as never)) {
          invalidRoleSteps.push(
            `step[${i}]: "${cmdStr}" — role "${role}" is not a valid VehicleRole (valid: ${validRoles.join(', ')})`,
          );
        }
      }
      expect(
        invalidRoleSteps,
        `${name}.json has "vehicle buy" steps with invalid roles:\n${invalidRoleSteps.join('\n')}`,
      ).toEqual([]);
    });
  }
});
