// Issue #1538 — the #1414 effect catalog must be spread across the event pool.
// Data-driven over getAllEvents() and both locales; every rule collects its
// offenders into one list so a failure shows the whole backlog at once.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { setupEvents } from '../../../src/core/events/index.js';
import { getAllEvents } from '../../../src/core/events/EventPool.js';
import type { EventDef, EventConsequence, EventCategory } from '../../../src/core/events/EventPool.js';
import type { EventEffectSpec } from '../../../src/core/events/EventEffectCatalog.js';
import { FOLLOWUP_EVENTS } from '../../../src/core/events/FollowUpEvents.js';

const ROOT = join(import.meta.dirname, '../../..');
const LOCALE_DIR = join(ROOT, 'src/core/i18n/locales');
const load = (f: string): Record<string, string> => JSON.parse(readFileSync(join(LOCALE_DIR, f), 'utf8'));
const en = load('en.json');
const fr = load('fr.json');

const SPREAD_CATEGORIES = ['union', 'politics', 'weather', 'mafia', 'lawsuit'] as const satisfies readonly EventCategory[];
type SpreadCategory = (typeof SPREAD_CATEGORIES)[number];

/** Minimum distinct effect kinds per category's main-pool events. */
const CATEGORY_MIN_DISTINCT: Record<SpreadCategory, number> = {
  union: 6, politics: 6, weather: 6, mafia: 6, lawsuit: 6,
};
const FOLLOWUP_MIN_DISTINCT = 5;

/** Minimum share of events that carry a lasting effect. */
const OVERALL_MIN_LASTING_SHARE = 0.75;
const CATEGORY_MIN_SHARE: Record<SpreadCategory, number> = {
  union: 0.6, politics: 0.6, weather: 0.6, mafia: 0.6, lawsuit: 0.6,
};
const FOLLOWUP_MIN_LASTING = 8;

/** No single effect kind may exceed this share of a category's specs. */
const MAX_KIND_SHARE = 0.3;

const LASTING_KINDS: ReadonlySet<string> = new Set([
  'work_stoppage', 'work_rate', 'morale_shift', 'salary', 'recurring_charge', 'ban', 'cost_factor',
  'contract_price', 'forced_weather', 'event_weight', 'employee_leaves', 'employee_joins', 'cancel_contract',
]);
const HOUR_KINDS: ReadonlySet<string> = new Set(['work_stoppage', 'work_rate', 'morale_shift', 'ban', 'forced_weather']);
const DAY_KINDS: ReadonlySet<string> = new Set(['salary', 'recurring_charge', 'cost_factor', 'contract_price', 'event_weight']);
const ALT_KINDS: ReadonlySet<string> = new Set(['employee_leaves', 'employee_injured', 'cancel_contract']);

const EVENT_SOURCE_FILES = [
  'UnionEvents1', 'UnionEvents2', 'PoliticsEvents1', 'PoliticsEvents2', 'WeatherEvents1', 'WeatherEvents2',
  'MafiaEvents1', 'MafiaEvents2', 'LawsuitEvents1', 'LawsuitEvents2', 'FollowUpEvents',
].map(f => join(ROOT, 'src/core/events', `${f}.ts`));
const RAW_LITERAL = /\b(hours|days|pct|perDay|perHour|amount)\s*:\s*-?\d/;

/** Catalog kinds: the `ui.event.effect.<kind>` keys, minus what.* / pick.* sub-keys, scope_all and the _permanent variant. */
const CATALOG_KINDS = new Set(
  Object.keys(en)
    .map(k => /^ui\.event\.effect\.([a-z_]+)$/.exec(k)?.[1])
    .filter((k): k is string => k !== undefined && k !== 'scope_all' && !k.endsWith('_permanent')),
);

/** TODO(#1568): effects the engine cannot wire yet are kept out of the pool until #1568 lands. */
function isUnwired(s: EventEffectSpec): boolean {
  return s.type === 'vehicle_breakdown' || s.type === 'building_closed'
    || (s.type === 'cost_factor' && (s.what === 'survey' || s.what === 'research'));
}

const followUpIds = new Set(FOLLOWUP_EVENTS.map(e => e.id));

let events: readonly EventDef[] = [];
beforeAll(() => {
  setupEvents();
  events = getAllEvents();
});

const branches = (c: EventConsequence | undefined): EventConsequence[] =>
  c === undefined ? [] : c.altConsequence ? [c, c.altConsequence] : [c];
const specsOf = (e: EventDef): EventEffectSpec[] =>
  e.consequences.flatMap(c => branches(c).flatMap(b => b.effects ?? []));
const mainEvents = (cat: SpreadCategory): EventDef[] =>
  events.filter(e => e.category === cat && !followUpIds.has(e.id));
const followUps = (): EventDef[] => events.filter(e => followUpIds.has(e.id));
const isLasting = (e: EventDef): boolean => specsOf(e).some(s => LASTING_KINDS.has(s.type));
const distinct = (evs: EventDef[]): Set<string> => new Set(evs.flatMap(e => specsOf(e).map(s => s.type)));

function durationOf(s: EventEffectSpec): { n: number | null; permanent: boolean } | null {
  if (HOUR_KINDS.has(s.type)) return { n: (s as { hours: number }).hours, permanent: false };
  if (DAY_KINDS.has(s.type)) {
    const days = (s as { days: number | null }).days;
    return days === null ? { n: null, permanent: true } : { n: days, permanent: false };
  }
  return null;
}

