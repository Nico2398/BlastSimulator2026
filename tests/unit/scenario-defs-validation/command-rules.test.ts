import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { ScenarioStepDef } from '../../../scripts/shared/scenario-types.js';
import { loadScenarioDef, SCENARIO_DIR } from '../../../scripts/shared/scenario-utils.js';
import { getAllVehicleRoles } from '../../../src/core/entities/Vehicle.js';
import { ALL_SCENARIO_NAMES, KNOWN_COMMANDS } from './fixtures.js';

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
// `expect.blocked`/`expect.usable`) — name an entity by an id the simulation
// assigns at run time. Issue #654 closed this for `data-contract-id="N"`:
// the contract-offer pool rotates on `CONTRACT_REFRESH_INTERVAL`, so an id
// baked into a guard selector pins to whatever the pool resolved to at
// authoring time. Widened here to every runtime-assigned id the DOM exposes
// — `data-hole`, `data-vehicle-id`, `data-employee-id`, `data-building-id` —
// because they share the failure shape even where the mechanism differs: a
// hole, vehicle, employee or building number is assigned in creation order,
// so one step inserted upstream (a hire, an extra drill) renumbers every
// entity after it and every later selector silently targets a different
// thing. The command/interaction disagreement that produces is the class
// `.claude/rules/scenario-defs.md` names, arriving through an id instead of
// a click count.
//
// Held against a baseline, not banned outright: 112 such selectors across 28
// files predate this rule, and a migration of that size is its own change.
// The baseline is a ratchet in both directions, the same shape as
// `tests/unit/lint/dead-code-baseline.json` — a new baked id fails, and an
// entry that has been migrated away and is no longer present fails too, so
// the file can only ever shrink. `level1-win-efficient`'s #654-era named
// exemption is folded into the baseline rather than kept as a special case.
//
// Deliberately scoped to functional fields, NOT the whole `JSON.stringify(step)`
// (post-review fix, issue #654): a step's free-text `description` narrates
// its own authoring history in prose and can legitimately quote an old,
// already-fixed selector without that prose being a live violation.
// ──────────────────────────────────────────────
describe('No step names an entity by a runtime-assigned id outside the baseline (issue #654, widened)', () => {
  /** A literal `data-<attr>="<value>"` for an attribute the simulation numbers at run time. `*` is a wildcard, not an id. */
  const LITERAL_RUNTIME_ID = /data-(?:contract-id|hole|vehicle-id|employee-id|building-id)="[^"*]+"/g;

  const BASELINE_PATH = resolve(import.meta.dirname, 'baked-id-baseline.json');
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as { bakedRuntimeIds: string[] };
  const known = new Set(baseline.bakedRuntimeIds);

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

  /** `<scenario>:<stepIndex>:<literal>` for every baked id in the tree right now, de-duplicated per step. */
  const currentEntries = (): Set<string> => {
    const found = new Set<string>();
    for (const name of ALL_SCENARIO_NAMES) {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      scenario.steps.forEach((rawStep, i) => {
        for (const value of functionalStrings(rawStep as ScenarioStepDef)) {
          for (const match of value.matchAll(LITERAL_RUNTIME_ID)) {
            found.add(`${name}:${i}:${match[0]}`);
          }
        }
      });
    }
    return found;
  };

  it('introduces no baked runtime id the baseline does not already carry', () => {
    const fresh = [...currentEntries()].filter((e) => !known.has(e));
    expect(
      fresh,
      `${fresh.length} new selector(s) name an entity by a runtime-assigned id. Select on shape `
      + `instead — data-contract-type, a role, an ordinal — the way #654's contract fix did:\n`
      + fresh.map((e) => `  ${e}`).join('\n'),
    ).toEqual([]);
  });

  it('carries no baseline entry that has already been migrated away', () => {
    const current = currentEntries();
    const stale = baseline.bakedRuntimeIds.filter((e) => !current.has(e));
    expect(
      stale,
      `${stale.length} baseline entr(ies) no longer present — delete these lines from `
      + `tests/unit/scenario-defs-validation/baked-id-baseline.json:\n`
      + stale.map((e) => `  ${e}`).join('\n'),
    ).toEqual([]);
  });

  it('keeps the baseline shrinking, never growing', () => {
    // Pins the count so a bulk re-generation cannot quietly absorb new
    // offenders. Lower this number as entries are migrated; never raise it
    // except for a genuinely new scenario file that needs the same
    // already-baselined tutorial selectors (issue #1083's
    // tutorial-boxcut-full.json, copied verbatim from tutorial-interactive.json
    // through its build_ramp step, carries the same two data-employee-id
    // train-click selectors at the same step indices).
    expect(baseline.bakedRuntimeIds.length).toBeLessThanOrEqual(114);
  });
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
