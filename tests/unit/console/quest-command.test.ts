// BlastSimulator2026 — `quest list|detail|complete` console command and the locked-explosive refusal (#2280)

import { describe, it, expect, beforeAll } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { questCommand } from '../../../src/console/commands/quest.js';
import { makeEmptyGameContext } from '../../helpers/gameContext.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import { getAllQuests, getQuest } from '../../../src/core/economy/QuestCatalog.js';
import { isQuestCompleted } from '../../../src/core/economy/Quests.js';
import { explosivesOfTier } from '../../../src/core/world/ExplosiveCatalog.js';
import { fundForDeliveryWait } from '../../helpers/playthrough.js';

const T2 = 'quest_explosive_t2';
const T3 = 'quest_explosive_t3';

function sandbox() {
  const { runner, ctx } = createRunner();
  const started = runner.run('sandbox start biome:desert_badlands seed:42');
  expect(started.success, started.output).toBe(true);
  ctx.state!.events.eventFreqMultiplier = 0;
  return { runner, ctx, state: ctx.state! };
}

const nameOf = (id: string): string => t(`explosive.${id}.name`);

describe('quest command registration (#2280 C8)', () => {
  beforeAll(() => setLocale('en'));

  it('is registered with the runner', () => {
    const { runner } = createRunner();
    expect(runner.run('quest list').output).not.toMatch(/unknown command/i);
  });

  it('refuses without a started game', () => {
    const res = questCommand(makeEmptyGameContext(), ['list'], {});
    expect(res.success).toBe(false);
    expect(res.output.length).toBeGreaterThan(0);
  });

  it('refuses an unknown subcommand', () => {
    const { runner } = sandbox();
    expect(runner.run('quest frobnicate').success).toBe(false);
  });
});

describe('quest list (#2280 C8)', () => {
  beforeAll(() => setLocale('en'));

  it('lists every quest with its id, title and an available state, from the start', () => {
    const { runner } = sandbox();
    const r = runner.run('quest list');
    expect(r.success, r.output).toBe(true);
    for (const q of getAllQuests()) {
      expect(r.output).toContain(q.id);
      expect(r.output).toContain(t(q.titleKey));
    }
    expect(r.output).toMatch(/available/i);
  });

  it('shows per-objective progress as current against needed', () => {
    const { runner, state } = sandbox();
    state.quests!.cleanBlasts = 1;
    state.quests!.explosiveKg = 40;
    const out = runner.run('quest list').output;
    expect(out).toMatch(/1\s*\/\s*2/);
    expect(out).toMatch(/40\s*\/\s*100/);
  });

  it('shows the completed state once a quest is done', () => {
    const { runner } = sandbox();
    runner.run(`quest complete ${T2}`);
    const out = runner.run('quest list').output;
    expect(out).toMatch(/completed/i);
    expect(out).toMatch(/available/i); // T3 is still open
  });
});

describe('quest detail (#2280 C8)', () => {
  beforeAll(() => setLocale('en'));

  it('shows the giver, the pitch, the objectives with current and needed, the reward and the state', () => {
    const { runner, state } = sandbox();
    state.quests!.explosiveKg = 40;
    const def = getQuest(T2)!;
    const r = runner.run(`quest detail ${T2}`);
    expect(r.success, r.output).toBe(true);
    expect(r.output).toContain(t(def.titleKey));
    expect(r.output).toContain(t(def.giverKey));
    expect(r.output).toContain(t(def.pitchKey));
    expect(r.output).toMatch(/40\s*\/\s*100/);
    expect(r.output).toMatch(/0\s*\/\s*2/);
    expect(r.output).toMatch(/available/i);
  });

  it('names what the reward makes purchasable', () => {
    const { runner } = sandbox();
    const out = runner.run(`quest detail ${T2}`).output;
    expect(explosivesOfTier(2).some(e => out.includes(nameOf(e.id)))).toBe(true);
    const out3 = runner.run(`quest detail ${T3}`).output;
    expect(explosivesOfTier(3).some(e => out3.includes(nameOf(e.id)))).toBe(true);
  });

  it('T3 names its prerequisite quest', () => {
    const { runner } = sandbox();
    const out = runner.run(`quest detail ${T3}`).output;
    expect(out).toContain(t(getQuest(T2)!.titleKey));
  });

  it('shows the completed state after completion', () => {
    const { runner } = sandbox();
    runner.run(`quest complete ${T2}`);
    expect(runner.run(`quest detail ${T2}`).output).toMatch(/completed/i);
  });

  it('refuses an unknown id', () => {
    const { runner } = sandbox();
    const r = runner.run('quest detail quest_nope');
    expect(r.success).toBe(false);
    expect(r.output).toContain('quest_nope');
  });

  it('refuses without an id', () => {
    const { runner } = sandbox();
    expect(runner.run('quest detail').success).toBe(false);
  });
});

