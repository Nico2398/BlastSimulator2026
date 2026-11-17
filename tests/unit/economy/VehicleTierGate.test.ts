// BlastSimulator2026 — quest-gated vehicle tiers on quest sites (#2282)

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  vehicleTierGate,
  vehicleTierRefusal,
  vehicleTierLockLabel,
  vehicleLock,
  vehicleLockLabel,
} from '../../../src/core/economy/VehicleTierGate.js';
import { unlockLinesFor, createGradeState } from '../../../src/core/economy/MineGrade.js';
import { createQuestState, completeQuest } from '../../../src/core/economy/Quests.js';
import { getQuest } from '../../../src/core/economy/QuestCatalog.js';
import * as balance from '../../../src/core/config/balance.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { createRunner } from '../../../src/console/createRunner.js';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';
import en from '../../../src/core/i18n/locales/en.json';
import fr from '../../../src/core/i18n/locales/fr.json';
import { getAllVehicleRoles, getVehicleDefByTier, type VehicleRole, type VehicleTier } from '../../../src/core/entities/Vehicle.js';

const V2 = 'quest_vehicle_t2';
const V3 = 'quest_vehicle_t3';
const RACE = 'quest_race_car';
const TIERS: VehicleTier[] = [1, 2, 3];

function questSite(): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.grade = createGradeState();
  s.quests = createQuestState();
  return s;
}

const title = (id: string): string => t(getQuest(id)!.titleKey);

