// Event effect variety (#1538): the catalog is spread over the whole event pool.
import { describe, it, expect, beforeEach } from 'vitest';
import { getAllEvents, type EventCategory, type EventDef } from '../../../src/core/events/EventPool.js';
import { setupEvents } from '../../../src/core/events/index.js';
import { resolveEvent } from '../../../src/core/events/EventResolver.js';
import { makeEffectWorld } from '../../helpers/eventEffectWorld.js';
import en from '../../../src/core/i18n/locales/en.json';
import fr from '../../../src/core/i18n/locales/fr.json';

const LASTING = new Set([
  'work_stoppage', 'work_rate', 'morale_shift', 'salary', 'recurring_charge', 'ban', 'cost_factor',
  'contract_price', 'forced_weather', 'event_weight', 'employee_leaves', 'employee_joins', 'cancel_contract',
]);
const CATEGORIES: EventCategory[] = ['union', 'politics', 'weather', 'mafia', 'lawsuit'];

const specsOf = (d: EventDef) => d.consequences.flatMap(c => [...(c.effects ?? []), ...(c.altConsequence?.effects ?? [])]);
const isLasting = (d: EventDef) => specsOf(d).some(s => LASTING.has(s.type));

describe('event effect variety (#1538)', () => {
  let main: EventDef[];
  let followUps: EventDef[];
  beforeEach(() => {
    setupEvents();
    const all = getAllEvents();
    main = all.filter(d => !d.followUpOnly);
    followUps = all.filter(d => d.followUpOnly);
  });

  it.each(CATEGORIES)('%s: >= 6 kinds, >= 60%% lasting, no kind above 30%% of specs', (cat) => {
    const events = main.filter(d => d.category === cat);
    const specs = events.flatMap(specsOf);
    const counts = new Map<string, number>();
    for (const s of specs) counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
    expect(counts.size).toBeGreaterThanOrEqual(6);
    expect(events.filter(isLasting).length / events.length).toBeGreaterThanOrEqual(0.6);
    expect(Math.max(...counts.values()) / specs.length).toBeLessThanOrEqual(0.3);
  });

  it('overall at least 75% of the five categories have a lasting option', () => {
    const events = main.filter(d => CATEGORIES.includes(d.category));
    expect(events.filter(isLasting).length / events.length).toBeGreaterThanOrEqual(0.75);
  });

  it('a weather event holds a lingering front', () => {
    expect(main.filter(d => d.category === 'weather').some(d => specsOf(d).some(s => s.type === 'forced_weather'))).toBe(true);
  });

  it('follow-ups: >= 5 kinds and >= 8 of 9 lasting', () => {
    expect(followUps).toHaveLength(9);
    expect(new Set(followUps.flatMap(specsOf).map(s => s.type)).size).toBeGreaterThanOrEqual(5);
    expect(followUps.filter(isLasting).length).toBeGreaterThanOrEqual(8);
  });

  it('never authors the kinds that are not wired yet (#1568)', () => {
    const bad = getAllEvents().flatMap(d => specsOf(d).filter(s =>
      s.type === 'vehicle_breakdown' || s.type === 'building_closed'
      || (s.type === 'cost_factor' && (s.what === 'survey' || s.what === 'research'))).map(() => d.id));
    expect(bad).toEqual([]);
  });

  it('every option with effects has result text in both locales stating its numbers', () => {
    const problems: string[] = [];
    for (const d of getAllEvents()) {
      d.consequences.forEach((c, i) => {
        for (const [name, table] of [['en', en], ['fr', fr]] as const) {
          const text = (table as Record<string, string>)[`event.${d.id}.res${i}`] ?? '';
          for (const s of c.effects ?? []) {
            if ('hours' in s && !text.includes(String(s.hours))) problems.push(`${name} ${d.id}#${i} hours`);
            if ('days' in s && s.days !== null && !text.includes(String(s.days))) problems.push(`${name} ${d.id}#${i} days`);
            if (s.type === 'salary' && s.days === null && !/permanent/i.test(text)) problems.push(`${name} ${d.id}#${i} permanent`);
            if (['employee_leaves', 'employee_injured', 'cancel_contract'].includes(s.type)
              && !(table as Record<string, string>)[`event.${d.id}.res${i}_alt`]) problems.push(`${name} ${d.id}#${i} alt`);
          }
        }
      });
    }
    expect(problems).toEqual([]);
  });

  it('an employee_leaves option falls back to its _alt text on an empty roster', () => {
    const def = main.find(d => d.consequences.some(c => c.effects?.some(s => s.type === 'employee_leaves')))!;
    const opt = def.consequences.findIndex(c => c.effects?.some(s => s.type === 'employee_leaves'));
    const fx = makeEffectWorld({ empty: true });
    fx.state.events.pendingEvent = { eventId: def.id, firedAtTick: 5 };
    const res = resolveEvent(fx.state.events, fx.state.finances, fx.state.scores, opt, 5, fx.rng, fx.world);
    expect(res!.resultKey).toBe(`event.${def.id}.res${opt}_alt`);
  });
});