describe('event effect spread (#1538)', () => {
  it('catalog kinds are derived from the locale keys', () => {
    expect(CATALOG_KINDS.has('work_stoppage')).toBe(true);
    expect(CATALOG_KINDS.size).toBeGreaterThanOrEqual(19);
  });

  it('every option and alt effect type is a catalog kind', () => {
    const bad = events.flatMap(e => specsOf(e).filter(s => !CATALOG_KINDS.has(s.type)).map(s => `${e.id}: ${s.type}`));
    expect(bad).toEqual([]);
  });

  it('unwired specs (TODO(#1568)) are not used', () => {
    const bad = events.flatMap(e => specsOf(e).filter(isUnwired).map(s => `${e.id}: ${s.type}`));
    expect(bad, `unwired effects:\n${bad.join('\n')}`).toEqual([]);
  });

  describe.each(SPREAD_CATEGORIES)('category %s', cat => {
    it(`uses at least ${CATEGORY_MIN_DISTINCT[cat]} distinct effect kinds`, () => {
      const kinds = distinct(mainEvents(cat));
      expect(kinds.size, `kinds: ${[...kinds].join(', ')}`).toBeGreaterThanOrEqual(CATEGORY_MIN_DISTINCT[cat]);
    });

    it(`at least ${CATEGORY_MIN_SHARE[cat] * 100}% of events carry a lasting effect`, () => {
      const evs = mainEvents(cat);
      expect(evs.length).toBeGreaterThan(0);
      const lasting = evs.filter(isLasting).length;
      expect(lasting / evs.length, `${lasting}/${evs.length}`).toBeGreaterThanOrEqual(CATEGORY_MIN_SHARE[cat]);
    });

    it(`no single kind exceeds ${MAX_KIND_SHARE * 100}% of specs`, () => {
      const specs = mainEvents(cat).flatMap(specsOf);
      expect(specs.length).toBeGreaterThan(0);
      const counts = new Map<string, number>();
      for (const s of specs) counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
      const over = [...counts].filter(([, n]) => n / specs.length > MAX_KIND_SHARE).map(([k, n]) => `${k}: ${n}/${specs.length}`);
      expect(over).toEqual([]);
    });
  });

  describe('follow-up group', () => {
    it(`uses at least ${FOLLOWUP_MIN_DISTINCT} distinct effect kinds`, () => {
      const kinds = distinct(followUps());
      expect(kinds.size, `kinds: ${[...kinds].join(', ')}`).toBeGreaterThanOrEqual(FOLLOWUP_MIN_DISTINCT);
    });

    it(`at least ${FOLLOWUP_MIN_LASTING} of 9 follow-ups carry a lasting effect`, () => {
      expect(followUps()).toHaveLength(9);
      expect(followUps().filter(isLasting).length).toBeGreaterThanOrEqual(FOLLOWUP_MIN_LASTING);
    });
  });

  it('overall lasting share across the five categories meets the floor', () => {
    const evs = SPREAD_CATEGORIES.flatMap(mainEvents);
    const lasting = evs.filter(isLasting).length;
    expect(lasting / evs.length, `${lasting}/${evs.length}`).toBeGreaterThanOrEqual(OVERALL_MIN_LASTING_SHARE);
  });

  describe('result texts', () => {
    const withEffects = (): { e: EventDef; i: number; specs: EventEffectSpec[] }[] =>
      events.flatMap(e => e.consequences.map((c, i) => ({ e, i, specs: c.effects ?? [] })).filter(x => x.specs.length > 0).map(x => ({ ...x, e })));

    it('some options carry effects at all', () => {
      expect(withEffects().length).toBeGreaterThan(40);
    });

    it('every option with effects has resN in en and fr', () => {
      const bad = withEffects().flatMap(({ e, i }) => (['en', 'fr'] as const).flatMap(loc => {
        const v = (loc === 'en' ? en : fr)[`event.${e.id}.res${i}`];
        return v === undefined || v === '' ? [`${e.id} res${i} [${loc}] missing`] : [];
      }));
      expect(bad).toEqual([]);
    });

    it('result text states the duration', () => {
      const bad = withEffects().flatMap(({ e, i, specs }) => (['en', 'fr'] as const).flatMap(loc => {
        const text = (loc === 'en' ? en : fr)[`event.${e.id}.res${i}`];
        if (text === undefined) return []; // reported by the previous rule
        return specs.flatMap(s => {
          const d = durationOf(s);
          if (d === null) return [];
          const ok = d.permanent ? /permanent/i.test(text) : new RegExp(`(?<![\\d.,])${d.n}(?![\\d])`).test(text);
          return ok ? [] : [`${e.id} res${i} [${loc}] ${s.type} lacks ${d.permanent ? 'permanent' : d.n}: "${text}"`];
        });
      }));
      expect(bad, `duration missing from result text:\n${bad.join('\n')}`).toEqual([]);
    });

    it('options with employee_leaves / employee_injured / cancel_contract have resN_alt in both locales', () => {
      const bad = withEffects().filter(({ specs }) => specs.some(s => ALT_KINDS.has(s.type)))
        .flatMap(({ e, i }) => (['en', 'fr'] as const).flatMap(loc => {
          const v = (loc === 'en' ? en : fr)[`event.${e.id}.res${i}_alt`];
          return v === undefined || v === '' ? [`${e.id} res${i}_alt [${loc}] missing`] : [];
        }));
      expect(bad).toEqual([]);
    });
  });

  it('event source files use balance.ts constants, not raw numbers, inside effects', () => {
    const bad = EVENT_SOURCE_FILES.flatMap(file => {
      const src = readFileSync(file, 'utf8');
      return [...src.matchAll(/effects:\s*\[([^\]]*)\]/g)]
        .filter(m => RAW_LITERAL.test(m[1]!))
        .map(m => `${file.split('/').pop()}: effects: [${m[1]!.trim()}]`);
    });
    expect(bad, `raw numeric literals in effects:\n${bad.join('\n')}`).toEqual([]);
  });
});
