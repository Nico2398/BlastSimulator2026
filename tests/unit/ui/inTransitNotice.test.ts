// @vitest-environment jsdom
// BlastSimulator2026 — in-transit explosives order wording, en + fr (#1895)

import { describe, it, expect, afterEach } from 'vitest';
import { buildBlockedOrderMessage, isFailureBlock } from '../../../src/ui/notify/blockedOrders.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import { ACTION_LABEL_KEY } from '../../../src/ui/crewDetailSections.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';

function chargeAction(): PendingAction {
  return {
    id: 1, type: 'charge_hole', requiredSkill: 'blasting', requiredVehicleRole: 'charging_truck',
    targetX: 3, targetZ: 3, targetY: 0, payload: { holeId: 'H1', deliveryArrivalTick: 437 }, targetEmployeeId: null,
    status: 'queued', holderId: null, queuedAtTick: 0,
    blockedReason: 'explosives_in_transit',
  } as PendingAction;
}

afterEach(() => setLocale('en'));

describe('explosives_in_transit notification (#1895)', () => {
  it('en: names the order and the arrival tick, no raw key', () => {
    setLocale('en');
    const msg = buildBlockedOrderMessage(chargeAction());
    expect(msg).toContain(t(ACTION_LABEL_KEY['charge_hole']));
    expect(msg).toContain('437');
    expect(msg).not.toContain('notification.');
  });

  it('fr: translated, names the order and the arrival tick', () => {
    setLocale('en');
    const en = buildBlockedOrderMessage(chargeAction());
    setLocale('fr');
    const fr = buildBlockedOrderMessage(chargeAction());
    expect(fr).not.toBe(en);
    expect(fr).toContain(t(ACTION_LABEL_KEY['charge_hole']));
    expect(fr).toContain('437');
    expect(fr).not.toContain('notification.');
  });

  it('is not a failure block', () => {
    expect(isFailureBlock(chargeAction())).toBe(false);
  });
});
