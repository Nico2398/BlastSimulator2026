// @vitest-environment jsdom
// BlastSimulator2026 — blocked-order wording and classification branches (#1938, #2045)

import { describe, it, expect, afterEach } from 'vitest';
import { buildBlockedOrderMessage, isFailureBlock, classifyQueuedBlock } from '../../../src/ui/notify/blockedOrders.js';
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
  it('target_unreachable with a ramp detail reads one sentence naming the ramp, grade and limit', () => {
    const msg = buildBlockedOrderMessage(action({
      blockedReason: 'target_unreachable',
      blockedDetail: { key: 'order.blocked.ramp_too_steep', params: { id: 3, grade: 26, max: 20 } },
    }));
    expect(msg).toContain('Ramp #3 is 26°: too steep for vehicles (max 20°).');
    expect(msg).not.toContain('order.blocked');
  });

  it('the ramp sentence names no tier and no role', () => {
    const msg = buildBlockedOrderMessage(action({
      blockedReason: 'target_unreachable',
      blockedDetail: { key: 'order.blocked.ramp_too_steep', params: { id: 9, grade: 3, max: 8 } },
    }));
    expect(msg).toContain('Ramp #9');
    expect(msg).not.toMatch(/tier/i);
    expect(msg).not.toContain('Rock Digger');
  });

  it('the ramp sentence speaks French without tier wording', () => {
    setLocale('fr');
    const msg = buildBlockedOrderMessage(action({
      blockedReason: 'target_unreachable',
      blockedDetail: { key: 'order.blocked.ramp_too_steep', params: { id: 3, grade: 26, max: 20 } },
    }));
    expect(msg).toContain('26');
    expect(msg).toContain('20');
    expect(msg).not.toContain('{');
    expect(msg).not.toMatch(/niveau/i);
  });

  it('target_unreachable without detail falls back to the generic text', () => {
    expect(buildBlockedOrderMessage(action({ blockedReason: 'target_unreachable' }))).toContain("can't reach its target");
  });

  it('target_unreachable with malformed detail falls back to the generic text', () => {
    const bad = { key: 5, params: null } as unknown as NonNullable<PendingAction['blockedDetail']>;
    expect(buildBlockedOrderMessage(action({ blockedReason: 'target_unreachable', blockedDetail: bad })))
      .toContain("can't reach its target");
    const noParams = { key: 'order.blocked.ramp_too_steep', params: null } as unknown as NonNullable<PendingAction['blockedDetail']>;
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

  it('unaffordable explosives name the order, never an arrival or a raw key', () => {
    const a = action({ type: 'charge_hole', blockedReason: 'explosives_unaffordable' });
    for (const locale of ['en', 'fr'] as const) {
      setLocale(locale);
      const msg = buildBlockedOrderMessage(a, 100);
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).not.toMatch(/arriv|transit|on their way|\(in /i);
      expect(msg).not.toContain('notification.');
    }
  });

  it('stranded debris and unknown reason', () => {
    expect(buildBlockedOrderMessage(action({ blockedReason: 'debris_out_of_reach' }))).toContain('out of reach');
    expect(buildBlockedOrderMessage(action({ blockedReason: null }))).not.toContain('notification.');
  });
});

describe('block classification', () => {
  it('isFailureBlock excludes null and debris', () => {
    expect(isFailureBlock({ blockedReason: null })).toBe(false);
    expect(isFailureBlock({ blockedReason: 'debris_out_of_reach' })).toBe(false);
    expect(isFailureBlock({ blockedReason: 'storage_full' })).toBe(true);
  });

  it('classifyQueuedBlock sorts a queued order into open, blocked or stranded', () => {
    expect(classifyQueuedBlock({ blockedReason: null })).toBe('open');
    expect(classifyQueuedBlock({ blockedReason: 'no_vehicle_in_fleet' })).toBe('blocked');
    expect(classifyQueuedBlock({ blockedReason: 'debris_out_of_reach' })).toBe('stranded');
  });
});
