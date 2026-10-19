// @vitest-environment jsdom
// BlastSimulator2026 — per-reason blocked-order phrases shared by the pip and Operations (#2008).
import { describe, it, expect, beforeEach } from 'vitest';
import {
  blockedPhraseKind, countBlockedReasons, rankBlockedKinds, blockedPhrase, blockedKindLabel,
  describeBlockedReasons, BLOCKED_PHRASE_LINES,
} from '../../../../src/ui/notify/blockedOrders.js';
import type { BlockedOrderReason } from '../../../../src/core/state/GameState.js';
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

  it.each(['no_warehouse', 'no_spoil_heap', 'spoil_heap_full', 'unreachable'] as const)('phrases %s with its count, not as crew', (kind) => {
    const p = blockedPhrase({ kind, count: 7 });
    expect(p).toContain('7');
    expect(p).not.toContain('nobody able');
    expect(p).not.toMatch(/\{|\}/);
  });
});

describe('blockedKindLabel', () => {
  it('gives a short label per kind, storage full for storage_full', () => {
    expect(blockedKindLabel('storage_full')).toBe('storage full');
    for (const k of ['crew_fleet', 'no_warehouse', 'no_spoil_heap', 'spoil_heap_full', 'unreachable'] as const) {
      expect(blockedKindLabel(k).length).toBeGreaterThan(0);
      expect(blockedKindLabel(k)).not.toMatch(/\{|\}/);
    }
  });
});

describe('describeBlockedReasons', () => {
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
