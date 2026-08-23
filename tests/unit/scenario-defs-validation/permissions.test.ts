import { describe, it, expect } from 'vitest';
import type { ScenarioStepDef } from '../../../scripts/shared/scenario-types.js';
import { loadScenarioDef, SCENARIO_DIR } from '../../../scripts/shared/scenario-utils.js';
import { checkStepActionAllowed, isAllowedBootstrapCommand } from '../../../scripts/shared/interaction-executor.js';
import { ALL_SCENARIO_NAMES } from './fixtures.js';

// checkStepActionAllowed / bootstrap-guard rule checks — split out of
// the former scenario-defs.test.ts (#703).

// ──────────────────────────────────────────────
// 14. Role-marked steps never reach the console for anything but an
// allowlisted setup command (issue #479). A step with no role tag predates
// the distinction and is unconstrained — true of every definition here
// except the pilot conversion, tutorial-interactive.json.
// ──────────────────────────────────────────────
describe('Role-marked steps obey checkStepActionAllowed (issue #479)', () => {
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — no role-marked step's interaction runs a disallowed console command`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      const violations: string[] = [];
      for (const step of scenario.steps as ScenarioStepDef[]) {
        if (step.role === undefined) continue;
        for (const action of step.interaction ?? []) {
          if (action.type !== 'command') continue;
          const violation = checkStepActionAllowed(step, action);
          if (violation !== null) violations.push(violation);
        }
      }
      expect(violations).toEqual([]);
    });
  }

  it('a player-marked step carrying a command action is rejected, naming the step', () => {
    const step: ScenarioStepDef = {
      command: 'vehicle driver 1 4',
      description: 'vehicle-buy-assign complete',
      role: 'player',
      interaction: [{ type: 'command', command: 'vehicle driver 1 4' }],
    };
    const violation = checkStepActionAllowed(step, { type: 'command', command: 'vehicle driver 1 4' });
    expect(violation).not.toBeNull();
    expect(violation).toContain('vehicle-buy-assign complete');
    expect(violation).toContain('vehicle driver 1 4');
  });

  it('a setup-marked step may still use an allowlisted command', () => {
    const step: ScenarioStepDef = {
      command: 'tick 6',
      role: 'setup',
      interaction: [{ type: 'command', command: 'tick 6' }],
    };
    expect(checkStepActionAllowed(step, { type: 'command', command: 'tick 6' })).toBeNull();
    expect(checkStepActionAllowed(step, { type: 'command', command: 'new_game seed:1' })).toBeNull();
  });

  it('a setup-marked step is rejected for a command outside the allowlist', () => {
    const cheat = 'employee assign_skill 1 skill:geology level:3';
    const step: ScenarioStepDef = {
      command: cheat,
      role: 'setup',
      interaction: [{ type: 'command', command: cheat }],
    };
    const violation = checkStepActionAllowed(step, { type: 'command', command: cheat });
    expect(violation).not.toBeNull();
    expect(violation).toContain(cheat);
  });

  it('an observe-marked step may run a read-only command', () => {
    for (const readOnly of ['state full', 'scores', 'vehicle list', 'contract status', 'drill_plan show']) {
      const step: ScenarioStepDef = { command: readOnly, role: 'observe' };
      expect(
        checkStepActionAllowed(step, { type: 'command', command: readOnly }),
        `"${readOnly}" reports state and must be allowed`,
      ).toBeNull();
    }
  });

  it('an observe-marked step is rejected for a command that changes state', () => {
    for (const mutating of ['vehicle buy debris_hauler', 'build freight_warehouse at:4,4', 'contract accept 1']) {
      const step: ScenarioStepDef = { command: mutating, role: 'observe' };
      const violation = checkStepActionAllowed(step, { type: 'command', command: mutating });
      expect(violation, `"${mutating}" changes state and must be refused`).not.toBeNull();
      expect(violation).toContain('changes state rather than reporting it');
    }
  });

  it('a step with no role tag is unconstrained (predates the distinction)', () => {
    const step: ScenarioStepDef = {
      command: 'build freight_warehouse at:4,4',
      interaction: [{ type: 'command', command: 'build freight_warehouse at:4,4' }],
    };
    expect(checkStepActionAllowed(
      step, { type: 'command', command: 'build freight_warehouse at:4,4' },
    )).toBeNull();
  });
});

