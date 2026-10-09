// Per-warehouse freight storage behind the shared pool (#1372).

import { describe, it, expect } from 'vitest';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import {
  createLogisticsState,
  addBlastFragments,
  pickupFragment,
  deliverToDepot,
  consumeStoredOre,
  splitStoredFragmentMass,
  sellFragment,
  returnFragmentToGround,
  type LogisticsState,
} from '../../../src/core/economy/Logistics.js';
import {
  warehouseStoredKg,
  warehouseFreeKg,
  pickWarehouse,
  loseOrphanedStock,
  type WarehouseSite,
} from '../../../src/core/economy/FreightWarehouses.js';
import { oreContributionKg } from '../../../src/core/mining/BlastOreReport.js';

function frag(id: number, mass: number, oreDensities: Record<string, number> = { dirtite: 0.3 }, x = 0, z = 0): FragmentData {
  return {
    id,
    position: { x, y: 0, z },
    volume: mass / 2.5,
    mass,
    rockId: 'sandite',
    oreDensities,
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: id,
    origin: { x, y: 0, z },
  };
}

const A: WarehouseSite = { id: 10, x: 0, z: 0, capacityKg: 300 };
const B: WarehouseSite = { id: 20, x: 50, z: 0, capacityKg: 300 };
const SITES = [A, B];

function makeLogistics(sites: readonly WarehouseSite[], masses: number[], oreDensities?: Record<string, number>): LogisticsState {
  const l = createLogisticsState(sites.reduce((s, w) => s + w.capacityKg, 0));
  addBlastFragments(l, masses.map((m, i) => frag(i + 1, m, oreDensities)));
  return l;
}

/** Haul fragment `id` from (x,z) into storage; returns whether both steps succeeded. */
function haul(l: LogisticsState, id: number, ore: Record<string, number>, sites: readonly WarehouseSite[], x = 0, z = 0): boolean {
  if (!pickupFragment(l, id, 'v1', sites, x, z)) return false;
  return deliverToDepot(l, id, ore, sites, x, z);
}

function wid(l: LogisticsState, id: number): number | null {
  return l.fragments.find(f => f.fragment.id === id)!.warehouseId;
}

describe('warehouseStoredKg / warehouseFreeKg', () => {
  it('warehouseStoredKg sums only stored fragments of that warehouse', () => {
    const l = makeLogistics(SITES, [100, 50, 70]);
    expect(haul(l, 1, {}, SITES)).toBe(true);
    expect(haul(l, 2, {}, SITES, 50, 0)).toBe(true); // nearer to B
    expect(warehouseStoredKg(l, A.id)).toBe(100);
    expect(warehouseStoredKg(l, B.id)).toBe(50);
    expect(warehouseStoredKg(l, 999)).toBe(0);
  });

  it('warehouseFreeKg is capacity minus stored minus in-transit reserved for it', () => {
    const l = makeLogistics(SITES, [100, 60]);
    expect(warehouseFreeKg(l, A)).toBe(300);
    haul(l, 1, {}, SITES);
    expect(warehouseFreeKg(l, A)).toBe(200);
    expect(pickupFragment(l, 2, 'v1', SITES, 0, 0)).toBe(true);
    expect(wid(l, 2)).toBe(A.id);
    expect(warehouseFreeKg(l, A)).toBe(140);
    expect(warehouseFreeKg(l, B)).toBe(300);
  });

  it('warehouseFreeKg is zero-ish for a full warehouse (boundary)', () => {
    const l = makeLogistics(SITES, [300]);
    haul(l, 1, {}, SITES);
    expect(warehouseFreeKg(l, A)).toBe(0);
  });
});

