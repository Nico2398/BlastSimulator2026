// BlastSimulator2026 — quest-gated vehicle tiers on quest sites (#2282)

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  vehicleTierGate,
  vehicleTierRefusal,
  vehicleTierLockLabel,
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
import type { VehicleTier } from '../../../src/core/entities/Vehicle.js';

const V2 = 'quest_vehicle_t2';
const V3 = 'quest_vehicle_t3';
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