describe('quest complete — the scenario shortcut (#2280 C8)', () => {
  beforeAll(() => setLocale('en'));

  it('marks the quest completed without its objectives', () => {
    const { runner, state } = sandbox();
    const r = runner.run(`quest complete ${T2}`);
    expect(r.success, r.output).toBe(true);
    expect(isQuestCompleted(state, T2)).toBe(true);
    expect(state.quests!.cleanBlasts).toBe(0);
  });

  it('emits quest:completed', () => {
    const { runner, ctx } = sandbox();
    const seen: string[] = [];
    ctx.emitter.on('quest:completed', ({ questId }) => seen.push(questId));
    runner.run(`quest complete ${T2}`);
    expect(seen).toEqual([T2]);
  });

  it('refuses a quest that is already completed', () => {
    const { runner, ctx } = sandbox();
    runner.run(`quest complete ${T2}`);
    const seen: string[] = [];
    ctx.emitter.on('quest:completed', ({ questId }) => seen.push(questId));
    const r = runner.run(`quest complete ${T2}`);
    expect(r.success).toBe(false);
    expect(r.output.length).toBeGreaterThan(0);
    expect(seen).toEqual([]);
  });

  it('refuses an unknown id', () => {
    const { runner } = sandbox();
    const r = runner.run('quest complete quest_nope');
    expect(r.success).toBe(false);
    expect(r.output).toContain('quest_nope');
  });

  it('refuses on a site without quests', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('new_game mine_type:desert seed:42').success).toBe(true);
    const r = runner.run(`quest complete ${T2}`);
    expect(r.success).toBe(false);
    expect(r.output.length).toBeGreaterThan(0);
    expect(ctx.state!.quests).toBeUndefined();
  });

  it('T3 can be completed before T2, and T2 stays open', () => {
    const { runner, state } = sandbox();
    expect(runner.run(`quest complete ${T3}`).success).toBe(true);
    expect(isQuestCompleted(state, T3)).toBe(true);
    expect(isQuestCompleted(state, T2)).toBe(false);
  });
});

