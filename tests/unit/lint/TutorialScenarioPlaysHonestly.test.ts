// BlastSimulator2026 — the interactive tutorial scenario plays the real game (#1338).
//
// tutorial-interactive.json must be a player's run: real starting cash, no
// test-only skill grants, no forced win. Only time control may stay a
// console-level setup step; everything else is a click, an observation or a
// guard. The run ends because the level ends, not because a command ended it.

import { describe, it, expect } from 'vitest';
import { loadScenarioDef, SCENARIO_DIR } from '../../../scripts/shared/scenario-utils.js';
import type { ScenarioStepDef } from '../../../scripts/shared/scenario-types.js';

/** Commands a `role: 'setup'` step may carry in this scenario: time control only. */
const TIME_CONTROL_COMMANDS = ['tutorial_start', 'time resume', 'wait_until', 'tick'];

const steps: ScenarioStepDef[] = loadScenarioDef('tutorial-interactive', SCENARIO_DIR).steps;

const isTimeControl = (command: string): boolean =>
  TIME_CONTROL_COMMANDS.some((c) => command === c || command.startsWith(`${c} `));

/** Every console command string a step carries, declared or inside its interaction array. */
function commandsOf(step: ScenarioStepDef): string[] {
  const inner = (step.interaction ?? [])
    .filter((a) => a.type === 'command')
    .map((a) => (a as { command: string }).command);
  return [step.command, ...inner];
}

describe('tutorial-interactive.json plays honestly (#1338)', () => {
  it('opens with campaign start level:tutorial_pit and no cash: override', () => {
    const first = steps[0]!;
    expect(first.command).toMatch(/^campaign start level:tutorial_pit(\s|$)/);
    for (const c of commandsOf(first)) expect(c).not.toMatch(/\bcash:/);
    expect(first.expect?.equals ?? {}).not.toHaveProperty('cash');
  });

  it('has exactly one campaign start', () => {
    const starts = steps.flatMap(commandsOf).filter((c) => c.startsWith('campaign start'));
    // Declared command and its mirrored interaction command are the same start.
    expect(new Set(starts).size).toBe(1);
    expect(steps.filter((s) => s.command.startsWith('campaign start'))).toHaveLength(1);
  });

  it('has no bootstrap-role step', () => {
    expect(steps.filter((s) => s.role === 'bootstrap').map((s) => s.command)).toEqual([]);
  });

  it('never grants skills with assign_skill', () => {
    const offenders = steps.filter((s) => commandsOf(s).some((c) => c.includes('assign_skill')));
    expect(offenders.map((s) => s.command)).toEqual([]);
  });

  it('never force-completes the level with campaign complete', () => {
    const offenders = steps.filter((s) => commandsOf(s).some((c) => c.startsWith('campaign complete')));
    expect(offenders.map((s) => s.command)).toEqual([]);
  });

  it('every step after the first is player, observe or guard, or setup carrying only time control', () => {
    const offenders = steps.slice(1).filter((s) => {
      if (s.role === 'player' || s.role === 'observe' || s.role === 'guard') return false;
      if (s.role !== 'setup') return true;
      return !commandsOf(s).every(isTimeControl);
    });
    expect(offenders.map((s) => `${s.role}: ${s.command}`)).toEqual([]);
  });

  it('ends on a real win: last gameplay step waits for levelEnded and the last step expects completed', () => {
    const last = steps[steps.length - 1]!;
    expect(last.expect?.equals).toMatchObject({ levelEnded: true, levelEndReason: 'completed' });
    const waits = steps.filter((s) =>
      (s.interaction ?? []).some((a) => a.type === 'waitUntil' && (a as { field?: string }).field === 'levelEnded'),
    );
    expect(waits.length).toBeGreaterThan(0);
  });

  it('free play sells with fillable:true and waits on fillableOreSaleOffered before each round', () => {
    const sale = (s: ScenarioStepDef) => /^contract (accept|deliver) type:ore_sale/.test(s.command);
    const sales = steps.filter(sale);
    expect(sales.length).toBeGreaterThanOrEqual(2);
    for (const s of sales) expect(s.command, s.command).toContain('fillable:true');
    sales.forEach((s) => {
      if (!s.command.startsWith('contract accept')) return;
      const prev = steps[steps.indexOf(s) - 1]!;
      expect(
        (prev.interaction ?? []).some((a) => a.type === 'waitUntil' && (a as { field?: string }).field === 'fillableOreSaleOffered'),
        `${s.command} must follow a waitUntil fillableOreSaleOffered`,
      ).toBe(true);
    });
  });
});
