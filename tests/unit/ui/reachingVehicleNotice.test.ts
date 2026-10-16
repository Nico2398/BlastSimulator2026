// @vitest-environment jsdom
// BlastSimulator2026 — blocked drill order names the missing reaching rig tier, en + fr (#1714)

import { describe, it, expect, afterEach } from 'vitest';
import { buildBlockedOrderMessage } from '../../../src/ui/notify/blockedOrders.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';

function drillAction(): PendingAction {
  return {
    id: 1, type: 'drill_hole', requiredSkill: 'driving.drill_rig', requiredVehicleRole: 'drill_rig',
    targetX: 3, targetZ: 3, targetY: 0, payload: { depth: 20 }, targetEmployeeId: null,
    status: 'queued', holderId: null, queuedAtTick: 0,
    blockedReason: 'no_reaching_vehicle', blockedLicenceLevel: 2,
  };
}

afterEach(() => setLocale('en'));

describe('no_reaching_vehicle notification', () => {
  it('en: names the tier, no raw key', () => {
    setLocale('en');
    const msg = buildBlockedOrderMessage(drillAction());
    expect(msg).toMatch(/tier-2/);
    expect(msg).not.toContain('notification.');
    expect(msg).not.toContain('vehicle_type.');
  });

  it('fr: translated, gender-neutral, no raw key', () => {
    setLocale('en');
    const en = buildBlockedOrderMessage(drillAction());
    setLocale('fr');
    const fr = buildBlockedOrderMessage(drillAction());
    expect(fr).not.toBe(en);
    expect(fr).not.toContain('notification.');
    expect(fr).toContain('un(e)');
    expect(fr).toContain('2');
  });
});
