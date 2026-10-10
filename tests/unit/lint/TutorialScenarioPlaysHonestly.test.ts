// BlastSimulator2026 — the interactive tutorial scenarios play the real game (#1338, #1517).
//
// tutorial-interactive.json and tutorial-steps-visual.json must be a player's
// run: real starting cash, no test-only skill grants, no forced win. Only time
// control may stay a console-level setup step; everything else is a click, an
// observation or a guard. The run ends because the level ends, not because a
// command ended it.

import { describe, it, expect } from 'vitest';
import { loadScenarioDef, SCENARIO_DIR } from '../../../scripts/shared/scenario-utils.js';
import type { ScenarioStepDef } from '../../../scripts/shared/scenario-types.js';

/** Commands a `role: 'setup'` step may carry in this scenario: time control only. */
const TIME_CONTROL_COMMANDS = ['tutorial_start', 'time resume', 'wait_until', 'tick'];

/** Scenarios that must play the real tutorial: #1338 interactive, #1517 steps-visual. */
const SCENARIOS = ['tutorial-interactive', 'tutorial-steps-visual'] as const;

const isTimeControl = (command: string): boolean =>
  TIME_CONTROL_COMMANDS.some((c) => command === c || command.startsWith(`${c} `));

/** Every console command string a step carries, declared or inside its interaction array. */
function commandsOf(step: ScenarioStepDef): string[] {
  const inner = (step.interaction ?? [])
    .filter((a) => a.type === 'command')
    .map((a) => (a as { command: string }).command);
  return [step.command, ...inner];
}

describe.each(SCENARIOS)('%s.json plays honestly (#1338, #1517)', (scenarioName) => {
  const steps: ScenarioStepDef[] = loadScenarioDef(scenarioName, SCENARIO_DIR).steps;

  it('opens with campaign start level:tutorial_pit and no cash: override', () => {
    const first = steps[0]!;
    expect(first.command).toMatch(/^campaign start level:tutorial_pit(\s|$)/);
    for (const c of commandsOf(first)) expect(c).not.toMatch(/\bcash:/);
    expect(first.expect?.equals ?? {}).not.toHaveProperty('cash');
  });

  it('carries no cash: token in any command or interaction command', () => {
    const offenders = steps.flatMap(commandsOf).filter((c) => /\bcash:/.test(c));
    expect(offenders).toEqual([]);
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

  it('free play: every contract accept/deliver in a fillable round carries fillable:true, accepts follow a fillable-offer wait', () => {
    const isTrade = (s: ScenarioStepDef) => /^contract (accept|deliver)\b/.test(s.command);
    // Free play starts at the first fillable trade; earlier trades are scripted tutorial beats.
    const firstFillable = steps.findIndex((s) => isTrade(s) && s.command.includes('fillable:true'));
    expect(firstFillable).toBeGreaterThan(-1);
    const trades = steps.slice(firstFillable).filter(isTrade);
    expect(trades.length).toBeGreaterThanOrEqual(2);
    const waitsOnFillable = (s: ScenarioStepDef) =>
      (s.interaction ?? []).some(
        (a) =>
          a.type === 'waitUntil'
          && ['fillableOreSaleOffered', 'fillableDirtiteSaleOffered', 'fillableRustiteSaleOffered', 'fillableSaleOffered'].includes((a as { field?: string }).field ?? ''),
      );
    for (const s of trades) {
      expect(s.command, s.command).toContain('fillable:true');
      if (!s.command.startsWith('contract accept')) continue;
      const prev = steps[steps.indexOf(s) - 1]!;
      expect(waitsOnFillable(prev), `${s.command} must follow a waitUntil on a fillable offer`).toBe(true);
    }
  });

  it('the levelEnded waitUntil sits on the last gameplay step', () => {
    const waitsLevelEnded = (s: ScenarioStepDef) =>
      (s.interaction ?? []).some((a) => a.type === 'waitUntil' && (a as { field?: string }).field === 'levelEnded');
    const idx = steps.map(waitsLevelEnded).lastIndexOf(true);
    expect(idx).toBeGreaterThan(-1);
    // Nothing after it but observation/guard steps: no player or setup play follows the win.
    expect(steps.slice(idx + 1).filter((s) => s.role === 'player' || s.role === 'setup').map((s) => s.command)).toEqual([]);
  });

  // Recorded decision (#1338): tutorial_start / time resume / tick setup steps
  // are harness time control. They advance or release the clock and mutate no
  // game state a player could not reach, so they are allowed (TIME_CONTROL_COMMANDS).
});
