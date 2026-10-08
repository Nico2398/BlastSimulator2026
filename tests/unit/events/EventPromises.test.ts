import { describe, it, expect, beforeEach } from 'vitest';
import { resolveEvent, type ResolutionResult } from '../../../src/core/events/EventResolver.js';
import { getAllEvents, getEventById } from '../../../src/core/events/EventPool.js';
import { setupEvents } from '../../../src/core/events/index.js';
import { workRate, isActive, remainingTicks } from '../../../src/core/events/ActiveModifiers.js';
import { makeEffectWorld, type EffectFixture } from '../../helpers/eventEffectWorld.js';
import { t } from '../../../src/core/i18n/I18n.js';
import en from '../../../src/core/i18n/locales/en.json';
import fr from '../../../src/core/i18n/locales/fr.json';
import {
  EVENT_STRIKE_HOURS, EVENT_RELOCATE_PAUSE_HOURS, EVENT_PARTIAL_BAN_HOURS, EVENT_PARTIAL_BAN_WORK_PCT,
  EVENT_HAZARD_STIPEND_DAYS, EVENT_HAZARD_STIPEND_PER_DAY, TICKS_PER_DAY,
} from '../../../src/core/config/balance.js';

function resolve(fx: EffectFixture, eventId: string, option: number, tick = 100): ResolutionResult {
  fx.state.events.pendingEvent = { eventId, firedAtTick: tick };
  const res = resolveEvent(fx.state.events, fx.state.finances, fx.state.scores, option, tick, fx.rng, fx.world);
  expect(res).not.toBeNull();
  return res!;
}

describe('event outcomes keep their promises (#1414)', () => {
  let fx: EffectFixture;
  beforeEach(() => { setupEvents(); fx = makeEffectWorld(); });

  it('union_strike_threat "let them strike" stops all roles for the configured hours', () => {
    resolve(fx, 'union_strike_threat', 1, 100);
    const m = fx.state.events.activeModifiers.find(x => x.kind === 'work_stoppage');
    expect(m).toBeDefined();
    expect(m!.role).toBeNull();
    expect(m!.sourceEventId).toBe('union_strike_threat');
    expect(remainingTicks(m!, 100)).toBeGreaterThan(0);
    expect(workRate(fx.state.events.activeModifiers, 'driller', 101)).toBe(0);
    expect(workRate(fx.state.events.activeModifiers, 'manager', 101)).toBe(0);
  });

  it('union_strike_threat "meet the demands" raises no stoppage', () => {
    resolve(fx, 'union_strike_threat', 0);
    expect(isActive(fx.state.events.activeModifiers, 'work_stoppage', 101)).toBe(false);
  });

  it('mafia_fbi_mole "fire him" removes one employee', () => {
    const before = fx.state.employees.employees.filter(e => e.alive).length;
    resolve(fx, 'mafia_fbi_mole', 0);
    expect(fx.state.employees.employees.filter(e => e.alive).length).toBe(before - 1);
  });

  it('union_hazard_emotional res0 charges the stipend daily for the configured days', () => {
    const res = resolve(fx, 'union_hazard_emotional', 0, 100);
    const m = fx.state.events.activeModifiers.find(x => x.kind === 'recurring_charge');
    expect(m).toBeDefined();
    expect(m!.magnitude).toBe(EVENT_HAZARD_STIPEND_PER_DAY);
    expect(m!.endTick).toBe(100 + EVENT_HAZARD_STIPEND_DAYS * TICKS_PER_DAY);
    expect(res.effects.some(e => /\d/.test(e))).toBe(true);
  });

  it('politics_mayor_wins "relocate ops" stops all work for the configured pause', () => {
    const res = resolve(fx, 'politics_mayor_wins', 2, 100);
    const m = fx.state.events.activeModifiers.find(x => x.kind === 'work_stoppage');
    expect(m).toBeDefined();
    expect(m!.role).toBeNull();
    expect(m!.endTick).toBe(100 + EVENT_RELOCATE_PAUSE_HOURS);
    expect(res.effects.length).toBeGreaterThan(0);
  });

  it('politics_mining_ban_vote partial ban slows work below 1 for 60 ticks', () => {
    resolve(fx, 'politics_mining_ban_vote', 1, 100);
    const list = fx.state.events.activeModifiers;
    expect(workRate(list, 'driller', 100)).toBeLessThan(1);
    expect(workRate(list, 'driller', 159)).toBeLessThan(1);
    expect(workRate(list, 'driller', 160)).toBe(1);
  });

  it('resolving a catalog event twice extends rather than duplicates the modifier', () => {
    resolve(fx, 'union_strike_threat', 1, 100);
    resolve(fx, 'union_strike_threat', 1, 110);
    expect(fx.state.events.activeModifiers.filter(m => m.kind === 'work_stoppage')).toHaveLength(1);
  });
});