describe('pickWarehouse', () => {
  it('picks the nearest warehouse with room', () => {
    const l = makeLogistics(SITES, []);
    expect(pickWarehouse(l, SITES, 40, 0, 100)?.id).toBe(B.id);
    expect(pickWarehouse(l, SITES, 5, 0, 100)?.id).toBe(A.id);
  });

  it('skips the nearest when it lacks room', () => {
    const l = makeLogistics(SITES, [250]);
    haul(l, 1, {}, SITES); // A: 50 free
    expect(pickWarehouse(l, SITES, 0, 0, 100)?.id).toBe(B.id);
  });

  it('accepts an exact fit', () => {
    const l = makeLogistics(SITES, []);
    expect(pickWarehouse(l, SITES, 0, 0, 300)?.id).toBe(A.id);
  });

  it('rejects one kg over the largest free room', () => {
    const l = makeLogistics(SITES, []);
    expect(pickWarehouse(l, SITES, 0, 0, 300.5)).toBeNull();
  });

  it('breaks distance ties by lowest id', () => {
    const l = makeLogistics(SITES, []);
    const sites: WarehouseSite[] = [
      { id: 7, x: 10, z: 0, capacityKg: 300 },
      { id: 3, x: -10, z: 0, capacityKg: 300 },
    ];
    expect(pickWarehouse(l, sites, 0, 0, 10)?.id).toBe(3);
  });

  it('returns null with zero warehouses', () => {
    const l = makeLogistics([], []);
    expect(pickWarehouse(l, [], 0, 0, 1)).toBeNull();
  });
});

describe('pickupFragment / deliverToDepot with two warehouses', () => {
  it('unloads into the nearest warehouse and spills into the next when full', () => {
    const l = makeLogistics(SITES, [200, 200]);
    const ore: Record<string, number> = {};
    expect(haul(l, 1, ore, SITES)).toBe(true);
    expect(haul(l, 2, ore, SITES)).toBe(true);
    expect(wid(l, 1)).toBe(A.id);
    expect(wid(l, 2)).toBe(B.id);
    expect(warehouseStoredKg(l, A.id) + warehouseStoredKg(l, B.id)).toBe(l.storedMassKg);
    expect(l.storedMassKg).toBe(400);
  });

  it('pickup reserves the chosen warehouse', () => {
    const l = makeLogistics(SITES, [200]);
    expect(pickupFragment(l, 1, 'v1', SITES, 50, 0)).toBe(true);
    expect(wid(l, 1)).toBe(B.id);
  });

  it('pickup rejects when no single warehouse fits even though the pool has room', () => {
    const l = makeLogistics(SITES, [200, 200, 200]);
    haul(l, 1, {}, SITES);
    haul(l, 2, {}, SITES);
    // pool: 600 cap, 400 stored -> 200 free, but 100 free in each warehouse
    expect(pickupFragment(l, 3, 'v1', SITES, 0, 0)).toBe(false);
    expect(l.fragments.find(f => f.fragment.id === 3)!.state).toBe('on_ground');
    expect(wid(l, 3)).toBeNull();
  });

  it('pickup counts in-transit reservations against the chosen warehouse', () => {
    const l = makeLogistics(SITES, [200, 200, 200]);
    expect(pickupFragment(l, 1, 'v1', SITES, 0, 0)).toBe(true);
    expect(pickupFragment(l, 2, 'v2', SITES, 0, 0)).toBe(true);
    expect(wid(l, 1)).toBe(A.id);
    expect(wid(l, 2)).toBe(B.id);
    expect(pickupFragment(l, 3, 'v3', SITES, 0, 0)).toBe(false);
  });

  it('pickup with no warehouses is refused', () => {
    const l = makeLogistics([], [10]);
    expect(pickupFragment(l, 1, 'v1', [], 0, 0)).toBe(false);
  });

  it('delivery lands in the reserved warehouse and stores its id', () => {
    const l = makeLogistics(SITES, [100]);
    pickupFragment(l, 1, 'v1', SITES, 0, 0);
    expect(deliverToDepot(l, 1, {}, SITES, 50, 0)).toBe(true);
    expect(wid(l, 1)).toBe(A.id);
    expect(l.fragments[0]!.state).toBe('stored');
  });

  it('delivery re-picks when the reserved warehouse is gone', () => {
    const l = makeLogistics(SITES, [100]);
    pickupFragment(l, 1, 'v1', SITES, 0, 0); // reserves A
    expect(deliverToDepot(l, 1, {}, [B], 0, 0)).toBe(true);
    expect(wid(l, 1)).toBe(B.id);
    expect(l.storedMassKg).toBe(100);
  });

  it('delivery re-picks when the reserved warehouse became full', () => {
    const l = makeLogistics(SITES, [200, 200]);
    pickupFragment(l, 1, 'v1', SITES, 0, 0); // reserves A
    // A fills up behind the reservation (fragment 2 stored there directly).
    const other = l.fragments.find(f => f.fragment.id === 2)!;
    other.state = 'stored';
    other.warehouseId = A.id;
    l.storedMassKg += 200;
    expect(deliverToDepot(l, 1, {}, SITES, 0, 0)).toBe(true);
    expect(wid(l, 1)).toBe(B.id);
  });

  it('delivery returns false and mutates nothing when no warehouse can take it', () => {
    const l = makeLogistics(SITES, [100]);
    const ore: Record<string, number> = {};
    pickupFragment(l, 1, 'v1', SITES, 0, 0);
    expect(deliverToDepot(l, 1, ore, [], 0, 0)).toBe(false);
    const t = l.fragments[0]!;
    expect(t.state).toBe('in_transit');
    expect(t.vehicleId).toBe('v1');
    expect(l.storedMassKg).toBe(0);
    expect(ore).toEqual({});
  });

  it('returnFragmentToGround clears the reservation', () => {
    const l = makeLogistics(SITES, [100]);
    pickupFragment(l, 1, 'v1', SITES, 0, 0);
    expect(returnFragmentToGround(l, 1)).toBe(true);
    expect(wid(l, 1)).toBeNull();
    expect(warehouseFreeKg(l, A)).toBe(300);
  });
});