describe('VehicleTierGate (#2282)', () => {
  beforeAll(() => setLocale('en'));
  afterEach(() => setLocale('en'));

  describe('vehicleTierGate', () => {
    it('a site without quests never gates any tier', () => {
      for (const tier of TIERS) expect(vehicleTierGate({}, tier)).toBeNull();
    });

    it('tier 1 is never gated, completed quests or not', () => {
      expect(vehicleTierGate(questSite(), 1)).toBeNull();
      const s = questSite();
      completeQuest(s, V2);
      completeQuest(s, V3);
      expect(vehicleTierGate(s, 1)).toBeNull();
    });

    it('tier 2 names the tier-2 vehicle quest until it is completed', () => {
      const s = questSite();
      expect(vehicleTierGate(s, 2)?.id).toBe(V2);
      completeQuest(s, V2);
      expect(vehicleTierGate(s, 2)).toBeNull();
    });

    it('tier 3 names the tier-3 vehicle quest until it is completed', () => {
      const s = questSite();
      expect(vehicleTierGate(s, 3)?.id).toBe(V3);
      completeQuest(s, V2);
      expect(vehicleTierGate(s, 3)?.id).toBe(V3);
      completeQuest(s, V3);
      expect(vehicleTierGate(s, 3)).toBeNull();
    });

    it('completing tier 3 alone leaves tier 2 gated: each tier follows its own quest', () => {
      const s = questSite();
      completeQuest(s, V3);
      expect(vehicleTierGate(s, 2)?.id).toBe(V2);
      expect(vehicleTierGate(s, 3)).toBeNull();
    });

    it('the explosive quests open no vehicle tier', () => {
      const s = questSite();
      completeQuest(s, 'quest_explosive_t2');
      completeQuest(s, 'quest_explosive_t3');
      expect(vehicleTierGate(s, 2)?.id).toBe(V2);
      expect(vehicleTierGate(s, 3)?.id).toBe(V3);
    });

    it.each([0, 1, 2, 3, 4, 9])('the permit grade %i never matters', (grade) => {
      const s = questSite();
      s.grade!.grade = grade;
      expect(vehicleTierGate(s, 2)?.id).toBe(V2);
      expect(vehicleTierGate(s, 3)?.id).toBe(V3);
      completeQuest(s, V2);
      expect(vehicleTierGate(s, 2)).toBeNull();
    });

    it('works on a state without grade state at all', () => {
      const s = createGame({ seed: 42, mineType: 'desert' });
      s.quests = createQuestState();
      expect(vehicleTierGate(s, 2)?.id).toBe(V2);
    });
  });

  describe('vehicleTierRefusal', () => {
    it('is null when allowed: no quests, tier 1, or the quest done', () => {
      expect(vehicleTierRefusal({}, 3)).toBeNull();
      expect(vehicleTierRefusal(questSite(), 1)).toBeNull();
      const s = questSite();
      completeQuest(s, V2);
      expect(vehicleTierRefusal(s, 2)).toBeNull();
    });

    it('is the dealer refusal naming the quest title when gated', () => {
      const s = questSite();
      const two = vehicleTierRefusal(s, 2);
      const three = vehicleTierRefusal(s, 3);
      expect(two).toBe(t('vehicle.tier_locked', { quest: title(V2) }));
      expect(three).toBe(t('vehicle.tier_locked', { quest: title(V3) }));
      expect(two).toContain(title(V2));
      expect(three).toContain(title(V3));
      expect(two).not.toMatch(/\{\w+\}|vehicle\.tier_locked/);
    });

    it('follows the active locale', () => {
      const s = questSite();
      const en1 = vehicleTierRefusal(s, 2);
      setLocale('fr');
      const fr1 = vehicleTierRefusal(s, 2);
      expect(fr1).not.toBe(en1);
      expect(fr1).toContain(title(V2));
    });
  });

  describe('vehicleTierLockLabel', () => {
    it('names the quest title', () => {
      expect(vehicleTierLockLabel(getQuest(V2)!)).toBe(t('ui.fleet.tier_locked', { quest: title(V2) }));
      expect(vehicleTierLockLabel(getQuest(V3)!)).toContain(title(V3));
      expect(vehicleTierLockLabel(getQuest(V2)!)).not.toMatch(/\{\w+\}|ui\.fleet\.tier_locked/);
    });

    it('differs between the two quests', () => {
      expect(vehicleTierLockLabel(getQuest(V2)!)).not.toBe(vehicleTierLockLabel(getQuest(V3)!));
    });
  });

  describe('the grade ladder no longer unlocks vehicle tiers', () => {
    it('VEHICLE_TIER_UNLOCK_GRADE is gone from balance', () => {
      expect('VEHICLE_TIER_UNLOCK_GRADE' in balance).toBe(false);
    });

    it('no grade carries a vehicle-tier unlock line', () => {
      for (const g of [0, 1, 2, 3, 4, 5, 9]) {
        expect(unlockLinesFor(g).map(l => l.key).filter(k => k.includes('vehicle_tier')), `grade ${g}`).toEqual([]);
      }
    });

    it('the unlock-line locale keys are removed in en and fr', () => {
      for (const locale of [en, fr] as Record<string, string>[]) {
        expect(Object.keys(locale).filter(k => k.startsWith('progression.unlock.vehicle_tier'))).toEqual([]);
      }
    });
  });

  describe('locale keys', () => {
    it.each(['quest.giver.dealer', 'quest.vehicle_t2.title', 'quest.vehicle_t2.pitch', 'quest.vehicle_t3.title',
      'quest.vehicle_t3.pitch', 'quest.reward.vehicle_tier', 'vehicle.tier_locked', 'ui.fleet.tier_locked',
      'notification.quest.completed_vehicles'])('%s has real, different text in en and fr', (key) => {
      const e = en as Record<string, string>;
      const f = fr as Record<string, string>;
      expect(e[key], `en ${key}`).toBeTruthy();
      expect(f[key], `fr ${key}`).toBeTruthy();
      expect(f[key], `fr differs ${key}`).not.toBe(e[key]);
    });

    it('the refusal and the lock label take {quest}, not the old grade placeholders', () => {
      for (const locale of [en, fr] as Record<string, string>[]) {
        expect(locale['vehicle.tier_locked']).toContain('{quest}');
        expect(locale['ui.fleet.tier_locked']).toContain('{quest}');
        expect(locale['vehicle.tier_locked']).not.toMatch(/\{(current|needed)\}/);
        expect(locale['ui.fleet.tier_locked']).not.toContain('{grade}');
      }
    });
  });

  describe('console vehicle buy / upgrade on a quest site', () => {
    function site() {
      const { runner, ctx } = createRunner();
      expect(runner.run('sandbox start biome:desert_badlands seed:42').success).toBe(true);
      ctx.state!.cash = 500_000_000;
      return { runner, ctx, state: ctx.state! };
    }

    it('buying a tier-2 vehicle is refused with the quest-naming text, buying nothing and charging nothing', () => {
      const { runner, state } = site();
      const before = { n: state.vehicles.vehicles.length, cash: state.cash };
      const r = runner.run('vehicle buy debris_hauler tier:2');
      expect(r.success).toBe(false);
      expect(r.output).toBe(vehicleTierRefusal(state, 2));
      expect(r.output).toContain(title(V2));
      expect(state.vehicles.vehicles.length).toBe(before.n);
      expect(state.cash).toBe(before.cash);
    });

    it('buying a tier-3 vehicle names the tier-3 quest, even with the tier-2 quest done', () => {
      const { runner, state } = site();
      completeQuest(state, V2);
      const r = runner.run('vehicle buy debris_hauler tier:3');
      expect(r.success).toBe(false);
      expect(r.output).toContain(title(V3));
    });

    it('tier 1 stays purchasable', () => {
      const { runner, state } = site();
      const n = state.vehicles.vehicles.length;
      expect(runner.run('vehicle buy debris_hauler tier:1').success).toBe(true);
      expect(state.vehicles.vehicles.length).toBe(n + 1);
    });

    it('a completed quest opens its tier at the usual price', () => {
      const { runner, state } = site();
      completeQuest(state, V2);
      const n = state.vehicles.vehicles.length;
      expect(runner.run('vehicle buy debris_hauler tier:2').success).toBe(true);
      expect(state.vehicles.vehicles.length).toBe(n + 1);
    });

    it('the permit grade alone does not open a tier', () => {
      const { runner, state } = site();
      state.grade!.grade = 3;
      expect(runner.run('vehicle buy debris_hauler tier:2').success).toBe(false);
    });

    it('upgrading a tier-1 vehicle is refused naming the quest, leaving tier and cash alone', () => {
      const { runner, state } = site();
      expect(runner.run('vehicle buy debris_hauler tier:1').success).toBe(true);
      const v = state.vehicles.vehicles[state.vehicles.vehicles.length - 1]!;
      const cash = state.cash;
      const r = runner.run(`vehicle upgrade ${v.id}`);
      expect(r.success).toBe(false);
      expect(r.output).toContain(title(V2));
      expect(v.tier).toBe(1);
      expect(state.cash).toBe(cash);
    });

    it('upgrading works once the quest is completed', () => {
      const { runner, state } = site();
      expect(runner.run('vehicle buy debris_hauler tier:1').success).toBe(true);
      const v = state.vehicles.vehicles[state.vehicles.vehicles.length - 1]!;
      completeQuest(state, V2);
      expect(runner.run(`vehicle upgrade ${v.id}`).success).toBe(true);
      expect(v.tier).toBe(2);
    });

    it('a site without quests sells every tier', () => {
      const { runner, ctx } = createRunner();
      expect(runner.run('new_game mine_type:desert seed:42').success).toBe(true);
      ctx.state!.cash = 500_000_000;
      expect(ctx.state!.quests).toBeUndefined();
      expect(runner.run('vehicle buy debris_hauler tier:3').success).toBe(true);
    });
  });
});

