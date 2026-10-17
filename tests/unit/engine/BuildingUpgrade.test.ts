// BlastSimulator2026 — In-place building upgrade (#1875)

import { describe, it, expect } from 'vitest';
import { isUpgradeOrdered, completeUpgrade, checkUpgradeFootprint } from '../../../src/core/engine/BuildingUpgrade.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { getBuildingDef, getDefSize } from '../../../src/core/entities/Building.js';
import type { Building } from '../../../src/core/entities/Building.js';
import type { PlannedBuilding } from '../../../src/core/state/GameState.js';

function building(over: Partial<Building> = {}): Building {
  return { id: 4, type: 'living_quarters', tier: 1, x: 9, z: 14, hp: 10, active: true, occupantIds: [11, 12], ...over };
}

function site(over: Partial<PlannedBuilding> = {}): PlannedBuilding {
  return { id: 70, buildingId: 4, type: 'living_quarters', tier: 2, x: 9, z: 14, actionId: 5, cost: 1, upgrade: true, ...over };
}

describe('isUpgradeOrdered', () => {
  it('is false with no planned buildings', () => {
    expect(isUpgradeOrdered({ plannedBuildings: [] }, 4)).toBe(false);
  });

  it('is true for a pending upgrade site on that building, only', () => {
    const state = { plannedBuildings: [site()] };
    expect(isUpgradeOrdered(state, 4)).toBe(true);
    expect(isUpgradeOrdered(state, 5)).toBe(false);
  });

  it('ignores a plain construction site that merely shares the id', () => {
    expect(isUpgradeOrdered({ plannedBuildings: [site({ upgrade: false })] }, 4)).toBe(false);
    const { upgrade: _omit, ...plain } = site();
    expect(isUpgradeOrdered({ plannedBuildings: [plain] }, 4)).toBe(false);
  });
});

describe('completeUpgrade', () => {
  it('raises the tier in place, keeping id, position and occupants', () => {
    const b = building();
    const state = { buildings: { buildings: [b] } } as unknown as Parameters<typeof completeUpgrade>[0];
    const out = completeUpgrade(state, 4, 2)!;
    expect(out.tier).toBe(2);
    expect(out.id).toBe(4);
    expect([out.x, out.z]).toEqual([9, 14]);
    expect(out.occupantIds).toEqual([11, 12]);
    expect(state.buildings.buildings).toHaveLength(1);
    expect(state.buildings.buildings[0]!.tier).toBe(2);
  });

  it('refills hp to the new tier max', () => {
    const state = { buildings: { buildings: [building({ hp: 1 })] } } as unknown as Parameters<typeof completeUpgrade>[0];
    expect(completeUpgrade(state, 4, 2)!.hp).toBe(getBuildingDef('living_quarters', 2).maxHp);
  });

  it('returns null and changes nothing when the building is gone', () => {
    const state = { buildings: { buildings: [building({ id: 9 })] } } as unknown as Parameters<typeof completeUpgrade>[0];
    expect(completeUpgrade(state, 4, 2)).toBeNull();
    expect(state.buildings.buildings.map(b => b.tier)).toEqual([1]);
  });
});

describe('checkUpgradeFootprint', () => {
  const bounds = { width: 64, depth: 64, originX: 0, originZ: 0 };

  function world() {
    const state = createGame({ seed: 1 } as Parameters<typeof createGame>[0]);
    const b = building({ type: 'freight_warehouse', x: 20, z: 20 });
    state.buildings.buildings.push(b);
    return { state, b };
  }

  it('accepts a clear footprint; the building itself and an ignored site do not block', () => {
    const { state, b } = world();
    expect(checkUpgradeFootprint(state, null, bounds, b, 2).valid).toBe(true);
    const own = site({ type: 'freight_warehouse', x: 20, z: 20 });
    state.plannedBuildings.push(own);
    expect(checkUpgradeFootprint(state, null, bounds, b, 2, [own]).valid).toBe(true);
  });

  it('refuses when another building sits on the larger footprint', () => {
    const { state, b } = world();
    const t1 = getDefSize(getBuildingDef('freight_warehouse', 1));
    state.buildings.buildings.push(building({ id: 9, type: 'management_office', x: 20 + t1.sizeX, z: 20 }));
    expect(checkUpgradeFootprint(state, null, bounds, b, 2).valid).toBe(false);
  });
});
