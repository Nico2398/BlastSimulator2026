// @vitest-environment jsdom
// BlastSimulator2026 — per-reason blocked-order phrases shared by the pip and Operations (#2008).
import { describe, it, expect, beforeEach } from 'vitest';
import {
  blockedPhraseKind, countBlockedReasons, rankBlockedKinds, blockedPhrase, blockedKindLabel,
  describeBlockedReasons, BLOCKED_PHRASE_LINES, isGroupedBlockReason, buildGroupedBlockedOrderMessage,
  buildBlockedOrderMessage,
} from '../../../../src/ui/notify/blockedOrders.js';
import type { BlockedOrderReason, PendingAction } from '../../../../src/core/state/GameState.js';
import { setLocale } from '../../../../src/core/i18n/I18n.js';

beforeEach(() => setLocale('en'));

describe('blockedPhraseKind', () => {
  it.each<BlockedOrderReason>([
    'no_qualified_employee', 'no_dual_qualified_employee', 'no_vehicle_in_fleet',
    'no_licensed_driver', 'licence_level_too_low', 'no_reaching_vehicle',
  ])('merges %s into crew_fleet', (r) => {
    expect(blockedPhraseKind(r)).toBe('crew_fleet');
  });

  it('maps each site reason to its own kind', () => {
    expect(blockedPhraseKind('storage_full')).toBe('storage_full');
    expect(blockedPhraseKind('no_freight_warehouse')).toBe('no_warehouse');
    expect(blockedPhraseKind('no_spoil_heap')).toBe('no_spoil_heap');
    expect(blockedPhraseKind('spoil_heap_full')).toBe('spoil_heap_full');
    expect(blockedPhraseKind('target_unreachable')).toBe('unreachable');
  });

  it('maps buried_under_rubble to its own buried kind, apart from unreachable (#2012)', () => {
    expect(blockedPhraseKind('buried_under_rubble')).toBe('buried');
    expect(blockedPhraseKind('target_unreachable')).toBe('unreachable');
  });

  it('returns null for non-failure and absent reasons', () => {
    expect(blockedPhraseKind('debris_out_of_reach')).toBeNull();
    expect(blockedPhraseKind('explosives_in_transit')).toBeNull();
    expect(blockedPhraseKind(null)).toBeNull();
    expect(blockedPhraseKind(undefined)).toBeNull();
  });
});

describe('countBlockedReasons', () => {
  it('returns an empty tally for no actions', () => {
    expect(countBlockedReasons([])).toEqual({});
  });

  it('tallies per reason and ignores null/absent', () => {
    expect(countBlockedReasons([
      { blockedReason: 'storage_full' }, { blockedReason: 'storage_full' },
      { blockedReason: 'no_licensed_driver' }, { blockedReason: null }, {},
    ])).toEqual({ storage_full: 2, no_licensed_driver: 1 });
  });
});

describe('rankBlockedKinds', () => {
  it('returns nothing for an empty tally', () => {
    expect(rankBlockedKinds({})).toEqual([]);
  });

  it('sums crew and fleet reasons into one kind', () => {
    expect(rankBlockedKinds({ no_licensed_driver: 2, no_vehicle_in_fleet: 3, no_qualified_employee: 1 }))
      .toEqual([{ kind: 'crew_fleet', count: 6 }]);
  });

  it('orders largest first', () => {
    expect(rankBlockedKinds({ no_licensed_driver: 2, storage_full: 2372, target_unreachable: 5 }).map(e => e.kind))
      .toEqual(['storage_full', 'unreachable', 'crew_fleet']);
  });

  it('breaks ties by union order', () => {
    // BlockedPhraseKind union order: crew_fleet, storage_full, no_warehouse, ...
    expect(rankBlockedKinds({ spoil_heap_full: 4, storage_full: 4, no_licensed_driver: 4 }).map(e => e.kind))
      .toEqual(['crew_fleet', 'storage_full', 'spoil_heap_full']);
  });

  it('breaks a 3/3 tie with unreachable before buried (#2012)', () => {
    expect(rankBlockedKinds({ buried_under_rubble: 3, target_unreachable: 3 }).map(e => e.kind))
      .toEqual(['unreachable', 'buried']);
  });

  it('drops zero counts and non-failure reasons', () => {
    expect(rankBlockedKinds({ storage_full: 0, debris_out_of_reach: 9, explosives_in_transit: 3, no_spoil_heap: 1 }))
      .toEqual([{ kind: 'no_spoil_heap', count: 1 }]);
  });
});

