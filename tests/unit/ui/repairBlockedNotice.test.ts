// @vitest-environment jsdom
// BlastSimulator2026 — blocked repair order names the missing Repair training, en + fr (#1393)

import { describe, it, expect, afterEach } from 'vitest';
import { buildBlockedOrderMessage } from '../../../src/ui/notify/NotificationCenter.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';

function repairAction(): PendingAction {
  return {
    id: 1, type: 'repair_vehicle', requiredSkill: 'repair', requiredVehicleRole: null,
    targetX: 3, targetZ: 3, targetY: 0, payload: { vehicleId: 1 }, targetEmployeeId: null,
    status: 'queued', holderId: null, queuedAtTick: 0, blockedReason: 'no_qualified_employee',
  };
}

afterEach(() => setLocale('en'));

describe('blocked repair notification', () => {
  it('en: says it needs someone trained in Repair', () => {
    setLocale('en');
    const msg = buildBlockedOrderMessage(repairAction());
    expect(msg).toMatch(/needs someone trained in Repair/i);
    expect(msg).not.toContain('notification.');
    expect(msg).not.toContain('skill.repair');
  });

  it('fr: is translated, not the English text nor a raw key', () => {
    setLocale('en');
    const en = buildBlockedOrderMessage(repairAction());
    setLocale('fr');
    const fr = buildBlockedOrderMessage(repairAction());
    expect(fr).not.toBe(en);
    expect(fr).not.toContain('notification.');
    expect(fr).not.toContain('skill.repair');
    expect(fr).not.toContain('ui.crew.action_repair_vehicle');
    expect(fr).toMatch(/répar/i);
  });
});
