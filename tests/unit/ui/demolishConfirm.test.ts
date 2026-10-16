// @vitest-environment jsdom
// Demolish confirmation modal config (#1399).
import { describe, it, expect, vi } from 'vitest';
import { createLogisticsState } from '../../../src/core/economy/Logistics.js';
import { buildDemolishConfirm, freightOreKg } from '../../../src/ui/demolishConfirm.js';
import { getDemolishCost, type Building } from '../../../src/core/entities/Building.js';
import { formatMoney } from '../../../src/core/economy/formatMoney.js';
import { t } from '../../../src/core/i18n/I18n.js';

function makeBuilding(overrides: Partial<Building> = {}): Building {
  return { id: 7, type: 'management_office', tier: 1, x: 5, z: 5, hp: 100, active: true, occupantIds: [], ...overrides };
}

describe('buildDemolishConfirm (#1399)', () => {
  it('uses the demolish label, trash icon and a localized title', () => {
    const cfg = buildDemolishConfirm(makeBuilding(), vi.fn());
    expect(cfg.confirmLabel).toBe(t('ui.build.demolish'));
    expect(cfg.icon).toBe('trash');
    expect(cfg.title).toBe(t('ui.build.demolish_confirm_title'));
    expect(cfg.title).not.toBe('ui.build.demolish_confirm_title');
  });

  it('body names the building and the formatted demolish cost', () => {
    const b = makeBuilding();
    const cfg = buildDemolishConfirm(b, vi.fn());
    expect(cfg.body).toContain(t('building.management_office.t1.name'));
    expect(cfg.body).toContain(`$${formatMoney(getDemolishCost(b))}`);
    expect(cfg.body).not.toContain('ui.build.demolish_confirm_body');
  });

  it('cost string tracks the tier', () => {
    const b = makeBuilding({ tier: 2 });
    const cfg = buildDemolishConfirm(b, vi.fn());
    expect(cfg.body).toContain(`$${formatMoney(getDemolishCost(b))}`);
    expect(cfg.body).toContain(t('building.management_office.t2.name'));
  });

  it('plain building body has no lost-explosives line', () => {
    const cfg = buildDemolishConfirm(makeBuilding(), vi.fn());
    expect(cfg.body).not.toContain(t('ui.build.demolish_confirm_loses_explosives', { kg: 0 }));
    expect(cfg.body).not.toContain('ui.build.demolish_confirm_loses_explosives');
  });

  it('explosive warehouse with stock warns with the kg lost', () => {
    const b = makeBuilding({ type: 'explosive_warehouse', storedExplosives: { anfo: 250 } });
    const cfg = buildDemolishConfirm(b, vi.fn());
    expect(cfg.body).toContain(t('ui.build.demolish_confirm_loses_explosives', { kg: 250 }));
    expect(cfg.body).toContain('250');
    expect(cfg.body).not.toContain('{kg}');
  });

  it('explosive warehouse with zero stock has no warning', () => {
    const b = makeBuilding({ type: 'explosive_warehouse', storedExplosives: { anfo: 0 } });
    const cfg = buildDemolishConfirm(b, vi.fn());
    expect(cfg.body).not.toContain(t('ui.build.demolish_confirm_loses_explosives', { kg: 0 }));
  });

  it('explosive warehouse with undefined stock has no warning', () => {
    const b = makeBuilding({ type: 'explosive_warehouse' });
    const cfg = buildDemolishConfirm(b, vi.fn());
    expect(cfg.body).not.toContain('ui.build.demolish_confirm_loses_explosives');
    expect(cfg.body).not.toMatch(/\bkg\b.*lost|lost.*\bkg\b/i);
  });

  it('freight ore in storage adds a line naming the kg lost (#1758)', () => {
    const b = makeBuilding({ type: 'freight_warehouse' });
    const cfg = buildDemolishConfirm(b, vi.fn(), { storedOreKg: 4200 });
    expect(cfg.body).toContain(t('ui.build.demolish_confirm_loses_ore', { kg: 4200 }));
    expect(cfg.body).toContain('4200');
    expect(cfg.body).not.toContain('ui.build.demolish_confirm_loses_ore');
    expect(cfg.body).not.toContain('{kg}');
  });

  it('zero or absent stored ore adds no ore line (#1758)', () => {
    const b = makeBuilding({ type: 'freight_warehouse' });
    expect(buildDemolishConfirm(b, vi.fn(), { storedOreKg: 0 }).body)
      .toBe(buildDemolishConfirm(b, vi.fn()).body);
    expect(buildDemolishConfirm(b, vi.fn(), {}).body).toBe(buildDemolishConfirm(b, vi.fn()).body);
    expect(buildDemolishConfirm(b, vi.fn(), { storedOreKg: 0 }).body).not.toContain('loses_ore');
  });

  it('ore and explosives lines can both show, cost line first (#1758)', () => {
    const b = makeBuilding({ type: 'explosive_warehouse', storedExplosives: { anfo: 250 } });
    const cfg = buildDemolishConfirm(b, vi.fn(), { storedOreKg: 90 });
    expect(cfg.body).toContain(t('ui.build.demolish_confirm_loses_explosives', { kg: 250 }));
    expect(cfg.body).toContain(t('ui.build.demolish_confirm_loses_ore', { kg: 90 }));
    expect(cfg.body.indexOf(`$${formatMoney(getDemolishCost(b))}`)).toBeLessThan(cfg.body.indexOf(t('ui.build.demolish_confirm_loses_ore', { kg: 90 })));
  });

  it('the ore line is localized, not an English fallback key (#1758)', () => {
    expect(t('ui.build.demolish_confirm_loses_ore', { kg: 5 })).not.toBe('ui.build.demolish_confirm_loses_ore');
  });

  it('building the config alone never runs onConfirm', () => {
    const onConfirm = vi.fn();
    buildDemolishConfirm(makeBuilding(), onConfirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('onConfirm callback is the one passed in', () => {
    const onConfirm = vi.fn();
    buildDemolishConfirm(makeBuilding(), onConfirm).onConfirm();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('freightOreKg (#1758)', () => {
  it('sums stored ore of that freight warehouse only; other types are 0', () => {
    const l = createLogisticsState();
    l.fragments.push(
      { fragment: { id: 1, mass: 700.4 }, state: 'stored', vehicleId: null, warehouseId: 7 } as never,
      { fragment: { id: 2, mass: 50 }, state: 'stored', vehicleId: null, warehouseId: 8 } as never,
    );
    expect(freightOreKg(l, makeBuilding({ type: 'freight_warehouse' }))).toBe(700);
    expect(freightOreKg(l, makeBuilding({ type: 'explosive_warehouse' }))).toBe(0);
  });
});