// ── Travel role locks (#2285 C4, C5, C7) ─────────────────────────────────────

const WORK_ROLES = (): VehicleRole[] => getAllVehicleRoles().filter(r => r !== 'travel_vehicle');
const gradeOf = (s: GameState, grade: number): GameState => { s.grade!.grade = grade; return s; };

describe('vehicleLock (#2285 C4)', () => {
  beforeAll(() => setLocale('en'));
  afterEach(() => setLocale('en'));

  it('the balance names grade 2 as the shuttle unlock', () => {
    expect(balance.TRAVEL_VEHICLE_UNLOCK_GRADE).toBe(2);
  });

  describe('work roles', () => {
    it('lock exactly as vehicleTierGate does, as a quest lock', () => {
      for (const role of WORK_ROLES()) {
        const s = questSite();
        expect(vehicleLock(s, role, 1), `${role} 1`).toBeNull();
        const two = vehicleLock(s, role, 2);
        expect(two?.kind, `${role} 2`).toBe('quest');
        expect(two && two.kind === 'quest' ? two.quest.id : null).toBe(V2);
        const three = vehicleLock(s, role, 3);
        expect(three && three.kind === 'quest' ? three.quest.id : null).toBe(V3);
      }
    });

    it('open once their quest is completed', () => {
      const s = questSite();
      completeQuest(s, V2);
      expect(vehicleLock(s, 'drill_rig', 2)).toBeNull();
      expect(vehicleLock(s, 'drill_rig', 3)?.kind).toBe('quest');
    });

    it('a site without quests never locks a work role', () => {
      const s = createGame({ seed: 42, mineType: 'desert' });
      for (const role of WORK_ROLES()) for (const tier of TIERS) expect(vehicleLock(s, role, tier)).toBeNull();
    });

    it('the permit grade never locks a work role', () => {
      for (const grade of [0, 1, 2, 5]) expect(vehicleLock(gradeOf(questSite(), grade), 'debris_hauler', 1)).toBeNull();
    });
  });

  describe('travel tier 1 (the shuttle): the mine grade', () => {
    it.each([0, 1])('grade %i on a progression site is a grade lock naming grade 2', (grade) => {
      expect(vehicleLock(gradeOf(questSite(), grade), 'travel_vehicle', 1)).toEqual({ kind: 'grade', grade: 2 });
    });

    it.each([2, 3, 9])('grade %i opens the shuttle', (grade) => {
      expect(vehicleLock(gradeOf(questSite(), grade), 'travel_vehicle', 1)).toBeNull();
    });

    it('a non-progression site (no grade state) is never locked', () => {
      const s = createGame({ seed: 42, mineType: 'desert' });
      expect(s.grade).toBeUndefined();
      expect(vehicleLock(s, 'travel_vehicle', 1)).toBeNull();
    });

    it('a grade-only site (grade state, no quests) still locks below grade 2', () => {
      const s = createGame({ seed: 42, mineType: 'desert' });
      s.grade = createGradeState();
      expect(vehicleLock(s, 'travel_vehicle', 1)).toEqual({ kind: 'grade', grade: 2 });
    });

    it('is independent of every quest: completing the race-car and vehicle quests opens nothing below grade 2', () => {
      const s = questSite();
      completeQuest(s, RACE);
      completeQuest(s, V2);
      completeQuest(s, V3);
      expect(vehicleLock(s, 'travel_vehicle', 1)).toEqual({ kind: 'grade', grade: 2 });
    });
  });

  describe('travel tier 2 (the race car): the dealer quest', () => {
    it('on a quest site is the race-car quest until it is completed', () => {
      const s = gradeOf(questSite(), 2);
      const lock = vehicleLock(s, 'travel_vehicle', 2);
      expect(lock?.kind).toBe('quest');
      expect(lock && lock.kind === 'quest' ? lock.quest.id : null).toBe(RACE);
      completeQuest(s, RACE);
      expect(vehicleLock(s, 'travel_vehicle', 2)).toBeNull();
    });

    it('a site without quests never quest-locks it', () => {
      const s = createGame({ seed: 42, mineType: 'desert' });
      expect(vehicleLock(s, 'travel_vehicle', 2)).toBeNull();
    });

    it('never reads the grade: the quest alone opens it at grade 0, and grade 9 does not open it', () => {
      const low = gradeOf(questSite(), 0);
      completeQuest(low, RACE);
      expect(vehicleLock(low, 'travel_vehicle', 2)).toBeNull();
      const high = gradeOf(questSite(), 9);
      expect(vehicleLock(high, 'travel_vehicle', 2)?.kind).toBe('quest');
    });

    it('is not opened by the work-fleet tier-2 quest', () => {
      const s = gradeOf(questSite(), 2);
      completeQuest(s, V2);
      expect(vehicleLock(s, 'travel_vehicle', 2)?.kind).toBe('quest');
    });

    it('the work-fleet tier-2 lock is unaffected by the race-car quest', () => {
      const s = questSite();
      completeQuest(s, RACE);
      expect(vehicleLock(s, 'debris_hauler', 2)?.kind).toBe('quest');
    });
  });
});