describe('blockedPhrase', () => {
  it('names warehouse space, the en-US formatted count and the remedy for storage_full', () => {
    const p = blockedPhrase({ kind: 'storage_full', count: 2372 });
    expect(p).toContain('2,372');
    expect(p).toMatch(/warehouse space/i);
    expect(p).toMatch(/sell ore/i);
    expect(p).toContain('Freight Warehouse');
    expect(p).not.toContain('nobody able');
  });

  it('keeps the nobody-able meaning for crew_fleet', () => {
    const p = blockedPhrase({ kind: 'crew_fleet', count: 1500 });
    expect(p).toContain('1,500');
    expect(p).toContain('nobody able to do them');
  });

  it.each(['no_warehouse', 'no_spoil_heap', 'spoil_heap_full', 'unreachable', 'buried'] as const)('phrases %s with its count, not as crew', (kind) => {
    const p = blockedPhrase({ kind, count: 7 });
    expect(p).toContain('7');
    expect(p).not.toContain('nobody able');
    expect(p).not.toMatch(/\{|\}/);
  });
});

describe('blockedPhrase buried (#2012)', () => {
  it('names the buried holes and the haul-away remedy', () => {
    const p = blockedPhrase({ kind: 'buried', count: 9 });
    expect(p).toContain('9');
    expect(p).toContain('buried under rubble');
    expect(p).toContain('haul the debris');
  });
});

describe('blockedKindLabel', () => {
  it('gives a short label per kind, storage full for storage_full', () => {
    expect(blockedKindLabel('storage_full')).toBe('storage full');
    for (const k of ['crew_fleet', 'no_warehouse', 'no_spoil_heap', 'spoil_heap_full', 'unreachable', 'buried'] as const) {
      expect(blockedKindLabel(k).length).toBeGreaterThan(0);
      expect(blockedKindLabel(k)).not.toMatch(/\{|\}/);
    }
  });
});

