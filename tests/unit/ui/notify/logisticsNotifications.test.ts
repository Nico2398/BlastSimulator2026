// @vitest-environment jsdom
// BlastSimulator2026 — wireLogisticsNotifications (#1372): warehouse stock loss toast.
import { describe, it, expect, beforeEach } from 'vitest';
import { wireLogisticsNotifications } from '../../../../src/ui/notify/logisticsNotifications.js';
import type { NotifyInput } from '../../../../src/ui/notify/NotificationCenter.js';
import { NotificationCenter } from '../../../../src/ui/notify/NotificationCenter.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import type { PendingAction, BlockedOrderReason } from '../../../../src/core/state/GameState.js';
import { t, setLocale } from '../../../../src/core/i18n/I18n.js';

type Handler = (payload: unknown) => void;

function makeEmitter() {
  const handlers = new Map<string, Handler[]>();
  return {
    on: ((event: string, h: Handler) => {
      const list = handlers.get(event) ?? [];
      list.push(h);
      handlers.set(event, list);
      return () => undefined;
    }) as never,
    fire(event: string, payload: unknown): void {
      for (const h of handlers.get(event) ?? []) h(payload);
    },
    has(event: string): boolean { return (handlers.get(event) ?? []).length > 0; },
  };
}

describe('wireLogisticsNotifications', () => {
  let emitter: ReturnType<typeof makeEmitter>;
  let notes: NotifyInput[];

  beforeEach(() => {
    setLocale('en');
    emitter = makeEmitter();
    notes = [];
    wireLogisticsNotifications(emitter, (n) => notes.push(n));
  });

  it('subscribes to logistics:warehouse_stock_lost', () => {
    expect(emitter.has('logistics:warehouse_stock_lost')).toBe(true);
  });

  it('raises a warn toast with localized title and body including kg', () => {
    emitter.fire('logistics:warehouse_stock_lost', { buildingId: 7, massKg: 1234.4, oreKg: {} });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.severity).toBe('warn');
    expect(notes[0]!.title).toBe(t('notification.title.warehouse_stock_lost'));
    expect(notes[0]!.body).toBe(t('notification.warehouse_stock_lost', { id: 7, kg: 1234 }));
    expect(notes[0]!.body).toContain('1234');
  });

  it('rounds fractional kg and handles zero mass', () => {
    emitter.fire('logistics:warehouse_stock_lost', { buildingId: 1, massKg: 0.4, oreKg: {} });
    expect(notes[0]!.body).toBe(t('notification.warehouse_stock_lost', { id: 1, kg: 0 }));
  });

  it('ignores unrelated events', () => {
    emitter.fire('logistics:other', { buildingId: 1, massKg: 5 });
    expect(notes).toHaveLength(0);
  });
});

describe('BLOCKED pip tooltip names the reason (#2008)', () => {
  function order(id: number, blockedReason: BlockedOrderReason): PendingAction {
    return {
      id, type: 'haul_debris', requiredSkill: null, requiredVehicleRole: 'debris_hauler',
      targetX: id, targetZ: 0, targetY: 0, payload: { fragmentId: id }, targetEmployeeId: null,
      status: 'queued', holderId: null, queuedAtTick: 0, blockedReason,
    };
  }
  function pipFor(reasons: BlockedOrderReason[]) {
    setLocale('en');
    const state = createGame({ seed: 1, mineType: 'desert' });
    reasons.forEach((r, i) => state.pendingActions.push(order(i + 1, r)));
    const pip = new NotificationCenter().update(state).find(p => p.kind === 'orders');
    expect(pip).toBeDefined();
    return pip!;
  }

  it('storage_full hauls: tip names warehouse space with the count, not crew', () => {
    const pip = pipFor(Array<BlockedOrderReason>(2372).fill('storage_full'));
    expect(pip.tip).toContain('2,372');
    expect(pip.tip).toMatch(/warehouse space/i);
    expect(pip.tip).not.toContain('nobody able');
  });

  it('keeps pip label and tone unchanged', () => {
    const pip = pipFor(['storage_full', 'storage_full']);
    expect(pip.label).toBe(t('notification.pip.blocked_orders_label', { count: 2 }));
    expect(pip.tone).toBe('warn');
    expect(pip.kind).toBe('orders');
  });

  it('no_licensed_driver still reads as nobody able to do them', () => {
    const pip = pipFor(['no_licensed_driver']);
    expect(pip.tip).toContain('nobody able to do them');
  });

  it('mixed reasons are listed largest first, one line each', () => {
    const pip = pipFor(['no_licensed_driver', 'storage_full', 'storage_full', 'storage_full']);
    const lines = pip.tip!.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/warehouse space/i);
    expect(lines[0]).toContain('3');
    expect(lines[1]).toContain('nobody able to do them');
  });

  it('caps the tip at three lines', () => {
    const pip = pipFor(['storage_full', 'no_licensed_driver', 'target_unreachable', 'no_spoil_heap', 'spoil_heap_full']);
    expect(pip.tip!.split('\n')).toHaveLength(3);
  });

  describe('barren overflow wording (#2018)', () => {
    function overflowState(heapFull: boolean) {
      const state = createGame({ seed: 1, mineType: 'desert' });
      state.pendingActions.push(order(1, 'storage_full'));
      state.logistics.fragments.push({
        fragment: { id: 1, mass: 48_000, oreDensities: {} } as never,
        state: 'stored', vehicleId: null, warehouseId: 1,
      });
      state.logistics.storedMassKg = 50_000;
      state.buildings.buildings.push({
        id: 9, type: 'spoil_heap', tier: 1, storedSpoilKg: heapFull ? 1e9 : 0,
      } as never);
      return state;
    }
    const tipOf = (state: ReturnType<typeof overflowState>) =>
      new NotificationCenter().update(state).find(p => p.kind === 'orders')!.tip;

    it('storage_full orders with barren overflow use the barren phrase', () => {
      setLocale('en');
      expect(tipOf(overflowState(true))).toBe(
        t('notification.blocked_phrase.storage_full_barren', { count: 1, kg: '48,000' }),
      );
    });

    it('a heap with room keeps the plain storage phrase', () => {
      setLocale('en');
      expect(tipOf(overflowState(false))).not.toContain('barren');
    });
  });
});