describe('vehicleTierRefusal by role (#2285 C5)', () => {
  beforeAll(() => setLocale('en'));
  afterEach(() => setLocale('en'));

  it('role defaults to a work role: the existing text is unchanged', () => {
    const s = questSite();
    expect(vehicleTierRefusal(s, 2)).toBe(t('vehicle.tier_locked', { quest: title(V2) }));
    expect(vehicleTierRefusal(s, 2, 'debris_hauler')).toBe(vehicleTierRefusal(s, 2));
  });

  it('the grade lock text names the grade ("Distance") and "G2"', () => {
    const text = vehicleTierRefusal(questSite(), 1, 'travel_vehicle');
    expect(text).not.toBeNull();
    expect(text).toContain(t('permit.grade.2'));
    expect(text).toContain('G2');
    expect(text).not.toMatch(/\{\w+\}|vehicle\.travel_grade_locked/);
  });

  it('the race-car lock text contains the quest title', () => {
    const text = vehicleTierRefusal(gradeOf(questSite(), 2), 2, 'travel_vehicle');
    expect(text).not.toBeNull();
    expect(text).toContain(title(RACE));
    expect(text).not.toMatch(/\{\w+\}/);
  });

  it('is null when the travel tier is allowed', () => {
    expect(vehicleTierRefusal(gradeOf(questSite(), 2), 1, 'travel_vehicle')).toBeNull();
    const s = gradeOf(questSite(), 2);
    completeQuest(s, RACE);
    expect(vehicleTierRefusal(s, 2, 'travel_vehicle')).toBeNull();
    expect(vehicleTierRefusal({}, 1, 'travel_vehicle')).toBeNull();
    expect(vehicleTierRefusal({}, 2, 'travel_vehicle')).toBeNull();
  });

  it('follows the active locale and names the localized grade in French', () => {
    const s = questSite();
    const en1 = vehicleTierRefusal(s, 1, 'travel_vehicle');
    setLocale('fr');
    const fr1 = vehicleTierRefusal(s, 1, 'travel_vehicle');
    expect(fr1).not.toBe(en1);
    expect(fr1).toContain(t('permit.grade.2'));
    expect(fr1).toContain('G2');
  });
});

