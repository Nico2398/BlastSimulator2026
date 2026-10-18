// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  DEBRIS_GROUP_PAGE_SIZE,
  partitionWorkQueue,
  debrisGroupSignature,
  orderRowsSignature,
  debrisPageRows,
  debrisPageCount,
  clampDebrisPage,
  type DebrisGroup,
} from '../../../../src/ui/panels/workQueueGroups.js';
import type { ActionType, PendingAction } from '../../../../src/core/state/GameState.js';

function act(id: number, overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    id, type: 'general_work', requiredSkill: null, requiredVehicleRole: null,
    targetX: id, targetZ: id, targetY: 0, payload: {}, targetEmployeeId: null,
    status: 'queued', holderId: null, queuedAtTick: 0, ...overrides,
  };
}

function debris(n: number, type: ActionType = 'haul_debris', startId = 1): PendingAction[] {
  return Array.from({ length: n }, (_, i) => act(startId + i, { type }));
}

describe('partitionWorkQueue', () => {
  it('returns empty model for no actions', () => {
    expect(partitionWorkQueue([])).toEqual({ player: [], debris: [] });
  });

  it('keeps non-debris orders as player rows in input order', () => {
    const a = [act(5, { type: 'survey' }), act(2, { type: 'general_work' }), act(9, { type: 'drill_hole' })];
    const m = partitionWorkQueue(a);
    expect(m.player.map(p => p.id)).toEqual([5, 2, 9]);
    expect(m.debris).toEqual([]);
  });

  it('excludes rest orders everywhere', () => {
    const m = partitionWorkQueue([act(1, { type: 'rest' }), act(2)]);
    expect(m.player.map(p => p.id)).toEqual([2]);
    expect(m.debris).toEqual([]);
  });

  it('folds debris orders into one group per type with ids ascending', () => {
    const m = partitionWorkQueue([
      act(9, { type: 'haul_debris' }), act(3, { type: 'fragment_debris' }),
      act(1, { type: 'haul_debris' }), act(7, { type: 'haul_debris' }),
    ]);
    expect(m.player).toEqual([]);
    const haul = m.debris.find(g => g.type === 'haul_debris')!;
    const frag = m.debris.find(g => g.type === 'fragment_debris')!;
    expect(haul.ids).toEqual([1, 7, 9]);
    expect(haul.total).toBe(3);
    expect(frag.ids).toEqual([3]);
    expect(frag.total).toBe(1);
    expect(m.debris.length).toBe(2);
  });

  it('omits a group for a type with no orders', () => {
    const m = partitionWorkQueue(debris(2, 'haul_debris'));
    expect(m.debris.map(g => g.type)).toEqual(['haul_debris']);
  });

  it('counts each status', () => {
    const m = partitionWorkQueue([
      act(1, { type: 'haul_debris', status: 'queued' }),
      act(2, { type: 'haul_debris', status: 'queued' }),
      act(3, { type: 'haul_debris', status: 'assigned', holderId: 4 }),
      act(4, { type: 'haul_debris', status: 'in_progress', holderId: 4 }),
      act(5, { type: 'haul_debris', status: 'in_progress', holderId: 5 }),
    ]);
    const g = m.debris[0]!;
    expect(g).toMatchObject({ total: 5, queued: 2, assigned: 1, inProgress: 2, blocked: 0, stranded: 0, inTransit: 0 });
  });

  it('counts queued block states consistently with the row classification', () => {
    const m = partitionWorkQueue([
      act(1, { type: 'haul_debris', blockedReason: 'debris_out_of_reach' }),
      act(2, { type: 'haul_debris', blockedReason: 'no_vehicle_in_fleet' }),
      act(3, { type: 'haul_debris', blockedReason: 'no_licensed_driver' }),
      act(4, { type: 'haul_debris', blockedReason: 'explosives_in_transit' }),
      act(5, { type: 'haul_debris' }),
    ]);
    const g = m.debris[0]!;
    expect(g.queued).toBe(5);
    expect(g.stranded).toBe(1);
    expect(g.blocked).toBe(2);
    expect(g.inTransit).toBe(1);
    expect(g.open).toBe(1);
  });

  it('ignores a stale blockedReason on a non-queued order', () => {
    const m = partitionWorkQueue([
      act(1, { type: 'haul_debris', status: 'in_progress', holderId: 1, blockedReason: 'debris_out_of_reach' }),
      act(2, { type: 'haul_debris', status: 'assigned', holderId: 1, blockedReason: 'no_vehicle_in_fleet' }),
    ]);
    const g = m.debris[0]!;
    expect(g.stranded).toBe(0);
    expect(g.blocked).toBe(0);
    expect(g.queued).toBe(0);
  });

  it('handles 2,500 orders in one pass with correct totals', () => {
    const m = partitionWorkQueue([...debris(2000, 'haul_debris', 1), ...debris(500, 'fragment_debris', 5000), act(9000)]);
    expect(m.player.length).toBe(1);
    expect(m.debris.find(g => g.type === 'haul_debris')!.total).toBe(2000);
    expect(m.debris.find(g => g.type === 'fragment_debris')!.total).toBe(500);
  });
});

