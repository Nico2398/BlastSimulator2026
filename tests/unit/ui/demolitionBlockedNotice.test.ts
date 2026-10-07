// @vitest-environment jsdom
// BlastSimulator2026 — blocked demolition order names the Building Destroyer, en + fr (#1392)

import { describe, it, expect, afterEach } from 'vitest';
import { buildBlockedOrderMessage } from '../../../src/ui/notify/NotificationCenter.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';

function demolishAction(blockedReason: PendingAction['blockedReason']): PendingAction {
  return {
    id: 1, type: 'demolish_building', requiredSkill: null, requiredVehicleRole: 'building_destroyer',
    targetX: 3, targetZ: 3, targetY: 0, payload: {}, targetEmployeeId: null,
    status: 'queued', holderId: null, queuedAtTick: 0, blockedReason,
  };
}

afterEach(() => setLocale('en'));

describe('blocked demolition notification', () => {
  it('en: no vehicle says it needs a Building Destroyer', () => {
    const msg = buildBlockedOrderMessage(demolishAction('no_vehicle_in_fleet'));
    expect(msg).toContain('needs a Building Destroyer');
  });

  it('en: no licensed driver names the Building Destroyer', () => {
    const msg = buildBlockedOrderMessage(demolishAction('no_licensed_driver'));
    expect(msg).toContain('Building Destroyer');
    expect(msg).toContain('licensed');
  });

  it('fr: no vehicle is localized and names the vehicle role in French', () => {
    setLocale('fr');
    const msg = buildBlockedOrderMessage(demolishAction('no_vehicle_in_fleet'));
    expect(msg).toContain(t('vehicle_type.building_destroyer'));
    expect(msg).toContain('nécessite');
    expect(msg).not.toContain('needs a');
  });

  it('the already-ordered refusal exists in both locales and differs', () => {
    const en = t('entities.build_demolish_already_ordered', { id: 4 });
    setLocale('fr');
    const fr = t('entities.build_demolish_already_ordered', { id: 4 });
    expect(en).toContain('#4');
    expect(fr).toContain('#4');
    expect(fr).not.toBe(en);
  });
});
