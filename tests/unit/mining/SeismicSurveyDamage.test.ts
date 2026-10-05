import { describe, it, expect } from 'vitest';
import { applySeismicSurveyDamage } from '../../../src/core/mining/SeismicSurveyDamage.js';
import { createBuildingState, placeBuilding } from '../../../src/core/entities/Building.js';
import { SEISMIC_SURVEY_DAMAGE_HP, SEISMIC_SURVEY_DAMAGE_RADIUS } from '../../../src/core/config/balance.js';

function stateWith(x: number, z: number) {
  const s = createBuildingState();
  const r = placeBuilding(s, 'living_quarters', x, z, 128, 128);
  expect(r.success).toBe(true);
  return { s, b: r.building! };
}

describe('applySeismicSurveyDamage', () => {
  it('damages a building inside the radius and reports seismic_damage', () => {
    const { s, b } = stateWith(20, 20);
    const before = b.hp;
    const out = applySeismicSurveyDamage(s, 20, 20, 7);
    expect(b.hp).toBe(before - SEISMIC_SURVEY_DAMAGE_HP);
    expect(out).toEqual([
      { tick: 7, type: 'seismic_damage', entityId: b.id, fragmentId: -1, kineticEnergy: 0, entityLabel: 'living_quarters' },
    ]);
    expect(s.buildings).toHaveLength(1);
  });

  it('leaves a building beyond the radius untouched', () => {
    const { s, b } = stateWith(20, 20);
    const before = b.hp;
    const out = applySeismicSurveyDamage(s, 20 + SEISMIC_SURVEY_DAMAGE_RADIUS + 50, 20, 1);
    expect(out).toEqual([]);
    expect(b.hp).toBe(before);
  });

  it('destroys a building whose hp reaches zero and reports seismic_destroyed', () => {
    const { s, b } = stateWith(20, 20);
    b.hp = SEISMIC_SURVEY_DAMAGE_HP;
    const out = applySeismicSurveyDamage(s, 20, 20, 3);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe('seismic_destroyed');
    expect(out[0]!.entityId).toBe(b.id);
    expect(s.buildings).toHaveLength(0);
  });

  it('returns no records for an empty site', () => {
    expect(applySeismicSurveyDamage(createBuildingState(), 0, 0, 0)).toEqual([]);
  });

  it('damages each building in range independently', () => {
    const s = createBuildingState();
    const a = placeBuilding(s, 'living_quarters', 20, 20, 128, 128).building!;
    const c = placeBuilding(s, 'living_quarters', 20, 24, 128, 128).building!;
    const ha = a.hp, hc = c.hp;
    const out = applySeismicSurveyDamage(s, 21.5, 23.5, 2);
    expect(out).toHaveLength(2);
    expect(a.hp).toBe(ha - SEISMIC_SURVEY_DAMAGE_HP);
    expect(c.hp).toBe(hc - SEISMIC_SURVEY_DAMAGE_HP);
  });
});