describe('pool sums stay consistent', () => {
  it('storedMassKg and storageCapacityKg remain pool totals', () => {
    const l = makeLogistics(SITES, [200, 150]);
    haul(l, 1, {}, SITES);
    haul(l, 2, {}, SITES);
    expect(l.storageCapacityKg).toBe(600);
    expect(l.storedMassKg).toBe(350);
    expect(warehouseStoredKg(l, A.id)).toBe(200);
    expect(warehouseStoredKg(l, B.id)).toBe(150);
  });

  it('consumeStoredOre draws from both warehouses and removes only the sold mass', () => {
    const ore: Record<string, number> = {};
    const l = makeLogistics(SITES, [200, 200], { blingite: 0.5 });
    haul(l, 1, ore, SITES);
    haul(l, 2, ore, SITES);
    const perFragment = oreContributionKg(200 / 2.5, 0.5);
    expect(ore.blingite).toBeCloseTo(perFragment * 2, 6);
    const want = perFragment * 1.5;
    const res = consumeStoredOre(l, ore, 'blingite', want, []);
    expect(res.success).toBe(true);
    expect(res.consumedKg).toBeCloseTo(want, 6);
    expect(ore.blingite).toBeCloseTo(perFragment * 0.5, 6);
    expect(warehouseStoredKg(l, A.id) + warehouseStoredKg(l, B.id)).toBeCloseTo(l.storedMassKg, 6);
    // Both warehouses lost mass; neither lost more than it held.
    expect(warehouseStoredKg(l, A.id)).toBeLessThan(200);
    expect(warehouseStoredKg(l, B.id)).toBeLessThan(200);
    expect(l.storedMassKg).toBeLessThan(400);
    expect(l.storedMassKg).toBeGreaterThan(0);
  });

  it('selling a whole fragment frees its warehouse room', () => {
    const l = makeLogistics(SITES, [200]);
    haul(l, 1, {}, SITES);
    sellFragment(l, 1);
    expect(warehouseStoredKg(l, A.id)).toBe(0);
    expect(warehouseFreeKg(l, A)).toBe(300);
  });
});