describe('vehicleLockLabel (#2285 C5)', () => {
  beforeAll(() => setLocale('en'));

  it('a quest lock is the existing quest lock label', () => {
    const quest = getQuest(RACE)!;
    expect(vehicleLockLabel({ kind: 'quest', quest })).toBe(vehicleTierLockLabel(quest));
  });

  it('a grade lock names G2 and the grade, with no raw key or placeholder', () => {
    const label = vehicleLockLabel({ kind: 'grade', grade: 2 });
    expect(label).toContain('G2');
    expect(label).toContain(t('permit.grade.2'));
    expect(label).not.toMatch(/\{\w+\}|ui\.fleet\.grade_locked/);
  });

  it('the grade label differs from a quest label', () => {
    expect(vehicleLockLabel({ kind: 'grade', grade: 2 })).not.toBe(vehicleLockLabel({ kind: 'quest', quest: getQuest(RACE)! }));
  });
});

describe('travel locale keys (#2285)', () => {
  it.each(['vehicle_type.travel_vehicle', 'vehicle.travel_vehicle.tier1', 'vehicle.travel_vehicle.tier2',
    'quest.race_car.title', 'quest.race_car.pitch'])('%s has real, different text in en and fr', (key) => {
    const e = en as Record<string, string>;
    const f = fr as Record<string, string>;
    expect(e[key], `en ${key}`).toBeTruthy();
    expect(f[key], `fr ${key}`).toBeTruthy();
    expect(f[key], `fr differs ${key}`).not.toBe(e[key]);
  });
});

