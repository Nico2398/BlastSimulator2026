import { describe, it, expect, afterEach } from 'vitest';
import {
  skillLevelExplain, moraleExplain, fatigueExplain, licenceExplain,
  salaryExplain, unionExplain, ticksLeftExplain,
} from '../../../src/ui/statExplain.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import {
  PROFICIENCY_MULTIPLIERS, XP_THRESHOLDS, MORALE_THRESHOLDS, NEED_THRESHOLDS,
  PAY_CYCLE_TICKS, UNION_MEMBER_SALARY_DISCOUNT_PCT,
} from '../../../src/core/config/balance.js';

afterEach(() => setLocale('en'));

const LEVELS = [1, 2, 3, 4, 5] as const;

describe('skillLevelExplain', () => {
  for (const level of LEVELS) {
    it(`level ${level} names its task-duration multiplier`, () => {
      expect(skillLevelExplain(level)).toContain(PROFICIENCY_MULTIPLIERS[level].toFixed(2));
    });
  }

  for (const level of [1, 2, 3, 4] as const) {
    it(`level ${level} names the XP needed for level ${level + 1}`, () => {
      const next = (level + 1) as 2 | 3 | 4 | 5;
      expect(skillLevelExplain(level)).toContain(String(XP_THRESHOLDS[next]));
    });
  }

  it('levels read differently from each other', () => {
    const texts = new Set(LEVELS.map(l => skillLevelExplain(l)));
    expect(texts.size).toBe(LEVELS.length);
  });

  it('level 5, the top, still has a text', () => {
    expect(skillLevelExplain(5).trim().length).toBeGreaterThan(0);
  });

  it('is translated: differs between en and fr and is never a bare key', () => {
    setLocale('en');
    const en = skillLevelExplain(2);
    setLocale('fr');
    const fr = skillLevelExplain(2);
    expect(en).not.toMatch(/^ui\./);
    expect(fr).not.toMatch(/^ui\./);
    expect(fr).not.toBe(en);
    expect(fr).toContain(PROFICIENCY_MULTIPLIERS[2].toFixed(2));
  });
});

describe('moraleExplain', () => {
  it('names both morale thresholds', () => {
    const text = moraleExplain();
    expect(text).toContain(String(MORALE_THRESHOLDS.low));
    expect(text).toContain(String(MORALE_THRESHOLDS.high));
  });
});

describe('fatigueExplain', () => {
  it('names the low fatigue threshold', () => {
    expect(fatigueExplain()).toContain(String(NEED_THRESHOLDS.fatigue.low));
  });
});

describe('licenceExplain', () => {
  for (const tier of [1, 2, 3]) {
    it(`tier ${tier} names its tier number`, () => {
      expect(licenceExplain(tier)).toContain(String(tier));
    });
  }

  it('tiers read differently from each other', () => {
    expect(new Set([1, 2, 3].map(licenceExplain)).size).toBe(3);
  });
});

describe('salaryExplain', () => {
  it('names the pay cycle length', () => {
    expect(salaryExplain()).toContain(String(PAY_CYCLE_TICKS));
  });
});

describe('unionExplain', () => {
  it('names the member salary discount', () => {
    expect(unionExplain()).toContain(String(UNION_MEMBER_SALARY_DISCOUNT_PCT));
  });
});

describe('ticksLeftExplain', () => {
  it('is non-empty text', () => {
    expect(ticksLeftExplain().length).toBeGreaterThan(0);
    expect(ticksLeftExplain()).not.toMatch(/^ui\./);
  });
});

describe('every stat text', () => {
  const texts: Array<[string, () => string]> = [
    ['skillLevelExplain', () => skillLevelExplain(3)],
    ['moraleExplain', moraleExplain],
    ['fatigueExplain', fatigueExplain],
    ['licenceExplain', () => licenceExplain(2)],
    ['salaryExplain', salaryExplain],
    ['unionExplain', unionExplain],
    ['ticksLeftExplain', ticksLeftExplain],
  ];

  for (const [name, fn] of texts) {
    it(`${name} is non-empty and differs between en and fr`, () => {
      setLocale('en');
      const en = fn();
      setLocale('fr');
      const fr = fn();
      expect(en.trim().length).toBeGreaterThan(0);
      expect(fr.trim().length).toBeGreaterThan(0);
      expect(en).not.toMatch(/^ui\.[a-z_.]+$/);
      expect(fr).not.toMatch(/^ui\.[a-z_.]+$/);
      expect(fr).not.toBe(en);
    });
  }

  it('the seven texts differ from one another', () => {
    setLocale('en');
    expect(new Set(texts.map(([, fn]) => fn())).size).toBe(texts.length);
  });
});