describe('charge refuses a locked explosive on a progression site (#2280 C8)', () => {
  beforeAll(() => setLocale('en'));

  it.each([
    ['big_bada_boom', T2],
    ['shatternite', T2],
    ['rumblox', T2],
    ['obliviax', T3],
    ['dynatomics', T3],
  ])('%s is refused, naming the explosive and the quest that opens it', (explosive, questId) => {
    const { runner } = sandbox();
    const r = runner.run(`charge hole:* explosive:${explosive} stemming:2`);
    expect(r.success).toBe(false);
    expect(r.output).toContain(nameOf(explosive));
    expect(r.output).toContain(t(getQuest(questId)!.titleKey));
  });

  it('a single-hole charge of a locked explosive is refused the same way', () => {
    const { runner } = sandbox();
    const r = runner.run('charge hole:H1 explosive:big_bada_boom stemming:2');
    expect(r.success).toBe(false);
    expect(r.output).toContain(t(getQuest(T2)!.titleKey));
  });

  it.each(['pop_rock', 'boomite', 'krackle'])('tier-1 %s is not refused for being locked', (explosive) => {
    const { runner } = sandbox();
    const r = runner.run(`charge hole:* explosive:${explosive} stemming:2`);
    expect(r.output).not.toContain(t(getQuest(T2)!.titleKey));
    expect(r.output).not.toContain(t(getQuest(T3)!.titleKey));
  });

  it('after T2 completes, a tier-2 explosive is no longer refused for its quest, but tier 3 still is', () => {
    const { runner } = sandbox();
    runner.run(`quest complete ${T2}`);
    const open = runner.run('charge hole:* explosive:big_bada_boom stemming:2');
    expect(open.output).not.toContain(t(getQuest(T2)!.titleKey));
    const locked = runner.run('charge hole:* explosive:obliviax stemming:2');
    expect(locked.success).toBe(false);
    expect(locked.output).toContain(t(getQuest(T3)!.titleKey));
  });

  it('after both complete every explosive is orderable', () => {
    const { runner } = sandbox();
    runner.run(`quest complete ${T2}`);
    runner.run(`quest complete ${T3}`);
    for (const e of ['big_bada_boom', 'obliviax', 'dynatomics']) {
      const r = runner.run(`charge hole:* explosive:${e} stemming:2`);
      expect(r.output, e).not.toContain(t(getQuest(T2)!.titleKey));
      expect(r.output, e).not.toContain(t(getQuest(T3)!.titleKey));
    }
  });

  it('a non-progression site keeps its own explosive list: no quest named', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('new_game mine_type:desert seed:42').success).toBe(true);
    ctx.state!.campaign.activeLevelId = null;
    const r = runner.run('charge hole:* explosive:dynatomics stemming:2');
    expect(r.output).not.toContain(t(getQuest(T3)!.titleKey));
  });

  it('a saved plan with a locked explosive cannot be loaded', () => {
    const { runner, state } = sandbox();
    state.savedPlans['locked'] = {
      drillHoles: [{ id: 'H1', x: 36, z: 30, depth: 8, diameter: 0.089 }],
      chargesByHole: { H1: { explosiveId: 'big_bada_boom', amountKg: 5, stemmingM: 2 } },
    };
    const r = runner.run('blast_plan load name:locked');
    expect(r.success).toBe(false);
    expect(r.output).toContain(t(getQuest(T2)!.titleKey));
  });

  it('a saved plan with a locked explosive loads once its quest is completed', () => {
    const { runner, state } = sandbox();
    state.savedPlans['locked'] = {
      drillHoles: [{ id: 'H1', x: 36, z: 30, depth: 8, diameter: 0.089 }],
      chargesByHole: { H1: { explosiveId: 'big_bada_boom', amountKg: 5, stemmingM: 2 } },
    };
    runner.run(`quest complete ${T2}`);
    const r = runner.run('blast_plan load name:locked');
    expect(r.output).not.toContain(t(getQuest(T2)!.titleKey));
  });
});

describe('the blast command books the quest counters (#2280 C3)', () => {
  beforeAll(() => setLocale('en'));

  it('a fired blast adds its charged kg and broken rock to the totals', () => {
    const { runner, state } = sandbox();
    const refresh = (): void => {
      fundForDeliveryWait(state);
      for (const e of state.employees.employees) e.fatigue = 100;
    };
    refresh();
    expect(runner.run('drill_plan grid rows:3 cols:3 spacing:4 depth:8 start:36,30').success).toBe(true);
    expect(runner.run('charge hole:* explosive:krackle amount:4 stemming:2').success).toBe(true);
    for (let i = 0; i < 5000 && !(state.drillHoles.length === 9 && Object.keys(state.chargesByHole).length === 9); i++) {
      refresh();
      runner.run('tick 1');
    }
    expect(Object.keys(state.chargesByHole)).toHaveLength(9);
    expect(state.quests!.explosiveKg).toBe(0);
    state.cash = 100_000;
    const r = runner.run('blast');
    expect(r.success, r.output).toBe(true);
    expect(state.quests!.explosiveKg).toBeCloseTo(36, 1);
    expect(state.quests!.rockKg).toBeGreaterThan(0);
    expect(state.quests!.cleanBlasts).toBeLessThanOrEqual(1);
  });
});
