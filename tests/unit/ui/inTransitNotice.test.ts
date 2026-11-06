// @vitest-environment jsdom
// BlastSimulator2026 — an unaffordable explosives order reads as a cash wait, never as a delivery in transit (#2143, was #1895)

import { describe, it, expect, afterEach } from 'vitest';
import { buildBlockedOrderMessage } from '../../../src/ui/notify/blockedOrders.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import { ACTION_LABEL_KEY } from '../../../src/ui/crewDetailSections.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';

function chargeAction(): PendingAction {
  return {
    id: 1, type: 'charge_hole', requiredSkill: 'blasting', requiredVehicleRole: 'charging_truck',
    targetX: 3, targetZ: 3, targetY: 0, payload: { holeId: 'H1' }, targetEmployeeId: null,
    status: 'queued', holderId: null, queuedAtTick: 0,
    blockedReason: 'explosives_unaffordable',
  } as PendingAction;
}

afterEach(() => setLocale('en'));

describe('explosives_unaffordable notification wording (#2143)', () => {
  it('en: names the order, no arrival text, no raw key, no tick', () => {
    setLocale('en');
    const msg = buildBlockedOrderMessage(chargeAction(), 280);
    expect(msg).toContain(t(ACTION_LABEL_KEY['charge_hole']));
    expect(msg).not.toMatch(/arriv|transit|on their way/i);
    expect(msg).not.toContain('tick');
    expect(msg).not.toContain('notification.');
  });

  it('fr: names the order, no arrival text, no raw key', () => {
    setLocale('fr');
    const msg = buildBlockedOrderMessage(chargeAction(), 280);
    expect(msg).toContain(t(ACTION_LABEL_KEY['charge_hole']));
    expect(msg).not.toMatch(/arriv|transit/i);
    expect(msg).not.toContain('notification.');
  });

  it('is the same with or without a clock reading', () => {
    setLocale('en');
    expect(buildBlockedOrderMessage(chargeAction())).toBe(buildBlockedOrderMessage(chargeAction(), 999));
  });
});
