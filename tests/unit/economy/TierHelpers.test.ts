// BlastSimulator2026 — tier helpers: per-tier progress, contract offers from perks, perk text (#2277)

import { describe, it, expect, beforeAll } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import {
  createGradeState, currentTierTargets, extraContractOffers, tierTargetStatuses,
} from '../../../src/core/economy/MineGrade.js';
import { tierPerkText } from '../../../src/core/economy/permitLimitText.js';
import { tierPerksAt } from '../../../src/core/economy/TierPerks.js';
import { gradeTierOfRung, rungOf, tierTargets } from '../../helpers/gradeLadder.js';

function site(grade = 0, tier = 1) {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.grade = { ...createGradeState(), grade, tier };
  return s;
}

describe('tierTargetStatuses', () => {
  it('reports every target of any tier of the current grade, with its progress', () => {
    const s = site();
    s.grade!.oreDeliveredKg = 2_000;
    const t2 = tierTargetStatuses(s, 2);
    expect(t2.map(x => x.kind)).toEqual(tierTargets(0, 2).map(x => x.kind));
    expect(t2[0]).toMatchObject({ kind: 'ore_kg', current: 2_000, met: true });
    expect(tierTargetStatuses(s, 3)[0]!.met).toBe(false);
  });

  it('is empty without a ladder, on a class and for a tier that does not exist', () => {
    expect(tierTargetStatuses(createGame({ seed: 1, mineType: 'desert' }), 1)).toEqual([]);
    expect(tierTargetStatuses(site(4), 1)).toEqual([]);
    expect(tierTargetStatuses(site(), 4)).toEqual([]);
  });

  it('currentTierTargets reads the site tier', () => {
    expect(currentTierTargets(site(1, 2)).map(x => x.needed)).toEqual(tierTargets(1, 2).map(x => x.value));
  });
});

describe('extraContractOffers', () => {
  it('is 0 without a ladder and at the first step', () => {
    expect(extraContractOffers(undefined)).toBe(0);
    expect(extraContractOffers(site().grade)).toBe(0);
  });

  it('follows the perks summed along the ladder', () => {
    for (let rung = 0; rung < 12; rung++) {
      const { grade, tier } = gradeTierOfRung(rung);
      expect(extraContractOffers(site(grade, tier).grade)).toBe(tierPerksAt(rung).extraContractOffers);
    }
    expect(extraContractOffers(site(3, 3).grade)).toBeGreaterThan(0);
    expect(extraContractOffers(site(5).grade)).toBe(extraContractOffers(site(3, 3).grade));
    expect(rungOf(3, 3)).toBe(11);
  });
});

describe('tierPerkText', () => {
  beforeAll(() => setLocale('en'));

  it('names the perk of a tier, and says so when there is none', () => {
    expect(tierPerkText(0, 1)).toBe('No perk yet');
    expect(tierPerkText(0, 2)).toContain('5%');
  });
});
