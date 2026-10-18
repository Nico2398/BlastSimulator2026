// @vitest-environment jsdom
// BlastSimulator2026 — in-transit explosives order wording, en + fr (#1895)

import { describe, it, expect, afterEach } from 'vitest';
import { buildBlockedOrderMessage, isFailureBlock } from '../../../src/ui/notify/blockedOrders.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import { formatGameDuration } from '../../../src/ui/formatGameDuration.js';
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
  it('en: names the order and the arrival day and hour, no raw key, no tick (#1966)', () => {
    setLocale('en');
    const msg = buildBlockedOrderMessage(chargeAction(), 280);
    expect(msg).toContain(t(ACTION_LABEL_KEY['charge_hole']));
    expect(msg).toContain('Day 19, 05:00'); // tick 437
    expect(msg).toContain(formatGameDuration(437 - 280));
    expect(msg).not.toContain('tick');
    expect(msg).not.toContain('437');
    expect(msg).not.toContain('notification.');
  });

  it('the remaining duration follows nowTick (#1966)', () => {
    setLocale('en');
    const msg = buildBlockedOrderMessage(chargeAction(), 437 - 30);
    expect(msg).toContain(formatGameDuration(30));
    expect(msg).toContain('Day 19, 05:00');
  });

  it('fr: translated, names the order and the arrival day and hour (#1966)', () => {
    setLocale('en');
    const en = buildBlockedOrderMessage(chargeAction(), 280);
    setLocale('fr');
    const fr = buildBlockedOrderMessage(chargeAction(), 280);
    expect(fr).not.toBe(en);
    expect(fr).toContain(t(ACTION_LABEL_KEY['charge_hole']));
    expect(fr).toContain('Jour 19, 05h00');
    expect(fr).toContain(formatGameDuration(437 - 280));
    expect(fr).not.toContain('437');
    expect(fr).not.toContain('notification.');
  });

  it('is not a failure block', () => {
    expect(isFailureBlock(chargeAction())).toBe(false);
  });
});
