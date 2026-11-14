// BlastSimulator2026 — `permit status|apply` console command (#1921)

import { describe, it, expect, beforeAll } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import { MINE_GRADES } from '../../../src/core/config/balance.js';
import { meetTargets, tierTargets, tierNeeded } from '../../helpers/gradeLadder.js';
import { gradeDef, permitApplyBlocker } from '../../../src/core/economy/MineGrade.js';
import { permitRefusalText } from '../../../src/core/economy/permitRefusalText.js';

/** Sandbox at tier 3 of grade 0 with the grade-up targets and mastery met and cash for the fee. */
function ready() {
  const r = sandbox();
  r.state.grade!.tier = 3;
  meetTargets(r.state, tierTargets(0, 3));
  meetTargets(r.state, MINE_GRADES[0]!.mastery);
  r.state.cash = 100_000;
  return r;
}

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

  it('a sandbox starts at grade 0, tier 1 (#2277)', () => {
    const { state } = sandbox();
    expect(state.grade!.grade).toBe(0);
    expect(state.grade!.tier).toBe(1);
  });

  it('status prints the grade, the tier and the name through permit.status.grade', () => {
    const { runner } = sandbox();
    const r = runner.run('permit status');
    expect(r.success).toBe(true);
    expect(r.output).toContain(t('permit.status.grade', { grade: 0, tier: 1, name: t('permit.grade.0') }));
    expect(r.output).toContain('Surface');
  });

  it('status shows the targets of the current tier, each line [ ] or [x]', () => {
    const { runner, state } = sandbox();
    const lines = runner.run('permit status').output.split('\n');
    for (const tg of tierTargets(0, 1)) {
      const kindText = t(`permit.target.${tg.kind}`, { current: 0, needed: tg.value });
      expect(lines.some(l => l.includes('[ ]') && l.includes(kindText)), tg.kind).toBe(true);
    }
    meetTargets(state, tierTargets(0, 1));
    const met = runner.run('permit status').output.split('\n');
    expect(met.some(l => l.includes('[x]'))).toBe(true);
  });

  it('status follows the tier: tier 2 lists its own, larger targets', () => {
    const { runner, state } = sandbox();
    const one = runner.run('permit status').output;
    state.grade!.tier = 2;
    const two = runner.run('permit status').output;
    expect(two).not.toBe(one);
    expect(two).toContain(t('permit.status.grade', { grade: 0, tier: 2, name: t('permit.grade.0') }));
    expect(two).toContain(String(tierNeeded(0, 2, 'ore_kg')));
  });

  it('status also shows the grade-up checklist: the tier-3 targets and the mastery', () => {
    const { runner } = sandbox();
    const out = runner.run('permit status').output;
    expect(out).toContain(String(MINE_GRADES[0]!.mastery[0]!.value));
    expect(out).toContain(String(tierNeeded(0, 3, 'ore_kg')));
  });

  it('status shows progress as the trackers move', () => {
    const { runner, state } = sandbox();
    state.grade!.blastsFired = 0;
    const before = runner.run('permit status').output;
    state.grade!.blastsFired = 1;
    expect(runner.run('permit status').output).not.toBe(before);
  });

  it('status names the new grade and tier after an approval', () => {
    const { runner, state } = sandbox();
    state.grade!.grade = 2;
    state.grade!.tier = 3;
    expect(runner.run('permit status').output).toContain(t('permit.status.grade', { grade: 2, tier: 3, name: t('permit.grade.2') }));
  });

  it('a tier-up happens by itself on the next tick once the tier targets are met', () => {
    const { runner, state } = sandbox();
    meetTargets(state, tierTargets(0, 1));
    runner.run('tick 1');
    expect(state.grade!.tier).toBe(2);
    expect(state.grade!.grade).toBe(0);
  });

  it('a tier-up is free and starts no application', () => {
    const { runner, state } = sandbox();
    meetTargets(state, tierTargets(0, 1));
    runner.run('tick 1');
    expect(state.grade!.tier).toBe(2);
    expect(state.grade!.pending).toBeNull();
    expect(state.finances.transactions.filter(x => x.category === 'permits')).toHaveLength(0);
  });

  it('apply at tier 1 is refused as tier_incomplete, even with the grade-up targets met', () => {
    const { runner, state } = sandbox();
    meetTargets(state, tierTargets(0, 3));
    meetTargets(state, MINE_GRADES[0]!.mastery);
    state.grade!.tier = 1;
    state.cash = 100_000;
    const cash = state.cash;
    const r = runner.run('permit apply');
    expect(r.success).toBe(false);
    expect(r.output).toBe(permitRefusalText('tier_incomplete', [], gradeDef(1).fee, state.cash));
    expect(state.cash).toBe(cash);
    expect(state.grade!.pending).toBeNull();
  });

  it('apply with an unmet target is refused and names it', () => {
    const { runner, state } = sandbox();
    state.grade!.tier = 3;
    meetTargets(state, MINE_GRADES[0]!.mastery);
    state.cash = 100_000;
    const r = runner.run('permit apply');
    expect(r.success).toBe(false);
    expect(r.output).toMatch(/blast/i);
    expect(r.output).not.toMatch(/\bore\b/i);
    expect(state.cash).toBe(100_000);
  });

  it('apply at tier 3 with the tier targets and the mastery met books the fee and starts processing', () => {
    const { runner, state } = ready();
    const r = runner.run('permit apply');
    expect(r.success, r.output).toBe(true);
    expect(state.cash).toBe(100_000 - gradeDef(1).fee);
    expect(state.grade!.pending).toMatchObject({ toGrade: 1 });
    expect(state.grade!.pending!.ticksLeft).toBeLessThanOrEqual(gradeDef(1).processingTicks);
    expect(runner.run('permit status').output).toContain(String(state.grade!.pending!.ticksLeft));
  });

  it('apply without the funds is refused', () => {
    const { runner, state } = ready();
    state.cash = 1_000;
    const r = runner.run('permit apply');
    expect(r.success).toBe(false);
    expect(state.cash).toBe(1_000);
    expect(state.grade!.pending).toBeNull();
  });

  it('a second apply while pending is refused', () => {
    const { runner, state } = ready();
    runner.run('permit apply');
    const cash = state.cash;
    const r = runner.run('permit apply');
    expect(r.success).toBe(false);
    expect(state.cash).toBe(cash);
  });

  it('after the paperwork the grade is 1 at tier 1 and status shows the new name', () => {
    const { runner, state } = ready();
    runner.run('permit apply');
    runner.run(`tick ${state.grade!.pending!.ticksLeft}`);
    expect(state.grade!.grade).toBe(1);
    expect(state.grade!.tier).toBe(1);
    expect(runner.run('permit status').output).toContain(t('permit.status.grade', { grade: 1, tier: 1, name: t('permit.grade.1') }));
    expect(runner.run('permit status').output).toContain('Depth');
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

  it('tier_incomplete', () => {
    const { runner, state } = sandbox();
    const blocker = permitApplyBlocker(state)!;
    expect(blocker.refusal).toBe('tier_incomplete');
    expect(runner.run('permit apply').output).toBe(permitRefusalText('tier_incomplete', [], gradeDef(1).fee, state.cash));
  });

  it('unmet_targets', () => {
    const { runner, state } = sandbox();
    state.grade!.tier = 3;
    meetTargets(state, MINE_GRADES[0]!.mastery);
    const blocker = permitApplyBlocker(state)!;
    expect(runner.run('permit apply').output).toBe(permitRefusalText(blocker.refusal, blocker.unmet, gradeDef(1).fee, state.cash));
  });

  it('insufficient_funds', () => {
    const { runner, state } = ready();
    state.cash = 10;
    const blocker = permitApplyBlocker(state)!;
    expect(blocker.refusal).toBe('insufficient_funds');
    expect(runner.run('permit apply').output).toBe(permitRefusalText('insufficient_funds', [], gradeDef(1).fee, 10));
  });

  it('pending', () => {
    const { runner, state } = ready();
    state.grade!.pending = { toGrade: 1, ticksLeft: 5 };
    expect(runner.run('permit apply').output).toBe(permitRefusalText('pending', [], gradeDef(1).fee, state.cash));
  });

  it('no_ladder', () => {
    const { runner } = createRunner();
    runner.run('new_game seed:1');
    expect(runner.run('permit apply').output).toBe(permitRefusalText('no_ladder', [], 0, 0));
  });
});
