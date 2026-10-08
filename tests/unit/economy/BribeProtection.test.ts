// BlastSimulator2026 — Bribe protections (#1407)
import { describe, it, expect, beforeEach } from 'vitest';
import {
  BRIBE_CORRUPTION_DELTA,
  BRIBE_PROTECTION_DAYS,
  INSPECTION_EVENT_TAG,
  JUDGE_LAWSUIT_TIMER_STRETCH,
  TICKS_PER_DAY,
} from '../../../src/core/config/balance.js';
import {
  BRIBE_PROFILES,
  grantProtection,
  pruneProtections,
  isEventShielded,
  consumeDismissal,
  timerStretchFor,
  protectionRemainingTicks,
  type ActiveProtection,
} from '../../../src/core/economy/BribeProtection.js';
import type { CorruptionTarget } from '../../../src/core/economy/Corruption.js';
import type { EventCategory } from '../../../src/core/events/EventPool.js';

const TIMED: CorruptionTarget[] = ['judge', 'union_leader', 'inspector', 'politician'];

function days(t: CorruptionTarget): number {
  return BRIBE_PROTECTION_DAYS[t] * TICKS_PER_DAY;
}

describe('grantProtection (#1407)', () => {
  let list: ActiveProtection[];
  beforeEach(() => { list = []; });

  for (const target of TIMED) {
    it(`${target}: creates an entry expiring at tick + duration`, () => {
      const p = grantProtection(list, target, 100);
      expect(p).not.toBeNull();
      expect(list).toHaveLength(1);
      expect(list[0]).toBe(p);
      expect(p!.target).toBe(target);
      expect(p!.expiresAtTick).toBe(100 + days(target));
      expect(days(target)).toBeGreaterThan(0);
    });
  }

  it('judge starts with exactly one dismissal', () => {
    expect(grantProtection(list, 'judge', 0)!.dismissalsLeft).toBe(1);
  });

  it('witness grants no timed protection', () => {
    expect(grantProtection(list, 'witness', 5)).toBeNull();
    expect(list).toHaveLength(0);
  });

  it('re-bribe refreshes instead of stacking', () => {
    grantProtection(list, 'inspector', 0);
    grantProtection(list, 'inspector', 10);
    expect(list.filter(p => p.target === 'inspector')).toHaveLength(1);
    expect(list[0]!.expiresAtTick).toBe(10 + days('inspector'));
  });

  it('re-bribe never shortens an existing protection (max rule)', () => {
    grantProtection(list, 'union_leader', 100);
    grantProtection(list, 'union_leader', 50);
    expect(list).toHaveLength(1);
    expect(list[0]!.expiresAtTick).toBe(100 + days('union_leader'));
  });

  it('re-bribe of the judge resets a spent dismissal', () => {
    const p = grantProtection(list, 'judge', 0)!;
    p.dismissalsLeft = 0;
    const again = grantProtection(list, 'judge', 20)!;
    expect(list).toHaveLength(1);
    expect(again.dismissalsLeft).toBe(1);
    expect(again.expiresAtTick).toBe(20 + days('judge'));
  });

  it('different targets coexist', () => {
    grantProtection(list, 'judge', 0);
    grantProtection(list, 'inspector', 0);
    expect(list.map(p => p.target).sort()).toEqual(['inspector', 'judge']);
  });
});

describe('pruneProtections (#1407)', () => {
  it('drops entries at or past expiry, keeps live ones', () => {
    const list: ActiveProtection[] = [
      { target: 'inspector', expiresAtTick: 50, dismissalsLeft: 0 },
      { target: 'judge', expiresAtTick: 51, dismissalsLeft: 1 },
      { target: 'politician', expiresAtTick: 10, dismissalsLeft: 0 },
    ];
    pruneProtections(list, 50);
    expect(list.map(p => p.target)).toEqual(['judge']);
  });

  it('empty list stays empty', () => {
    const list: ActiveProtection[] = [];
    pruneProtections(list, 1000);
    expect(list).toEqual([]);
  });
});

describe('protectionRemainingTicks (#1407)', () => {
  const p: ActiveProtection = { target: 'inspector', expiresAtTick: 100, dismissalsLeft: 0 };
  it('counts down to expiry', () => {
    expect(protectionRemainingTicks(p, 40)).toBe(60);
  });
  it('is 0 at and after expiry, never negative', () => {
    expect(protectionRemainingTicks(p, 100)).toBe(0);
    expect(protectionRemainingTicks(p, 500)).toBe(0);
  });
});