describe('debrisGroupSignature', () => {
  const group = () => partitionWorkQueue(debris(30)).debris[0]!;

  it('is non-empty and short regardless of group size', () => {
    const big = partitionWorkQueue(debris(2500)).debris[0]!;
    expect(debrisGroupSignature(big).length).toBeGreaterThan(0);
    expect(debrisGroupSignature(big).length).toBeLessThan(80);
  });

  it('does not depend on member ids', () => {
    const a = partitionWorkQueue(debris(5, 'haul_debris', 1)).debris[0]!;
    const b = partitionWorkQueue(debris(5, 'haul_debris', 100)).debris[0]!;
    expect(debrisGroupSignature(a)).toBe(debrisGroupSignature(b));
  });

  it('changes when a status count changes', () => {
    const base = debris(5);
    const changed = base.map((a, i) => (i === 0 ? { ...a, status: 'in_progress' as const, holderId: 1 } : a));
    expect(debrisGroupSignature(partitionWorkQueue(changed).debris[0]!))
      .not.toBe(debrisGroupSignature(partitionWorkQueue(base).debris[0]!));
  });

  it('changes when a block count changes', () => {
    const base = debris(5);
    const changed = base.map((a, i) => (i === 0 ? { ...a, blockedReason: 'debris_out_of_reach' as const } : a));
    expect(debrisGroupSignature(partitionWorkQueue(changed).debris[0]!))
      .not.toBe(debrisGroupSignature(partitionWorkQueue(base).debris[0]!));
  });

  it('differs between types with the same counts', () => {
    const h = partitionWorkQueue(debris(3, 'haul_debris')).debris[0]!;
    const f = partitionWorkQueue(debris(3, 'fragment_debris')).debris[0]!;
    expect(debrisGroupSignature(h)).not.toBe(debrisGroupSignature(f));
  });

  it('is stable for equal input', () => {
    expect(debrisGroupSignature(group())).toBe(debrisGroupSignature(group()));
  });
});

describe('orderRowsSignature', () => {
  it('is stable for equal input', () => {
    expect(orderRowsSignature([act(1)], 5)).toBe(orderRowsSignature([act(1)], 5));
  });

  it('differs for empty vs non-empty', () => {
    expect(orderRowsSignature([], 0)).not.toBe(orderRowsSignature([act(1)], 0));
  });

  it('changes with status, holder and blocked reason', () => {
    const base = orderRowsSignature([act(1)], 0);
    expect(orderRowsSignature([act(1, { status: 'in_progress', holderId: 2 })], 0)).not.toBe(base);
    expect(orderRowsSignature([act(1, { holderId: 2 })], 0)).not.toBe(base);
    expect(orderRowsSignature([act(1, { blockedReason: 'no_vehicle_in_fleet' })], 0)).not.toBe(base);
  });

  it('changes with order and with ids', () => {
    expect(orderRowsSignature([act(1), act(2)], 0)).not.toBe(orderRowsSignature([act(2), act(1)], 0));
  });

  it('includes the tick when an in-transit order shows a time-dependent message', () => {
    const o = act(1, { type: 'charge_hole', blockedReason: 'explosives_in_transit' });
    expect(orderRowsSignature([o], 10)).not.toBe(orderRowsSignature([o], 11));
  });
});

function pageOf(actions: PendingAction[], page: number, type: DebrisGroup['type'] = 'haul_debris') {
  const g = partitionWorkQueue(actions).debris.find(x => x.type === type);
  if (!g) return { rows: [] as PendingAction[], pageCount: 0 };
  return { rows: debrisPageRows(actions, g, clampDebrisPage(page, g.total)), pageCount: debrisPageCount(g.total) };
}

describe('debris paging', () => {
  it('uses a page size of 25', () => {
    expect(DEBRIS_GROUP_PAGE_SIZE).toBe(25);
  });

  it('returns no rows and zero pages when the type has no orders', () => {
    expect(pageOf([act(1)], 0)).toEqual({ rows: [], pageCount: 0 });
  });

  it('returns exactly one full page for 25 orders', () => {
    const r = pageOf(debris(25), 0);
    expect(r.rows.length).toBe(25);
    expect(r.pageCount).toBe(1);
  });

  it('spills the 26th order onto a second page', () => {
    const a = debris(26);
    const p0 = pageOf(a, 0);
    const p1 = pageOf(a, 1);
    expect(p0.pageCount).toBe(2);
    expect(p0.rows.length).toBe(25);
    expect(p1.rows.map(r => r.id)).toEqual([26]);
  });

  it('never returns more than 25 rows out of 2,500', () => {
    const r = pageOf(debris(2500), 3);
    expect(r.rows.length).toBe(25);
    expect(r.pageCount).toBe(100);
    expect(r.rows[0]!.id).toBe(76);
  });

  it('only includes the requested type, ids ascending', () => {
    const a = [act(8, { type: 'fragment_debris' }), act(5), ...debris(3, 'haul_debris', 20), act(2, { type: 'haul_debris' })];
    expect(pageOf(a, 0).rows.map(r => r.id)).toEqual([2, 20, 21, 22]);
  });

  it('returns rows in ascending id order even when the input is not id-ordered', () => {
    const a = [...debris(3, 'haul_debris', 10)].reverse();
    expect(pageOf(a, 0).rows.map(r => r.id)).toEqual([10, 11, 12]);
  });

  it('clamps an out-of-range page to the last page and a negative page to the first', () => {
    expect(clampDebrisPage(99, 60)).toBe(2);
    expect(clampDebrisPage(-4, 60)).toBe(0);
    expect(clampDebrisPage(Number.NaN, 60)).toBe(0);
    expect(clampDebrisPage(3, 0)).toBe(0);
    const a = debris(60);
    expect(pageOf(a, 99).rows.map(r => r.id)[0]).toBe(51);
    expect(pageOf(a, -4).rows.map(r => r.id)[0]).toBe(1);
  });
});