describe('console vehicle buy / upgrade for the travel role (#2285 C7)', () => {
  beforeAll(() => setLocale('en'));
  afterEach(() => setLocale('en'));

  function site() {
    const { runner, ctx } = createRunner();
    expect(runner.run('sandbox start biome:desert_badlands seed:42').success).toBe(true);
    ctx.state!.cash = 500_000_000;
    return { runner, ctx, state: ctx.state! };
  }
  const travelCount = (s: GameState): number => s.vehicles.vehicles.filter(v => v.type === 'travel_vehicle').length;

  it('on a site with neither grade nor quests every legal tier is sold', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('new_game mine_type:desert seed:42').success).toBe(true);
    ctx.state!.cash = 500_000_000;
    expect(runner.run('vehicle buy travel_vehicle').success).toBe(true);
    expect(runner.run('vehicle buy travel_vehicle tier:2').success).toBe(true);
    expect(travelCount(ctx.state!)).toBe(2);
  });

  it('below grade 2 the shuttle is refused naming G2, buying nothing and charging nothing', () => {
    const { runner, state } = site();
    expect(state.grade!.grade).toBeLessThan(2);
    const cash = state.cash;
    const r = runner.run('vehicle buy travel_vehicle tier:1');
    expect(r.success).toBe(false);
    expect(r.output).toBe(vehicleTierRefusal(state, 1, 'travel_vehicle'));
    expect(r.output).toContain('G2');
    expect(travelCount(state)).toBe(0);
    expect(state.cash).toBe(cash);
  });

  it('a bare `vehicle buy travel_vehicle` means tier 1 and is refused the same way', () => {
    const { runner } = site();
    const r = runner.run('vehicle buy travel_vehicle');
    expect(r.success).toBe(false);
    expect(r.output).toContain('G2');
  });

  it('at grade 2 the shuttle is bought at its price, as a tier-1 travel vehicle', () => {
    const { runner, state } = site();
    state.grade!.grade = 2;
    const cash = state.cash;
    const r = runner.run('vehicle buy travel_vehicle tier:1');
    expect(r.success).toBe(true);
    expect(travelCount(state)).toBe(1);
    const v = state.vehicles.vehicles.find(x => x.type === 'travel_vehicle')!;
    expect(v.tier).toBe(1);
    expect(cash - state.cash).toBe(getVehicleDefByTier('travel_vehicle', 1).purchaseCost);
  });

  it('the race car is refused at grade 2 until the race-car quest is completed, naming the quest', () => {
    const { runner, state } = site();
    state.grade!.grade = 2;
    const r = runner.run('vehicle buy travel_vehicle tier:2');
    expect(r.success).toBe(false);
    expect(r.output).toContain(title(RACE));
    expect(travelCount(state)).toBe(0);
    completeQuest(state, RACE);
    expect(runner.run('vehicle buy travel_vehicle tier:2').success).toBe(true);
    expect(state.vehicles.vehicles.find(v => v.type === 'travel_vehicle')!.tier).toBe(2);
  });

  it('the race-car quest alone does not open the shuttle below grade 2', () => {
    const { runner, state } = site();
    completeQuest(state, RACE);
    expect(runner.run('vehicle buy travel_vehicle tier:1').success).toBe(false);
    expect(runner.run('vehicle buy travel_vehicle tier:2').success).toBe(true);
  });

  it('tier 3 is refused with a usage message even with every lock open, buying and charging nothing', () => {
    const { runner, state } = site();
    state.grade!.grade = 9;
    completeQuest(state, RACE);
    completeQuest(state, V2);
    completeQuest(state, V3);
    const cash = state.cash;
    const r = runner.run('vehicle buy travel_vehicle tier:3');
    expect(r.success).toBe(false);
    expect(r.output.length).toBeGreaterThan(0);
    expect(r.output).not.toMatch(/^vehicle\./);
    expect(travelCount(state)).toBe(0);
    expect(state.cash).toBe(cash);
  });

  it('tier 3 is also refused on a site without grade or quests', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game mine_type:desert seed:42');
    ctx.state!.cash = 500_000_000;
    expect(runner.run('vehicle buy travel_vehicle tier:3').success).toBe(false);
    expect(travelCount(ctx.state!)).toBe(0);
  });

  it('a work role still sells tier 3 on a quest-free site (unchanged)', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game mine_type:desert seed:42');
    ctx.state!.cash = 500_000_000;
    expect(runner.run('vehicle buy debris_hauler tier:3').success).toBe(true);
  });

  it('insufficient cash refuses the shuttle and buys nothing', () => {
    const { runner, state } = site();
    state.grade!.grade = 2;
    state.cash = getVehicleDefByTier('travel_vehicle', 1).purchaseCost - 1;
    expect(runner.run('vehicle buy travel_vehicle').success).toBe(false);
    expect(travelCount(state)).toBe(0);
  });

  it('the usage message for an unknown role lists the travel role', () => {
    const { runner } = site();
    const r = runner.run('vehicle buy nonsense');
    expect(r.success).toBe(false);
    expect(r.output).toContain('travel_vehicle');
  });

  it('`vehicle list` lists a bought travel vehicle with its role name', () => {
    const { runner, state } = site();
    state.grade!.grade = 2;
    runner.run('vehicle buy travel_vehicle');
    const v = state.vehicles.vehicles.find(x => x.type === 'travel_vehicle')!;
    const out = runner.run('vehicle list').output;
    expect(out).toContain(`[${v.id}] travel_vehicle`);
  });

  it('`vehicle scrap` removes it and refunds like any other role', () => {
    const { runner, state } = site();
    state.grade!.grade = 2;
    runner.run('vehicle buy travel_vehicle');
    const v = state.vehicles.vehicles.find(x => x.type === 'travel_vehicle')!;
    const cash = state.cash;
    expect(runner.run(`vehicle scrap ${v.id}`).success).toBe(true);
    expect(travelCount(state)).toBe(0);
    expect(state.cash).toBeGreaterThan(cash);
  });

  it('upgrading a shuttle to a race car is refused naming the quest until it is completed, then works at the price difference', () => {
    const { runner, state } = site();
    state.grade!.grade = 2;
    runner.run('vehicle buy travel_vehicle');
    const v = state.vehicles.vehicles.find(x => x.type === 'travel_vehicle')!;
    const before = state.cash;
    const refused = runner.run(`vehicle upgrade ${v.id}`);
    expect(refused.success).toBe(false);
    expect(refused.output).toContain(title(RACE));
    expect(v.tier).toBe(1);
    expect(state.cash).toBe(before);
    completeQuest(state, RACE);
    expect(runner.run(`vehicle upgrade ${v.id}`).success).toBe(true);
    expect(v.tier).toBe(2);
    expect(before - state.cash).toBe(
      getVehicleDefByTier('travel_vehicle', 2).purchaseCost - getVehicleDefByTier('travel_vehicle', 1).purchaseCost,
    );
  });

  it('a race car cannot be upgraded: the max-tier refusal, tier and cash untouched', () => {
    const { runner, state } = site();
    completeQuest(state, RACE);
    runner.run('vehicle buy travel_vehicle tier:2');
    const v = state.vehicles.vehicles.find(x => x.type === 'travel_vehicle')!;
    const cash = state.cash;
    const r = runner.run(`vehicle upgrade ${v.id}`);
    expect(r.success).toBe(false);
    expect(v.tier).toBe(2);
    expect(state.cash).toBe(cash);
  });
});
