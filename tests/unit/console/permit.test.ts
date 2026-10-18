// BlastSimulator2026 — `permit status|apply` console command (#1921)

import { describe, it, expect, beforeAll } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import { gradeDef } from '../../../src/core/economy/MineGrade.js';
import { permitApplyBlocker, permitRefusalText } from '../../../src/core/economy/permitRefusalText.js';

function sandbox() {
  const { runner, ctx } = createRunner();
  const started = runner.run('sandbox start biome:desert_badlands seed:42');
  expect(started.success, started.output).toBe(true);
  ctx.state!.events.eventFreqMultiplier = 0;
  return { runner, state: ctx.state! };
}

describe('permit command (#1921)', () => {
  beforeAll(() => setLocale('en'));

  it('is registered with the runner', () => {
    const { runner } = createRunner();
    expect(runner.run('permit status').output).not.toMatch(/unknown command/i);
  });

  it('a sandbox starts with a progression ladder at grade 0', () => {
    const { state } = sandbox();
    expect(state.grade).toBeDefined();
    expect(state.grade!.grade).toBe(0);
  });

  it('status shows the grade name and the grade-1 targets with progress', () => {
    const { runner } = sandbox();
    const r = runner.run('permit status');
    expect(r.success).toBe(true);
    expect(r.output).toContain('Backyard Dig Permit');
    expect(r.output).toMatch(/ore/i);
    expect(r.output).toMatch(/blast/i);
  });

  it('status shows progress as the trackers move', () => {
    const { runner, state } = sandbox();
    state.grade!.blastsFired = 1;
    const before = runner.run('permit status').output;
    state.grade!.blastsFired = 2;
    expect(runner.run('permit status').output).not.toBe(before);
  });

  it('apply with an unmet target is refused and names it', () => {
    const { runner, state } = sandbox();
    state.grade!.oreDeliveredKg = 5_000;
    const cash = state.cash;
    const r = runner.run('permit apply');
    expect(r.success).toBe(false);
    expect(r.output).toMatch(/blast/i);
    expect(r.output).not.toMatch(/\bore\b/i);
    expect(state.cash).toBe(cash);
  });

  it('apply with enough cash and every target met books the fee and starts processing', () => {
    const { runner, state } = sandbox();
    state.grade!.oreDeliveredKg = 5_000;
    state.grade!.blastsFired = 2;
    state.cash = 100_000;
    const r = runner.run('permit apply');
    expect(r.success, r.output).toBe(true);
    expect(state.cash).toBe(80_000);
    expect(state.grade!.pending).toEqual({ toGrade: 1, ticksLeft: 48 });
    expect(runner.run('permit status').output).toContain('48');
  });

  it('apply without the funds is refused', () => {
    const { runner, state } = sandbox();
    state.grade!.oreDeliveredKg = 5_000;
    state.grade!.blastsFired = 2;
    state.cash = 1_000;
    const r = runner.run('permit apply');
    expect(r.success).toBe(false);
    expect(state.cash).toBe(1_000);
    expect(state.grade!.pending).toBeNull();
  });

  it('a second apply while pending is refused', () => {
    const { runner, state } = sandbox();
    state.grade!.oreDeliveredKg = 5_000;
    state.grade!.blastsFired = 2;
    state.cash = 100_000;
    runner.run('permit apply');
    const r = runner.run('permit apply');
    expect(r.success).toBe(false);
    expect(state.cash).toBe(80_000);
  });

  it('after 48 ticks the grade is 1 and status shows the new name', () => {
    const { runner, state } = sandbox();
    state.grade!.oreDeliveredKg = 5_000;
    state.grade!.blastsFired = 2;
    state.cash = 100_000;
    runner.run('permit apply');
    runner.run('tick 48');
    expect(state.grade!.grade).toBe(1);
    expect(runner.run('permit status').output).toContain('Hobby Quarry Licence');
  });

  it('says the site has no permit ladder on new_game, for status and apply', () => {
    const { runner } = createRunner();
    expect(runner.run('new_game seed:42').success).toBe(true);
    for (const sub of ['status', 'apply']) {
      const r = runner.run(`permit ${sub}`);
      expect(r.success).toBe(false);
      expect(r.output).toMatch(/no permit ladder/i);
    }
  });

  it('a bare permit or unknown subcommand is not a crash', () => {
    const { runner } = sandbox();
    expect(runner.run('permit').success).toBe(false);
    expect(runner.run('permit frobnicate').success).toBe(false);
  });
});

describe('permit apply output equals permitRefusalText (#1924)', () => {
  beforeAll(() => setLocale('en'));

  it('unmet_targets', () => {
    const { runner, state } = sandbox();
    state.grade!.oreDeliveredKg = 5_000;
    const blocker = permitApplyBlocker(state)!;
    expect(runner.run('permit apply').output).toBe(permitRefusalText(blocker.refusal, blocker.unmet, gradeDef(1).fee, state.cash));
  });

  it('insufficient_funds', () => {
    const { runner, state } = sandbox();
    state.grade!.oreDeliveredKg = 5_000;
    state.grade!.blastsFired = 2;
    state.cash = 10;
    const blocker = permitApplyBlocker(state)!;
    expect(blocker.refusal).toBe('insufficient_funds');
    expect(runner.run('permit apply').output).toBe(permitRefusalText('insufficient_funds', [], gradeDef(1).fee, 10));
  });

  it('pending', () => {
    const { runner, state } = sandbox();
    state.grade!.pending = { toGrade: 1, ticksLeft: 5 };
    expect(runner.run('permit apply').output).toBe(permitRefusalText('pending', [], gradeDef(1).fee, state.cash));
  });

  it('no_ladder', () => {
    const { runner } = createRunner();
    runner.run('new_game seed:1');
    expect(runner.run('permit apply').output).toBe(permitRefusalText('no_ladder', [], 0, 0));
  });
});
