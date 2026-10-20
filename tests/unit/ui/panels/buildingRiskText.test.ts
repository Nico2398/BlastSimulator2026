import { describe, it, expect, afterEach } from 'vitest';
import { buildingRiskText } from '../../../../src/ui/panels/buildingRiskText.js';
import { t, setLocale } from '../../../../src/core/i18n/I18n.js';
import type { BuildingAtRisk } from '../../../../src/core/mining/BlastPlan.js';

afterEach(() => setLocale('en'));

const office: BuildingAtRisk = { buildingId: 1, type: 'management_office', x: 14, z: 48, stockKg: 0 };
const stocked: BuildingAtRisk = { buildingId: 2, type: 'explosive_warehouse', x: 22, z: 48, stockKg: 228 };

describe('buildingRiskText (#2021)', () => {
  it('names a non-stocked building and says it will be destroyed', () => {
    expect(buildingRiskText(office)).toBe('Management Office is inside the blast area and will be destroyed.');
  });

  it('uses the building name key through t()', () => {
    expect(buildingRiskText(office)).toBe(t('ui.blast_workshop.preflight.warn_building', { building: t('building.management_office.name') }));
  });

  it('a stocked warehouse names its kg and the secondary blast', () => {
    expect(buildingRiskText(stocked)).toBe(
      'Explosive Warehouse (228 kg stocked) is inside the blast area: it will be destroyed and its stock will detonate as a secondary blast.',
    );
  });

  it('stocked text matches the stocked key', () => {
    expect(buildingRiskText(stocked)).toBe(
      t('ui.blast_workshop.preflight.warn_building_stocked', { building: t('building.explosive_warehouse.name'), kg: 228 }),
    );
  });

  it('rounds fractional stock to whole kg', () => {
    expect(buildingRiskText({ ...stocked, stockKg: 227.6 })).toContain('(228 kg stocked)');
    expect(buildingRiskText({ ...stocked, stockKg: 0.4 })).toContain('(0 kg stocked)');
  });

  it('an empty explosive warehouse (stockKg 0) uses the plain wording', () => {
    const text = buildingRiskText({ ...stocked, stockKg: 0 });
    expect(text).toBe('Explosive Warehouse is inside the blast area and will be destroyed.');
    expect(text).not.toContain('secondary');
  });

  it('has fr text distinct from en, with the kg for stock', () => {
    const en = buildingRiskText(stocked);
    setLocale('fr');
    const fr = buildingRiskText(stocked);
    expect(fr).not.toBe(en);
    expect(fr).toContain('228');
    expect(fr).not.toContain('ui.blast_workshop');
    expect(buildingRiskText(office)).not.toContain('ui.blast_workshop');
  });
});
