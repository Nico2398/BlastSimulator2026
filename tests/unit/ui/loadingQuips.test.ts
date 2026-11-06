// loadingQuips — locale-backed quip/tip pools (#2158)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  LOADING_QUIP_COUNT,
  LOADING_TIP_COUNT,
  loadingQuips,
  loadingTips,
  QuipBag,
  TipBag,
} from '../../../src/ui/loadingQuips.js';
import { setLocale, getLocale } from '../../../src/core/i18n/I18n.js';
import en from '../../../src/core/i18n/locales/en.json';
import fr from '../../../src/core/i18n/locales/fr.json';

const enData = en as Record<string, string>;
const frData = fr as Record<string, string>;

const ORIGINAL_LOCALE = getLocale();
beforeEach(() => { setLocale('en'); });
afterEach(() => { setLocale(ORIGINAL_LOCALE); });

describe('loading pool sizes', () => {
  it('declares 34 quips and 14 tips', () => {
    expect(LOADING_QUIP_COUNT).toBe(34);
    expect(LOADING_TIP_COUNT).toBe(14);
  });
});

describe('locale files carry every quip and tip', () => {
  const cases: [string, number][] = [['quip', LOADING_QUIP_COUNT], ['tip', LOADING_TIP_COUNT]];
  for (const [kind, count] of cases) {
    for (const [name, data] of [['en', enData], ['fr', frData]] as const) {
      it(`${name}.json has loading.${kind}.0 .. ${count - 1}, all non-empty`, () => {
        for (let i = 0; i < count; i++) {
          const v = data[`loading.${kind}.${i}`];
          expect(v, `${name} loading.${kind}.${i}`).toBeTypeOf('string');
          expect(v!.trim().length, `${name} loading.${kind}.${i}`).toBeGreaterThan(0);
        }
      });

      it(`${name}.json has no loading.${kind} key beyond the declared count`, () => {
        expect(data[`loading.${kind}.${count}`]).toBeUndefined();
      });
    }

    it(`every French loading.${kind} entry differs from its English one`, () => {
      for (let i = 0; i < count; i++) {
        const key = `loading.${kind}.${i}`;
        expect(frData[key], key).not.toBe(enData[key]);
      }
    });

    it(`English loading.${kind} entries are pairwise distinct`, () => {
      const vals = Array.from({ length: count }, (_, i) => enData[`loading.${kind}.${i}`]);
      expect(new Set(vals).size).toBe(count);
    });
  }
});

describe('loadingQuips() / loadingTips()', () => {
  it('return the current-locale entries in key order on en', () => {
    setLocale('en');
    expect(loadingQuips()).toEqual(Array.from({ length: LOADING_QUIP_COUNT }, (_, i) => enData[`loading.quip.${i}`]));
    expect(loadingTips()).toEqual(Array.from({ length: LOADING_TIP_COUNT }, (_, i) => enData[`loading.tip.${i}`]));
  });

  it('return the French entries in key order on fr', () => {
    setLocale('fr');
    expect(loadingQuips()).toEqual(Array.from({ length: LOADING_QUIP_COUNT }, (_, i) => frData[`loading.quip.${i}`]));
    expect(loadingTips()).toEqual(Array.from({ length: LOADING_TIP_COUNT }, (_, i) => frData[`loading.tip.${i}`]));
  });

  it('have the declared lengths and no key-shaped placeholders', () => {
    for (const locale of ['en', 'fr'] as const) {
      setLocale(locale);
      expect(loadingQuips()).toHaveLength(LOADING_QUIP_COUNT);
      expect(loadingTips()).toHaveLength(LOADING_TIP_COUNT);
      for (const line of [...loadingQuips(), ...loadingTips()]) expect(line).not.toMatch(/^loading\.(quip|tip)\./);
    }
  });

  it('follow a locale switch without any reload', () => {
    setLocale('en');
    const a = loadingQuips()[0];
    setLocale('fr');
    const b = loadingQuips()[0];
    expect(a).not.toBe(b);
    setLocale('en');
    expect(loadingQuips()[0]).toBe(a);
  });
});

describe('QuipBag and TipBag draw without repeat, then reshuffle', () => {
  it('QuipBag yields each quip once per pass and reports remainingCount', () => {
    const bag = new QuipBag(() => 0.5);
    expect(bag.remainingCount).toBe(LOADING_QUIP_COUNT);
    const seen = new Set<string>();
    for (let i = 0; i < LOADING_QUIP_COUNT; i++) {
      seen.add(bag.next());
      expect(bag.remainingCount).toBe(LOADING_QUIP_COUNT - i - 1);
    }
    expect([...seen].sort()).toEqual([...loadingQuips()].sort());
  });

  it('TipBag yields each tip once per pass and reports remainingCount', () => {
    const bag = new TipBag(() => 0.5);
    expect(bag.remainingCount).toBe(LOADING_TIP_COUNT);
    const seen = new Set<string>();
    for (let i = 0; i < LOADING_TIP_COUNT; i++) {
      seen.add(bag.next());
      expect(bag.remainingCount).toBe(LOADING_TIP_COUNT - i - 1);
    }
    expect([...seen].sort()).toEqual([...loadingTips()].sort());
  });

  it('QuipBag reshuffles after exhaustion and covers the pool again', () => {
    const bag = new QuipBag(() => 0);
    for (let i = 0; i < LOADING_QUIP_COUNT; i++) bag.next();
    const second = new Set<string>();
    for (let i = 0; i < LOADING_QUIP_COUNT; i++) second.add(bag.next());
    expect(second.size).toBe(LOADING_QUIP_COUNT);
  });

  it('TipBag reshuffles after exhaustion and covers the pool again', () => {
    const bag = new TipBag(() => 0);
    for (let i = 0; i < LOADING_TIP_COUNT; i++) bag.next();
    const second = new Set<string>();
    for (let i = 0; i < LOADING_TIP_COUNT; i++) second.add(bag.next());
    expect(second.size).toBe(LOADING_TIP_COUNT);
  });

  it('the injected random source decides the order', () => {
    const order = (r: () => number) => {
      const bag = new QuipBag(r);
      return Array.from({ length: 6 }, () => bag.next()).join('|');
    };
    expect(order(() => 0)).not.toBe(order(() => 0.999));
    expect(order(() => 0.25)).toBe(order(() => 0.25));
  });
});