describe('isEventShielded (#1407)', () => {
  const entry = (target: CorruptionTarget, expiresAtTick = 100): ActiveProtection =>
    ({ target, expiresAtTick, dismissalsLeft: 0 });

  it('union_leader shields union events', () => {
    expect(isEventShielded({ category: 'union' }, [entry('union_leader')], 10)).toBe(true);
  });
  it('politician shields politics events', () => {
    expect(isEventShielded({ category: 'politics' }, [entry('politician')], 10)).toBe(true);
  });
  it('inspector shields events tagged inspection', () => {
    expect(isEventShielded({ category: 'lawsuit', tags: [INSPECTION_EVENT_TAG] }, [entry('inspector')], 10)).toBe(true);
  });
  it('inspector does not block untagged lawsuits', () => {
    expect(isEventShielded({ category: 'lawsuit' }, [entry('inspector')], 10)).toBe(false);
  });
  it('no longer shields once expired (boundary tick)', () => {
    expect(isEventShielded({ category: 'union' }, [entry('union_leader', 100)], 99)).toBe(true);
    expect(isEventShielded({ category: 'union' }, [entry('union_leader', 100)], 100)).toBe(false);
  });
  it('other categories stay unshielded', () => {
    const list = [entry('union_leader'), entry('politician'), entry('inspector')];
    for (const category of ['weather', 'mafia', 'traffic', 'mining'] as EventCategory[]) {
      expect(isEventShielded({ category }, list, 10)).toBe(false);
    }
  });
  it('wrong protection does not shield', () => {
    expect(isEventShielded({ category: 'union' }, [entry('politician')], 10)).toBe(false);
    expect(isEventShielded({ category: 'politics' }, [entry('union_leader')], 10)).toBe(false);
  });
  it('empty list shields nothing', () => {
    expect(isEventShielded({ category: 'union' }, [], 10)).toBe(false);
  });
});

describe('consumeDismissal (#1407)', () => {
  it('judge dismisses the next lawsuit exactly once', () => {
    const list: ActiveProtection[] = [];
    grantProtection(list, 'judge', 0);
    expect(consumeDismissal(list, 'lawsuit', 5)).toBe(true);
    expect(list[0]!.dismissalsLeft).toBe(0);
    expect(consumeDismissal(list, 'lawsuit', 6)).toBe(false);
  });
  it('does nothing for other categories', () => {
    const list: ActiveProtection[] = [];
    grantProtection(list, 'judge', 0);
    expect(consumeDismissal(list, 'union', 5)).toBe(false);
    expect(list[0]!.dismissalsLeft).toBe(1);
  });
  it('does nothing after the protection expired', () => {
    const list: ActiveProtection[] = [];
    grantProtection(list, 'judge', 0);
    expect(consumeDismissal(list, 'lawsuit', days('judge'))).toBe(false);
  });
  it('false with no protections', () => {
    expect(consumeDismissal([], 'lawsuit', 0)).toBe(false);
  });
});

describe('timerStretchFor (#1407)', () => {
  const judge = (expiresAtTick = 100): ActiveProtection => ({ target: 'judge', expiresAtTick, dismissalsLeft: 0 });
  it('judge stretches the lawsuit timer', () => {
    expect(timerStretchFor('lawsuit', [judge()], 10)).toBe(JUDGE_LAWSUIT_TIMER_STRETCH);
  });
  it('is 1 for other categories', () => {
    expect(timerStretchFor('union', [judge()], 10)).toBe(1);
    expect(timerStretchFor('weather', [judge()], 10)).toBe(1);
  });
  it('is 1 after expiry and with no protections', () => {
    expect(timerStretchFor('lawsuit', [judge(100)], 100)).toBe(1);
    expect(timerStretchFor('lawsuit', [], 0)).toBe(1);
  });
  it('never drops below 1', () => {
    const cats: EventCategory[] = ['union', 'politics', 'weather', 'mafia', 'lawsuit'];
    const all: ActiveProtection[] = TIMED.map(target => ({ target, expiresAtTick: 100, dismissalsLeft: 1 }));
    for (const c of cats) expect(timerStretchFor(c, all, 10)).toBeGreaterThanOrEqual(1);
  });
});

describe('BRIBE_PROFILES balance (#1407)', () => {
  it('corruptionDelta matches the balance table for every target', () => {
    for (const t of Object.keys(BRIBE_CORRUPTION_DELTA) as CorruptionTarget[]) {
      expect(BRIBE_PROFILES[t].corruptionDelta).toBe(BRIBE_CORRUPTION_DELTA[t]);
    }
  });
  it('judge costs more and corrupts more than inspector', () => {
    expect(BRIBE_PROFILES.judge.price).toBeGreaterThan(BRIBE_PROFILES.inspector.price);
    expect(BRIBE_PROFILES.judge.corruptionDelta).toBeGreaterThan(BRIBE_PROFILES.inspector.corruptionDelta);
  });
  it('price rises with strength (delta x days) across timed targets', () => {
    const strength = (t: CorruptionTarget) => BRIBE_PROFILES[t].corruptionDelta * BRIBE_PROFILES[t].durationTicks;
    const sorted = [...TIMED].sort((a, b) => strength(a) - strength(b));
    for (let i = 1; i < sorted.length; i++) {
      expect(BRIBE_PROFILES[sorted[i]!].price).toBeGreaterThan(BRIBE_PROFILES[sorted[i - 1]!].price);
    }
  });
});
