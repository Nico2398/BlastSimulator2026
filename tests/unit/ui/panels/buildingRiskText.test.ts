import { describe, it, expect, afterEach } from 'vitest';
import { buildingRiskText } from '../../../../src/ui/panels/buildingRiskText.js';
import { t, setLocale } from '../../../../src/core/i18n/I18n.js';
import type { BuildingAtRisk } from '../../../../src/core/mining/BlastPlan.js';

afterEach(() => setLocale('en'));

const office: BuildingAtRisk = { buildingId: 1, type: 'management_office', x: 14, z: 48 };
const warehouse: BuildingAtRisk = { buildingId: 2, type: 'living_quarters', x: 22, z: 48 };

describe('buildingRiskText (#2021)', () => {
  it('names a non-stocked building and says it will be destroyed', () => {
    expect(buildingRiskText(office)).toBe('Management Office is inside the blast area and will be destroyed.');
  });

  it('uses the building name key through t()', () => {
    expect(buildingRiskText(office)).toBe(t('ui.blast_workshop.preflight.warn_building', { building: t('building.management_office.name') }));
  });

  it('a living quarters uses the plain wording', () => {
    const text = buildingRiskText(warehouse);
    expect(text).toBe('Living Quarters is inside the blast area and will be destroyed.');
    expect(text).not.toContain('secondary');
  });

  it('has fr text distinct from en', () => {
    const en = buildingRiskText(warehouse);
    setLocale('fr');
    const fr = buildingRiskText(warehouse);
    expect(fr).not.toBe(en);
    expect(fr).not.toContain('ui.blast_workshop');
    expect(buildingRiskText(office)).not.toContain('ui.blast_workshop');
  });
});
