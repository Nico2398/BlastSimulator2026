// @vitest-environment jsdom
// BlastSimulator2026 — blocked-order wording and classification branches (#1938)

import { describe, it, expect, afterEach } from 'vitest';
import { buildBlockedOrderMessage, isFailureBlock, isInTransitBlock } from '../../../src/ui/notify/blockedOrders.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';

function action(over: Partial<PendingAction>): PendingAction {
  return {
    id: 1, type: 'repair_vehicle', requiredSkill: 'repair', requiredVehicleRole: 'rock_digger',
    targetX: 3, targetZ: 3, targetY: 0, payload: {}, targetEmployeeId: null,
    status: 'queued', holderId: null, queuedAtTick: 0, blockedReason: null,
    ...over,
  };
}

afterEach(() => setLocale('en'));

describe('buildBlockedOrderMessage', () => {
  it('target_unreachable with detail and role param translates the role', () => {
    const msg = buildBlockedOrderMessage(action({
      blockedReason: 'target_unreachable',
      blockedDetail: { key: 'order.blocked.ramp_too_steep', params: { id: 4, grade: 12.5, tier: 1, role: 'rock_digger', max: 10 } },
    }));
    expect(msg).toContain('Ramp #4');
    expect(msg).toContain('Rock Digger');
    expect(msg).not.toContain('order.blocked');
  });

  it('target_unreachable with detail but no role passes params through', () => {
    const msg = buildBlockedOrderMessage(action({
      blockedReason: 'target_unreachable',
      blockedDetail: { key: 'order.blocked.ramp_too_steep', params: { id: 9, grade: 3, tier: 2, max: 8 } },
    }));
    expect(msg).toContain('Ramp #9');
    expect(msg).toContain('tier-2');
  });

  it('target_unreachable without detail falls back to the generic text', () => {
    expect(buildBlockedOrderMessage(action({ blockedReason: 'target_unreachable' }))).toContain("can't reach its target");
  });

  it('target_unreachable with malformed detail falls back to the generic text', () => {
    const bad = { key: 5, params: null } as unknown as PendingAction['blockedDetail'];
    expect(buildBlockedOrderMessage(action({ blockedReason: 'target_unreachable', blockedDetail: bad })))
      .toContain("can't reach its target");
    const noParams = { key: 'order.blocked.ramp_too_steep', params: null } as unknown as PendingAction['blockedDetail'];
    expect(buildBlockedOrderMessage(action({ blockedReason: 'target_unreachable', blockedDetail: noParams })))
      .toContain("can't reach its target");
  });

  it('no_qualified_employee without a skill says the site has no staff', () => {
    expect(buildBlockedOrderMessage(action({ blockedReason: 'no_qualified_employee', requiredSkill: null })))
      .toContain('no employees yet');
  });

  it('names vehicle, driver, licence, reaching-vehicle and dual-qualified blocks', () => {
    expect(buildBlockedOrderMessage(action({ blockedReason: 'no_vehicle_in_fleet' }))).toContain('Rock Digger');
    expect(buildBlockedOrderMessage(action({ blockedReason: 'no_licensed_driver' }))).toContain('licensed');
    expect(buildBlockedOrderMessage(action({ blockedReason: 'licence_level_too_low', blockedLicenceLevel: 3 })))
      .toContain('level 3');
    expect(buildBlockedOrderMessage(action({ blockedReason: 'licence_level_too_low' }))).toContain('level 1');
    expect(buildBlockedOrderMessage(action({ blockedReason: 'no_reaching_vehicle', blockedLicenceLevel: 2 })))
      .toContain('tier-2');
    expect(buildBlockedOrderMessage(action({ blockedReason: 'no_reaching_vehicle' }))).toContain('tier-1');
    expect(buildBlockedOrderMessage(action({ blockedReason: 'no_dual_qualified_employee' }))).toContain('both');
  });

  it('names storage-related blocks', () => {
    expect(buildBlockedOrderMessage(action({ blockedReason: 'no_freight_warehouse' }))).toContain('Freight Warehouse');
    expect(buildBlockedOrderMessage(action({ blockedReason: 'no_spoil_heap' }))).toContain('No spoil heap');
    expect(buildBlockedOrderMessage(action({ blockedReason: 'spoil_heap_full' }))).toContain('Spoil heap full');
    expect(buildBlockedOrderMessage(action({ blockedReason: 'storage_full' }))).toContain('storage is full');
  });

  it('explosives in transit shows ETA with duration only when nowTick is given', () => {
    const a = action({ type: 'charge_hole', blockedReason: 'explosives_in_transit', payload: { deliveryArrivalTick: 600 } });
    expect(buildBlockedOrderMessage(a)).toContain('on their way');
    expect(buildBlockedOrderMessage(a)).not.toContain('(in ');
    expect(buildBlockedOrderMessage(a, 100)).toContain('(in ');
    expect(buildBlockedOrderMessage(a, 9999)).toContain('(in ');
    expect(buildBlockedOrderMessage(action({ blockedReason: 'explosives_in_transit' }))).toContain('on their way');
  });

  it('stranded debris and unknown reason', () => {
    expect(buildBlockedOrderMessage(action({ blockedReason: 'debris_out_of_reach' }))).toContain('out of reach');
    expect(buildBlockedOrderMessage(action({ blockedReason: null }))).not.toContain('notification.');
  });
});

describe('block classification', () => {
  it('isFailureBlock excludes null, debris and in-transit', () => {
    expect(isFailureBlock({ blockedReason: null })).toBe(false);
    expect(isFailureBlock({ blockedReason: 'debris_out_of_reach' })).toBe(false);
    expect(isFailureBlock({ blockedReason: 'explosives_in_transit' })).toBe(false);
    expect(isFailureBlock({ blockedReason: 'storage_full' })).toBe(true);
  });

  it('isInTransitBlock matches only explosives_in_transit', () => {
    expect(isInTransitBlock({ blockedReason: 'explosives_in_transit' })).toBe(true);
    expect(isInTransitBlock({ blockedReason: 'storage_full' })).toBe(false);
  });
});