describe('describeBlockedReasons', () => {
  it('words buried orders as rubble, not as a route problem (#2012)', () => {
    const lines = describeBlockedReasons({ buried_under_rubble: 9 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('9');
    expect(lines[0]).toContain('buried under rubble');
    expect(lines[0]).toContain('haul the debris');
    expect(lines[0]).not.toMatch(/route/i);
  });

  it('keeps the unreachable wording for target_unreachable (#2012)', () => {
    expect(describeBlockedReasons({ target_unreachable: 5 })[0]).toMatch(/can't reach their target/);
  });

  it('lists buried and unreachable as two lines, buried first when larger (#2012)', () => {
    const lines = describeBlockedReasons({ buried_under_rubble: 9, target_unreachable: 5 });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('buried under rubble');
    expect(lines[1]).toMatch(/can't reach their target/);
  });

  it('caps at 3 lines by default', () => {
    expect(BLOCKED_PHRASE_LINES).toBe(3);
    const lines = describeBlockedReasons({
      storage_full: 10, no_licensed_driver: 9, target_unreachable: 8, no_spoil_heap: 7, spoil_heap_full: 6,
    });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('10');
  });

  it('honours an explicit max and returns [] for nothing blocked', () => {
    expect(describeBlockedReasons({ storage_full: 2, no_licensed_driver: 1 }, 1)).toHaveLength(1);
    expect(describeBlockedReasons({})).toEqual([]);
    expect(describeBlockedReasons({ debris_out_of_reach: 4 })).toEqual([]);
  });

  it('lists largest first', () => {
    const lines = describeBlockedReasons({ no_licensed_driver: 3, storage_full: 2372 });
    expect(lines[0]).toContain('2,372');
    expect(lines[1]).toContain('nobody able to do them');
  });
});

describe('barren-overflow storage phrase (#2018)', () => {
  it('names the rubble contract, another heap, the count and the grouped kg', () => {
    const [line] = describeBlockedReasons({ storage_full: 2404 }, BLOCKED_PHRASE_LINES, 48_000);
    expect(line).toContain('2,404');
    expect(line).toContain('48,000');
    expect(line).toContain('rubble contract');
    expect(line).toContain('another heap');
    expect(line).not.toContain('sell ore');
  });

  it('keeps today\'s phrase at 0 and when omitted', () => {
    const today = describeBlockedReasons({ storage_full: 5 });
    expect(describeBlockedReasons({ storage_full: 5 }, BLOCKED_PHRASE_LINES, 0)).toEqual(today);
    expect(today[0]).toContain('sell ore or build a Freight Warehouse');
  });

  it('blockedPhrase takes the barren kg for the storage kind only', () => {
    expect(blockedPhrase({ kind: 'storage_full', count: 3 }, 12_000)).toContain('12,000');
    expect(blockedPhrase({ kind: 'storage_full', count: 3 })).toContain('sell ore');
    expect(blockedPhrase({ kind: 'spoil_heap_full', count: 3 }, 12_000)).toBe(blockedPhrase({ kind: 'spoil_heap_full', count: 3 }));
    expect(blockedPhrase({ kind: 'spoil_heap_full', count: 3 }, 12_000)).not.toContain('12,000');
  });

  it('leaves other kinds, order and the max cut unchanged', () => {
    const counts = { storage_full: 10, no_licensed_driver: 9, target_unreachable: 8, no_spoil_heap: 7 };
    const plain = describeBlockedReasons(counts);
    const barren = describeBlockedReasons(counts, BLOCKED_PHRASE_LINES, 5_000);
    expect(barren).toHaveLength(3);
    expect(barren[0]).toContain('5,000');
    expect(barren.slice(1)).toEqual(plain.slice(1));
    expect(describeBlockedReasons(counts, 1, 5_000)).toHaveLength(1);
  });

  it('ignores barren kg when no storage_full order is blocked', () => {
    const counts = { no_licensed_driver: 3, spoil_heap_full: 2 };
    expect(describeBlockedReasons(counts, BLOCKED_PHRASE_LINES, 9_000)).toEqual(describeBlockedReasons(counts));
  });

  it('keeps the barren line in its largest-first slot', () => {
    const lines = describeBlockedReasons({ no_licensed_driver: 30, storage_full: 2 }, BLOCKED_PHRASE_LINES, 7_000);
    expect(lines[0]).toContain('nobody able to do them');
    expect(lines[1]).toContain('7,000');
  });

  it('has the French strings with both placeholders', () => {
    setLocale('fr');
    const [line] = describeBlockedReasons({ storage_full: 2404 }, BLOCKED_PHRASE_LINES, 48_000);
    expect(line).toContain('2,404');
    expect(line).toContain('48,000');
    expect(line).not.toContain('{');
  });
});

describe('isGroupedBlockReason (#2099)', () => {
  it.each<BlockedOrderReason>([
    'no_qualified_employee', 'no_dual_qualified_employee', 'no_vehicle_in_fleet',
    'no_licensed_driver', 'licence_level_too_low', 'no_reaching_vehicle',
  ])('is true for crew/fleet reason %s', (r) => {
    expect(isGroupedBlockReason(r)).toBe(true);
  });

  it.each<BlockedOrderReason>([
    'storage_full', 'no_freight_warehouse', 'no_spoil_heap', 'spoil_heap_full',
    'target_unreachable', 'buried_under_rubble', 'debris_out_of_reach', 'explosives_in_transit',
  ])('is false for per-order or site reason %s', (r) => {
    expect(isGroupedBlockReason(r)).toBe(false);
  });

  it('is false for null and undefined', () => {
    expect(isGroupedBlockReason(null)).toBe(false);
    expect(isGroupedBlockReason(undefined)).toBe(false);
  });
});

describe('buildGroupedBlockedOrderMessage (#2099)', () => {
  function action(overrides: Partial<PendingAction> = {}): PendingAction {
    return {
      id: 1, type: 'fragment_debris', requiredSkill: 'driving.rock_fragmenter', requiredVehicleRole: 'rock_fragmenter',
      targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: null,
      status: 'queued', holderId: null, queuedAtTick: 0, blockedReason: 'no_vehicle_in_fleet',
      ...overrides,
    };
  }
  const REASONS: BlockedOrderReason[] = [
    'no_qualified_employee', 'no_dual_qualified_employee', 'no_vehicle_in_fleet',
    'no_licensed_driver', 'licence_level_too_low', 'no_reaching_vehicle',
  ];

  it.each(REASONS)('count 1 is identical to buildBlockedOrderMessage for %s', (reason) => {
    const a = action({ blockedReason: reason, blockedLicenceLevel: 2 });
    expect(buildGroupedBlockedOrderMessage(a, 1)).toBe(buildBlockedOrderMessage(a));
  });

  it.each(REASONS)('count 406 carries the count and no raw i18n key for %s', (reason) => {
    const msg = buildGroupedBlockedOrderMessage(action({ blockedReason: reason, blockedLicenceLevel: 2 }), 406);
    expect(msg).toContain('406');
    expect(msg).not.toContain('notification.');
  });

  it.each(REASONS)('count 406 differs from the single-order wording for %s', (reason) => {
    const a = action({ blockedReason: reason, blockedLicenceLevel: 2 });
    expect(buildGroupedBlockedOrderMessage(a, 406)).not.toBe(buildBlockedOrderMessage(a));
  });

  it('names the missing vehicle role for no_vehicle_in_fleet', () => {
    const msg = buildGroupedBlockedOrderMessage(action(), 406);
    expect(msg).toContain('Rock Fragmenter');
  });

  it.each<BlockedOrderReason>(['no_licensed_driver', 'licence_level_too_low', 'no_reaching_vehicle', 'no_dual_qualified_employee'])(
    'names the vehicle role for %s',
    (reason) => {
      const msg = buildGroupedBlockedOrderMessage(action({ blockedReason: reason, blockedLicenceLevel: 2 }), 7);
      expect(msg).toContain('Rock Fragmenter');
    },
  );

  it('names the required skill for no_qualified_employee', () => {
    const msg = buildGroupedBlockedOrderMessage(
      action({ type: 'drill_hole', requiredSkill: 'blasting', requiredVehicleRole: null, blockedReason: 'no_qualified_employee' }), 9);
    expect(msg).toContain('9');
    expect(msg).toContain('Blasting');
  });

  it('two different counts give two different messages', () => {
    const a = action();
    expect(buildGroupedBlockedOrderMessage(a, 3)).not.toBe(buildGroupedBlockedOrderMessage(a, 4));
  });

  it('count 2 (smallest group) carries the count', () => {
    expect(buildGroupedBlockedOrderMessage(action(), 2)).toContain('2');
  });

  it('French wording carries the count and differs from English', () => {
    const a = action();
    const en = buildGroupedBlockedOrderMessage(a, 25);
    setLocale('fr');
    const fr = buildGroupedBlockedOrderMessage(a, 25);
    expect(fr).toContain('25');
    expect(fr).not.toContain('notification.');
    expect(fr).not.toBe(en);
  });
});