// ──────────────────────────────────────────────
// 14b. `bootstrap` and `guard` roles (issue #515) — the two roles
// ScenarioStepRole gained beyond #479's player/setup/observe. `bootstrap`
// covers a mutating command with no UI equivalent and no business having one
// (e.g. `employee assign_skill`); `guard` covers a step proving a control is
// unreachable rather than clicking one.
// ──────────────────────────────────────────────
describe('isAllowedBootstrapCommand (issue #515)', () => {
  it('allows the plan\'s audited bootstrap commands', () => {
    expect(isAllowedBootstrapCommand('employee assign_skill 1 skill:geology level:3')).toBe(true);
    expect(isAllowedBootstrapCommand('weather set storm')).toBe(true);
    expect(isAllowedBootstrapCommand('corrupt target:witness')).toBe(true);
  });

  it('rejects a command with a real UI equivalent', () => {
    // `management_office` is a real BuildingType (Building.ts) with a real
    // catalog row (BuildMenu.ts's data-build-type). `office` (no such type —
    // see BOOTSTRAP_COMMAND_ALLOWLIST's comment) would be the wrong example
    // here: it has no UI to smuggle past, real or otherwise.
    expect(isAllowedBootstrapCommand('build management_office')).toBe(false);
  });

  it('rejects an empty command', () => {
    expect(isAllowedBootstrapCommand('')).toBe(false);
    expect(isAllowedBootstrapCommand('   ')).toBe(false);
  });
});

describe('Role-marked steps obey checkStepActionAllowed for bootstrap/guard (issue #515)', () => {
  it('a bootstrap-marked step may use an allowlisted command', () => {
    const cmd = 'employee assign_skill 1 skill:geology level:3';
    const step: ScenarioStepDef = {
      command: cmd,
      role: 'bootstrap',
      interaction: [{ type: 'command', command: cmd }],
    };
    expect(checkStepActionAllowed(step, { type: 'command', command: cmd })).toBeNull();
  });

  it('a bootstrap-marked step is rejected for a command outside the allowlist', () => {
    const cmd = 'build freight_warehouse at:4,4';
    const step: ScenarioStepDef = {
      command: cmd,
      description: 'bootstrap-build',
      role: 'bootstrap',
      interaction: [{ type: 'command', command: cmd }],
    };
    const violation = checkStepActionAllowed(step, { type: 'command', command: cmd });
    expect(violation).not.toBeNull();
    expect(violation).toContain('bootstrap-build');
    expect(violation).toContain(cmd);
  });

  it('a guard-marked step with expect.blocked is allowed (no command runs)', () => {
    const step: ScenarioStepDef = {
      command: 'state',
      role: 'guard',
      expect: { blocked: '[data-action="run-analysis"]' },
    };
    // A guard step proves a control is unreachable, not that a command ran —
    // checkStepActionAllowed is only reached for actions of type 'command',
    // so a guard step whose interaction never dispatches one never hits this
    // check. Exercised here via the observation-style command a guard step
    // may still use to record state (mirrors the 'observe' role's shape).
    expect(checkStepActionAllowed(step, { type: 'command', command: 'state' })).toBeNull();
  });

  it('a guard-marked step with no expect.blocked is rejected, naming the reason', () => {
    const step: ScenarioStepDef = {
      command: 'state',
      description: 'guard-no-blocked',
      role: 'guard',
    };
    const violation = checkStepActionAllowed(step, { type: 'command', command: 'state' });
    expect(violation).not.toBeNull();
    expect(violation).toContain('guard-no-blocked');
    expect(violation).toMatch(/guard/i);
    expect(violation).toMatch(/blocked/i);
  });
});