describe('loseOrphanedStock', () => {
  function stocked() {
    const ore: Record<string, number> = {};
    const l = makeLogistics(SITES, [200, 200, 80]);
    haul(l, 1, ore, SITES); // A
    haul(l, 2, ore, SITES); // B
    haul(l, 3, ore, SITES, 50, 0); // B (near B)
    return { l, ore };
  }

  it('removes fragments of a vanished warehouse and debits storedMassKg and collectedOre', () => {
    const { l, ore } = stocked();
    const beforeOre = ore.dirtite!;
    const losses = loseOrphanedStock(l, ore, new Set([A.id]));
    expect(losses).toHaveLength(1);
    expect(losses[0]!.buildingId).toBe(B.id);
    expect(losses[0]!.massKg).toBeCloseTo(280, 6);
    expect(l.storedMassKg).toBeCloseTo(200, 6);
    expect(l.fragments.map(f => f.fragment.id)).toEqual([1]);
    const lostOre = oreContributionKg(280 / 2.5, 0.3);
    expect(losses[0]!.oreKg.dirtite).toBeCloseTo(lostOre, 6);
    expect(ore.dirtite).toBeCloseTo(beforeOre - lostOre, 6);
  });

  it('leaves the other warehouse untouched', () => {
    const { l, ore } = stocked();
    loseOrphanedStock(l, ore, new Set([A.id]));
    expect(warehouseStoredKg(l, A.id)).toBe(200);
    expect(l.fragments.find(f => f.fragment.id === 1)!.warehouseId).toBe(A.id);
  });

  it('reports no entry for an empty warehouse', () => {
    const { l, ore } = stocked();
    const snapshot = l.storedMassKg;
    expect(loseOrphanedStock(l, ore, new Set([A.id, B.id, 30]))).toEqual([]);
    expect(l.storedMassKg).toBe(snapshot);
    const l2 = makeLogistics(SITES, []);
    expect(loseOrphanedStock(l2, {}, new Set())).toEqual([]);
  });

  it('returns one entry per warehouse with stock', () => {
    const { l, ore } = stocked();
    const losses = loseOrphanedStock(l, ore, new Set());
    expect(losses.map(x => x.buildingId).sort()).toEqual([A.id, B.id]);
    expect(l.storedMassKg).toBeCloseTo(0, 6);
    expect(l.fragments).toHaveLength(0);
  });

  it('clamps collectedOre at zero', () => {
    const { l, ore } = stocked();
    ore.dirtite = 1; // ledger already short of what is physically stored
    loseOrphanedStock(l, ore, new Set());
    expect(ore.dirtite).toBe(0);
    expect(l.storedMassKg).toBeGreaterThanOrEqual(0);
  });

  it('ignores on-ground fragments', () => {
    const { l, ore } = stocked();
    addBlastFragments(l, [frag(99, 40)]);
    loseOrphanedStock(l, ore, new Set());
    expect(l.fragments.map(f => f.fragment.id)).toEqual([99]);
  });

  it('a partially sold fragment loses only its remaining mass', () => {
    const ore: Record<string, number> = {};
    const l = makeLogistics(SITES, [200]);
    haul(l, 1, ore, SITES);
    splitStoredFragmentMass(l, 1, 50);
    ore.dirtite = ore.dirtite! - oreContributionKg(50 / 2.5, 0.3);
    const losses = loseOrphanedStock(l, ore, new Set());
    expect(losses).toHaveLength(1);
    expect(losses[0]!.massKg).toBeCloseTo(150, 6);
    expect(l.storedMassKg).toBeCloseTo(0, 6);
    expect(ore.dirtite).toBeCloseTo(0, 6);
  });
});