describe('no raw effectTag leaks into result effects', () => {
  it('no option of any event yields an effects entry equal to its raw effectTag', () => {
    setupEvents();
    const offenders: string[] = [];
    for (const def of getAllEvents()) {
      def.consequences.forEach((c, i) => {
        const tags = [c.effectTag, c.altConsequence?.effectTag].filter((x): x is string => !!x);
        if (tags.length === 0) return;
        const fx = makeEffectWorld();
        fx.state.events.pendingEvent = { eventId: def.id, firedAtTick: 5 };
        const res = resolveEvent(fx.state.events, fx.state.finances, fx.state.scores, i, 5, fx.rng, fx.world);
        if (res && res.effects.some(e => tags.includes(e))) offenders.push(`${def.id}#${i}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('result prose numbers match their balance constants', () => {
  const locales: Array<[string, Record<string, string>]> = [['en', en], ['fr', fr]];
  const cases: Array<[string, number, number]> = [
    ['event.union_strike_threat.res1', EVENT_STRIKE_HOURS, 0],
    ['event.politics_mayor_wins.res2', EVENT_RELOCATE_PAUSE_HOURS, 0],
    ['event.politics_mining_ban_vote.res1', EVENT_PARTIAL_BAN_HOURS, 0],
    ['event.politics_mining_ban_vote.res1', Math.abs(EVENT_PARTIAL_BAN_WORK_PCT), 0],
    ['event.union_hazard_emotional.res0', EVENT_HAZARD_STIPEND_DAYS, 0],
  ];
  it.each(locales)('%s texts state the configured numbers', (_name, table) => {
    for (const [key, value] of cases) {
      const numbers = (table[key] ?? '').match(/\d+/g)?.map(Number) ?? [];
      expect(numbers, key).toContain(value);
    }
  });
});

describe('promise audit', () => {
  /** Outcome texts that promise something lasting must carry declarative effects. */
  const PROMISES: Array<[string, number]> = [
    ['union_strike_threat', 1],
    ['union_hazard_emotional', 0],
    ['politics_mining_ban_vote', 1],
    ['politics_mayor_wins', 2],
    ['mafia_fbi_mole', 0],
  ];
  it.each(PROMISES)('%s option %i has effects', (id, opt) => {
    setupEvents();
    const c = getEventById(id)!.consequences[opt]!;
    expect(c.effects?.length ?? 0).toBeGreaterThan(0);
  });

  it('every outcome text that says "monthly" or "lasting" has effects', () => {
    setupEvents();
    const missing: string[] = [];
    for (const def of getAllEvents()) {
      def.options.forEach((o, i) => {
        const text = (en as Record<string, string>)[o.resultKey] ?? t(o.resultKey);
        if (/\b(monthly|lasting)\b/i.test(text) && !(def.consequences[i]?.effects?.length)) missing.push(`${def.id}#${i}`);
      });
    }
    expect(missing).toEqual([]);
  });
});
