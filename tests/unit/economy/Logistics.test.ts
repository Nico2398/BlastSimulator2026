import { describe, it, expect } from 'vitest';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import type { WarehouseSite } from '../../../src/core/entities/BuildingWarehouse.js';
import {
  createLogisticsState,
  addBlastFragments,
  pickupFragment,
  deliverToDepot,
  sellFragment,
  getFragmentCounts,
  consumeStoredOre,
  extractOreFromFragment,
  splitStoredFragmentMass,
  returnFragmentToGround,
  storageRoomKg,
  inTransitMassKg,
  type LogisticsState,
} from '../../../src/core/economy/Logistics.js';
import { FRAGMENT_SPLIT_EPSILON_KG, INITIAL_STORAGE_CAPACITY_KG, ORE_DENSITY_KG_M3 } from '../../../src/core/config/balance.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';

/** Explicit capacity: a fresh logistics state holds 0 kg until a freight warehouse exists (#1369). */
const TEST_STORAGE_KG = 5000;

/** Minimal all-walkable NavGrid fixture, mirroring NavGrid.test.ts's own hand-built grids. */
function makeTestNavGrid(width: number, height: number): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = 0; z < height; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < width; x++) {
      row.push({ type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: false });
    }
    cells.push(row);
  }
  return new NavGrid(width, height, cells, 0);
}

function makeFragment(id: number, mass: number = 100): FragmentData {
  return {
    id,
    position: { x: 0, y: 0, z: 0 },
    volume: mass / 2.5,
    mass,
    rockId: 'sandite',
    oreDensities: { dirtite: 0.3 },
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: 1,
    origin: { x: 0, y: 0, z: 0 },
  };
}

/**
 * A fragment already sitting in warehouse storage, with a hand-picked
 * volume/density combo so its ore contribution (volume × density ×
 * ORE_DENSITY_KG_M3 = volume × density × 2500) comes out to a round number.
 */
function makeStoredFragment(
  id: number,
  mass: number,
  volume: number,
  oreDensities: Record<string, number>,
): FragmentData {
  return {
    id,
    position: { x: 0, y: 0, z: 0 },
    volume,
    mass,
    rockId: 'sandite',
    oreDensities,
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: 1,
    origin: { x: 0, y: 0, z: 0 },
  };
}

/** Single freight warehouse (id 1) sized to the state's capacity. */
function siteOf(state: LogisticsState): WarehouseSite[] {
  return [{ id: 1, x: 0, z: 0, capacityKg: state.storageCapacityKg }];
}

/** Push a fragment directly into storage (bypassing pickup/deliver) for consumeStoredOre setup. */
function putInStorage(state: LogisticsState, fragment: FragmentData): void {
  state.fragments.push({ fragment, state: 'stored', vehicleId: null, warehouseId: 1 });
  state.storedMassKg += fragment.mass;
}

describe('Fragment logistics', () => {
  it('after blast, fragments are in on_ground state', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    addBlastFragments(state, [makeFragment(1), makeFragment(2), makeFragment(3)]);

    const counts = getFragmentCounts(state);
    expect(counts.onGround).toBe(3);
    expect(counts.inTransit).toBe(0);
    expect(counts.stored).toBe(0);
  });

  it('pickupFragment moves fragment to in_transit', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    addBlastFragments(state, [makeFragment(1)]);

    const ok = pickupFragment(state, 1, 'truck-01', siteOf(state), 0, 0);
    expect(ok).toBe(true);

    const counts = getFragmentCounts(state);
    expect(counts.onGround).toBe(0);
    expect(counts.inTransit).toBe(1);
  });

  it('delivering fragment to depot moves it to stored', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    addBlastFragments(state, [makeFragment(1, 50)]);
    pickupFragment(state, 1, 'truck-01', siteOf(state), 0, 0);
    deliverToDepot(state, 1, undefined, siteOf(state), 0, 0);

    const counts = getFragmentCounts(state);
    expect(counts.stored).toBe(1);
    expect(state.storedMassKg).toBe(50);
  });

  it('selling fragment against contract credits income and reduces quantity', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    addBlastFragments(state, [makeFragment(1, 200)]);
    pickupFragment(state, 1, 'truck-01', siteOf(state), 0, 0);
    deliverToDepot(state, 1, undefined, siteOf(state), 0, 0);

    const result = sellFragment(state, 1);
    expect(result).not.toBeNull();
    expect(result!.mass).toBe(200);
    expect(result!.oreDensities).toEqual({ dirtite: 0.3 });

    const counts = getFragmentCounts(state);
    expect(counts.total).toBe(0);
    expect(state.storedMassKg).toBe(0);
  });

  it('deliverToDepot without collectedOre works as before', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    addBlastFragments(state, [makeFragment(1, 100)]);
    pickupFragment(state, 1, 'truck-01', siteOf(state), 0, 0);
    const result = deliverToDepot(state, 1, undefined, siteOf(state), 0, 0);
    expect(result).toBe(true);
    const counts = getFragmentCounts(state);
    expect(counts.stored).toBe(1);
  });

  it('deliverToDepot with collectedOre accumulates ore mass correctly', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    addBlastFragments(state, [makeFragment(1, 100)]);
    pickupFragment(state, 1, 'truck-01', siteOf(state), 0, 0);
    const collectedOre: Record<string, number> = {};
    deliverToDepot(state, 1, collectedOre, siteOf(state), 0, 0);
    // fragment volume = 100/2.5 = 40, ore mass = 40 * 0.3 * 2500 = 30000 kg
    expect(collectedOre.dirtite).toBeCloseTo(30000);
  });

  it('deliverToDepot accumulates multiple fragments into collectedOre', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    addBlastFragments(state, [makeFragment(1, 100), makeFragment(2, 200)]);
    pickupFragment(state, 1, 'truck-01', siteOf(state), 0, 0);
    pickupFragment(state, 2, 'truck-01', siteOf(state), 0, 0);
    const collectedOre: Record<string, number> = {};
    deliverToDepot(state, 1, collectedOre, siteOf(state), 0, 0);
    deliverToDepot(state, 2, collectedOre, siteOf(state), 0, 0);
    // Fragment 1: 40*0.3*2500 = 30000, Fragment 2: 80*0.3*2500 = 60000, total = 90000
    expect(collectedOre.dirtite).toBeCloseTo(90000);
  });

  it('deliverToDepot adds to existing ore type in collectedOre', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    addBlastFragments(state, [makeFragment(1, 100)]);
    pickupFragment(state, 1, 'truck-01', siteOf(state), 0, 0);
    const collectedOre: Record<string, number> = { existingOre: 50 };
    deliverToDepot(state, 1, collectedOre, siteOf(state), 0, 0);
    // fragment volume = 40, ore mass = 40 * 0.3 * 2500 = 30000 kg
    expect(collectedOre.dirtite).toBeCloseTo(30000);
    expect(collectedOre.existingOre).toBe(50);
  });

  it('deliverToDepot returns false for missing fragment even with collectedOre', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    addBlastFragments(state, [makeFragment(1, 100)]);
    pickupFragment(state, 1, 'truck-01', siteOf(state), 0, 0);
    const collectedOre: Record<string, number> = {};
    const result = deliverToDepot(state, 999, collectedOre, siteOf(state), 0, 0);
    expect(result).toBe(false);
    expect(collectedOre).toEqual({});
  });

  it('no available storage → cannot pick up more fragments', () => {
    const state = createLogisticsState(150); // Only 150kg capacity
    addBlastFragments(state, [makeFragment(1, 100), makeFragment(2, 100)]);

    // First pickup succeeds
    const ok1 = pickupFragment(state, 1, 'truck-01', siteOf(state), 0, 0);
    expect(ok1).toBe(true);
    deliverToDepot(state, 1, undefined, siteOf(state), 0, 0);

    // Second pickup fails — would exceed capacity
    const ok2 = pickupFragment(state, 2, 'truck-01', siteOf(state), 0, 0);
    expect(ok2).toBe(false);

    const counts = getFragmentCounts(state);
    expect(counts.onGround).toBe(1);
    expect(counts.stored).toBe(1);
  });
});

// ── consumeStoredOre ─────────────────────────────────────────────────────────

describe('consumeStoredOre', () => {
  it('happy path: consumes a stored fragment covering the requested ore amount', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    // volume 0.04 × density 1.0 × 2500 kg/m³ = 100kg of oreA
    const frag1 = makeStoredFragment(1, 500, 0.04, { oreA: 1.0 });
    // A second, untouched fragment worth another 100kg of oreA.
    const frag2 = makeStoredFragment(2, 300, 0.04, { oreA: 1.0 });
    putInStorage(state, frag1);
    putInStorage(state, frag2);
    const collectedOre: Record<string, number> = { oreA: 200 };

    const result = consumeStoredOre(state, collectedOre, 'oreA', 100);

    expect(result.success).toBe(true);
    expect(result.consumedKg).toBeGreaterThan(0);
    expect(result.consumedKg).toBeLessThanOrEqual(100);
    // Exactly one 100kg-of-oreA fragment was removed.
    expect(collectedOre.oreA).toBe(100);
    expect(state.storedMassKg).toBe(300);
    const counts = getFragmentCounts(state);
    expect(counts.stored).toBe(1);
  });

  it('boundary: requesting exactly the available amount succeeds and empties storage', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    // volume 0.04 × density 1.0 × 2500 = 100kg of oreB
    const frag = makeStoredFragment(1, 500, 0.04, { oreB: 1.0 });
    putInStorage(state, frag);
    const collectedOre: Record<string, number> = { oreB: 100 };

    const result = consumeStoredOre(state, collectedOre, 'oreB', 100);

    expect(result.success).toBe(true);
    expect(result.consumedKg).toBe(100);
    expect(collectedOre.oreB).toBe(0);
    expect(state.storedMassKg).toBe(0);
    expect(getFragmentCounts(state).stored).toBe(0);
  });

  it('rejects a request exceeding available stock, leaving state untouched', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    const frag = makeStoredFragment(1, 500, 0.04, { oreC: 1.0 }); // 100kg oreC
    putInStorage(state, frag);
    const collectedOre: Record<string, number> = { oreC: 100 };

    const result = consumeStoredOre(state, collectedOre, 'oreC', 300);

    expect(result.success).toBe(false);
    expect(result.consumedKg).toBe(0);
    expect(result.error).toBeDefined();
    expect(result.error!.length).toBeGreaterThan(0);
    // Error should be actionable — name the material and the shortfall.
    expect(result.error).toContain('oreC');
    // Nothing was touched on failure.
    expect(collectedOre.oreC).toBe(100);
    expect(state.storedMassKg).toBe(500);
    expect(getFragmentCounts(state).stored).toBe(1);
  });

  it('rejects a request for an ore type not present in collectedOre at all', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    const frag = makeStoredFragment(1, 500, 0.04, { oreD: 1.0 });
    putInStorage(state, frag);
    const collectedOre: Record<string, number> = {};

    const result = consumeStoredOre(state, collectedOre, 'unknownOre', 50);

    expect(result.success).toBe(false);
    expect(result.consumedKg).toBe(0);
    expect(result.error).toBeDefined();
    expect(state.storedMassKg).toBe(500);
  });

  it('ore: a request within FRAGMENT_SPLIT_EPSILON_KG of a fragment\'s full ore contribution fully removes it instead of leaving a near-zero sliver', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    // volume 0.16 × density 1.0 × 2500 = 400kg of oreK.
    const oldest = makeStoredFragment(1, 800, 0.16, { oreK: 1.0 });
    // volume 0.12 × density 1.0 × 2500 = 300kg of oreK.
    const newer = makeStoredFragment(2, 600, 0.12, { oreK: 1.0 });
    putInStorage(state, oldest);
    putInStorage(state, newer);
    const collectedOre: Record<string, number> = { oreK: 700 };

    // Just under the oldest fragment's exact ore contribution — close enough
    // that a strict split would leave a sub-epsilon sliver instead of fully
    // removing the fragment.
    const requested = 400 - FRAGMENT_SPLIT_EPSILON_KG / 2;
    const result = consumeStoredOre(state, collectedOre, 'oreK', requested);

    expect(result.success).toBe(true);
    expect(result.consumedKg).toBeCloseTo(requested, 9);
    // The oldest fragment is fully removed — no sliver left behind.
    expect(getFragmentCounts(state).stored).toBe(1);
    expect(state.fragments.find(f => f.fragment.id === 1)).toBeUndefined();
    // The newer fragment is completely untouched.
    const untouched = state.fragments.find(f => f.fragment.id === 2);
    expect(untouched).toBeDefined();
    expect(untouched!.fragment.mass).toBe(600);
    // storedMassKg lands exactly on the remaining fragment's mass — not
    // 600 + a sub-epsilon leftover from the oldest.
    expect(state.storedMassKg).toBe(600);
  });

  it('ore: a request spanning two fragments fully consumes the oldest and partially splits the next', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    // volume 0.16 × density 1.0 × 2500 = 400kg of oreL.
    const oldest = makeStoredFragment(1, 800, 0.16, { oreL: 1.0 });
    // volume 0.12 × density 1.0 × 2500 = 300kg of oreL.
    const newer = makeStoredFragment(2, 600, 0.12, { oreL: 1.0 });
    putInStorage(state, oldest);
    putInStorage(state, newer);
    const collectedOre: Record<string, number> = { oreL: 700 };

    // 500kg: more than the oldest fragment's 400kg of oreL alone, less than
    // the combined 700kg — must fully consume the oldest and partially split
    // 100kg of oreL (200kg of mass) off the newer, leaving its 400kg mass /
    // 200kg-of-oreL remainder in storage.
    const result = consumeStoredOre(state, collectedOre, 'oreL', 500);

    expect(result.success).toBe(true);
    expect(result.consumedKg).toBe(500);
    expect(state.fragments.find(f => f.fragment.id === 1)).toBeUndefined();
    const remainder = state.fragments.find(f => f.fragment.id === 2);
    expect(remainder).toBeDefined();
    expect(remainder!.state).toBe('stored');
    expect(remainder!.fragment.mass).toBe(400);
    expect(getFragmentCounts(state).stored).toBe(1);
    expect(state.storedMassKg).toBe(400);
    expect(collectedOre.oreL).toBe(200);
  });

  it('rubble (materialId "") prefers barren fragments, leaving ore-bearing stock and collectedOre untouched when barren stock alone covers the request', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    // One ore-bearing fragment, one barren fragment — a rubble contract pays
    // cents per kg where an ore_sale pays dollars, so disposal reaches for
    // genuinely worthless waste before it ever touches ore-bearing rock
    // (#959: FIFO-over-everything let a rubble sale scrap ore a same-tick
    // ore_sale contract could have sold for real money instead).
    const oreFrag = makeStoredFragment(1, 500, 0.04, { oreE: 1.0 }); // 500kg mass, 100kg oreE
    const barrenFrag = makeStoredFragment(2, 300, 0.02, {}); // 300kg mass, no ore
    putInStorage(state, oreFrag);
    putInStorage(state, barrenFrag);
    const collectedOre: Record<string, number> = { oreE: 100 };

    // 300kg — exactly the barren fragment's own mass, so barren stock alone
    // covers it and the ore-bearing fragment is never reached.
    const result = consumeStoredOre(state, collectedOre, '', 300);

    expect(result.success).toBe(true);
    expect(result.consumedKg).toBe(300);
    // The barren fragment alone covered the request — ore-bearing stock is
    // untouched, so collectedOre stays exactly as it was.
    expect(collectedOre.oreE).toBe(100);
    expect(state.storedMassKg).toBe(500);
    // The ore-bearing fragment survives whole.
    const oreTracked = state.fragments.find(f => f.fragment.id === 1);
    expect(oreTracked).toBeDefined();
    expect(oreTracked!.fragment.mass).toBe(500);
    expect(getFragmentCounts(state).stored).toBe(1);
  });

  it('rubble (materialId "") reaches into ore-bearing fragments once barren stock runs out, splitting them and decrementing collectedOre for the ore it removes', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    const oreFrag = makeStoredFragment(1, 500, 0.04, { oreE: 1.0 }); // 500kg mass, 100kg oreE
    const barrenFrag = makeStoredFragment(2, 300, 0.02, {}); // 300kg mass, no ore
    putInStorage(state, oreFrag);
    putInStorage(state, barrenFrag);
    const collectedOre: Record<string, number> = { oreE: 100 };

    // Barren stock (300kg) alone can't cover this — the remaining 200kg comes
    // out of the ore-bearing fragment, split rather than scrapped whole
    // (#973), and the ore that leaves with it is struck off collectedOre so
    // the ledger can't overstate what is physically in storage (#959).
    const result = consumeStoredOre(state, collectedOre, '', 500);

    expect(result.success).toBe(true);
    expect(result.consumedKg).toBe(500);
    // 200kg of the ore fragment's 500kg left storage — 40% of its 100kg oreE.
    expect(collectedOre.oreE).toBeCloseTo(60, 9);
    expect(state.storedMassKg).toBe(300);
    const remainder = state.fragments.find(f => f.fragment.id === 1);
    expect(remainder).toBeDefined();
    expect(remainder!.state).toBe('stored');
    expect(remainder!.fragment.mass).toBe(300);
    expect(state.fragments.find(f => f.fragment.id === 2)).toBeUndefined();
    expect(getFragmentCounts(state).stored).toBe(1);
  });

  it('rubble: two sequential small deliveries against a single oversized fragment both succeed via partial splits (issue #973 regression)', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    // Mirrors the actual reported bug shape: a single large stored fragment,
    // then a 100kg delivery followed by a 40kg delivery one step later.
    const frag = makeStoredFragment(1, 795.75, 0.3183, {}); // barren — disposal reaches for waste first
    putInStorage(state, frag);
    const collectedOre: Record<string, number> = {};

    const first = consumeStoredOre(state, collectedOre, '', 100);
    expect(first.success).toBe(true);
    expect(first.consumedKg).toBe(100);
    expect(state.storedMassKg).toBe(695.75);
    let tracked = state.fragments.find(f => f.fragment.id === 1);
    expect(tracked).toBeDefined();
    expect(tracked!.state).toBe('stored');
    expect(tracked!.fragment.mass).toBe(695.75);

    const second = consumeStoredOre(state, collectedOre, '', 40);
    expect(second.success).toBe(true);
    expect(second.consumedKg).toBe(40);
    expect(state.storedMassKg).toBe(655.75);
    tracked = state.fragments.find(f => f.fragment.id === 1);
    expect(tracked).toBeDefined();
    expect(tracked!.state).toBe('stored');
    expect(tracked!.fragment.mass).toBe(655.75);
    expect(getFragmentCounts(state).stored).toBe(1);
  });

  it('rubble: a request within FRAGMENT_SPLIT_EPSILON_KG of a fragment\'s full mass fully removes it instead of leaving a near-zero sliver', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    const oldest = makeStoredFragment(1, 400, 0.16, {});
    const newer = makeStoredFragment(2, 300, 0.12, {});
    putInStorage(state, oldest);
    putInStorage(state, newer);
    const collectedOre: Record<string, number> = {};

    // Just under the oldest fragment's exact mass — close enough that a
    // strict split would leave a sub-epsilon sliver instead of fully
    // removing the fragment.
    const requested = 400 - FRAGMENT_SPLIT_EPSILON_KG / 2;
    const result = consumeStoredOre(state, collectedOre, '', requested);

    expect(result.success).toBe(true);
    expect(result.consumedKg).toBeCloseTo(requested, 9);
    // The oldest fragment is fully removed — no sliver left behind.
    expect(getFragmentCounts(state).stored).toBe(1);
    expect(state.fragments.find(f => f.fragment.id === 1)).toBeUndefined();
    // The newer fragment is completely untouched.
    const untouched = state.fragments.find(f => f.fragment.id === 2);
    expect(untouched).toBeDefined();
    expect(untouched!.fragment.mass).toBe(300);
    // storedMassKg lands exactly on the remaining fragment's mass — not
    // 300 + a sub-epsilon leftover from the oldest.
    expect(state.storedMassKg).toBe(300);
  });

  it('rubble: a request spanning two fragments fully consumes the oldest and partially splits the next', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    const oldest = makeStoredFragment(1, 400, 0.16, {});
    const newer = makeStoredFragment(2, 300, 0.12, {});
    putInStorage(state, oldest);
    putInStorage(state, newer);
    const collectedOre: Record<string, number> = {};

    // 500kg: more than the oldest fragment's 400kg alone, less than the
    // combined 700kg — must fully consume the oldest and partially split
    // 100kg off the newer, leaving its 200kg remainder in storage.
    const result = consumeStoredOre(state, collectedOre, '', 500);

    expect(result.success).toBe(true);
    expect(result.consumedKg).toBe(500);
    expect(state.fragments.find(f => f.fragment.id === 1)).toBeUndefined();
    const remainder = state.fragments.find(f => f.fragment.id === 2);
    expect(remainder).toBeDefined();
    expect(remainder!.state).toBe('stored');
    expect(remainder!.fragment.mass).toBe(200);
    expect(getFragmentCounts(state).stored).toBe(1);
    expect(state.storedMassKg).toBe(200);
  });

  it('rubble: a partial split of an ore-bearing fragment decrements collectedOre by the ore that physically left storage', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    // The only stored fragment carries real ore, so disposal has no barren
    // stock to prefer and must split this one.
    const frag = makeStoredFragment(1, 500, 0.04, { oreX: 1.0 }); // 100kg oreX
    putInStorage(state, frag);
    const collectedOre: Record<string, number> = { oreX: 100 };

    const result = consumeStoredOre(state, collectedOre, '', 200);

    expect(result.success).toBe(true);
    expect(result.consumedKg).toBe(200);
    // 200kg of 500kg left storage — with it, 40% of the fragment's oreX.
    expect(collectedOre.oreX).toBeCloseTo(60, 9);
    const tracked = state.fragments.find(f => f.fragment.id === 1);
    expect(tracked).toBeDefined();
    expect(tracked!.fragment.mass).toBe(300);
    expect(state.storedMassKg).toBe(300);
    expect(getFragmentCounts(state).stored).toBe(1);
  });

  it('rubble boundary: requesting exactly the stored mass succeeds and empties storage', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    const frag = makeStoredFragment(1, 400, 0.03, {});
    putInStorage(state, frag);
    const collectedOre: Record<string, number> = {};

    const result = consumeStoredOre(state, collectedOre, '', 400);

    expect(result.success).toBe(true);
    expect(result.consumedKg).toBe(400);
    expect(state.storedMassKg).toBe(0);
    expect(getFragmentCounts(state).stored).toBe(0);
  });

  it('rubble insufficient stock fails without touching storedMassKg', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    const frag = makeStoredFragment(1, 200, 0.02, {});
    putInStorage(state, frag);
    const collectedOre: Record<string, number> = {};

    const result = consumeStoredOre(state, collectedOre, '', 500);

    expect(result.success).toBe(false);
    expect(result.consumedKg).toBe(0);
    expect(result.error).toBeDefined();
    expect(state.storedMassKg).toBe(200);
  });

  it('rejects a non-finite amount (NaN), leaving state and collectedOre untouched', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    const frag = makeStoredFragment(1, 500, 0.04, { oreH: 1.0 }); // 100kg oreH
    putInStorage(state, frag);
    const collectedOre: Record<string, number> = { oreH: 100 };
    const collectedOreBefore = { ...collectedOre };
    const storedMassBefore = state.storedMassKg;

    const result = consumeStoredOre(state, collectedOre, 'oreH', NaN);

    expect(result.success).toBe(false);
    expect(result.consumedKg).toBe(0);
    expect(result.error).toBeDefined();
    expect(result.error!.length).toBeGreaterThan(0);
    expect(collectedOre).toEqual(collectedOreBefore);
    expect(state.storedMassKg).toBe(storedMassBefore);
    expect(getFragmentCounts(state).stored).toBe(1);
  });

  it('rejects a non-finite amount (Infinity), leaving state and collectedOre untouched', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    const frag = makeStoredFragment(1, 500, 0.04, { oreI: 1.0 }); // 100kg oreI
    putInStorage(state, frag);
    const collectedOre: Record<string, number> = { oreI: 100 };
    const collectedOreBefore = { ...collectedOre };
    const storedMassBefore = state.storedMassKg;

    const result = consumeStoredOre(state, collectedOre, 'oreI', Infinity);

    expect(result.success).toBe(false);
    expect(result.consumedKg).toBe(0);
    expect(result.error).toBeDefined();
    expect(result.error!.length).toBeGreaterThan(0);
    expect(collectedOre).toEqual(collectedOreBefore);
    expect(state.storedMassKg).toBe(storedMassBefore);
    expect(getFragmentCounts(state).stored).toBe(1);
  });

  it('multi-ore fragment: consuming one ore type leaves every other ore untouched', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    // volume 0.06 × 0.5 density × 2500 = 75kg for each of oreF and oreG.
    const frag = makeStoredFragment(1, 700, 0.06, { oreF: 0.5, oreG: 0.5 });
    putInStorage(state, frag);
    const collectedOre: Record<string, number> = { oreF: 75, oreG: 75 };

    const result = consumeStoredOre(state, collectedOre, 'oreF', 75);

    expect(result.success).toBe(true);
    expect(result.consumedKg).toBe(75);
    // The requested ore type is decremented...
    expect(collectedOre.oreF).toBe(0);
    // ...while the other ore type on the same fragment keeps its exact kg.
    expect(collectedOre.oreG).toBe(75);
    // Storage mass drops only by the sold ore's share (half the volume is oreF).
    expect(state.storedMassKg).toBe(350);
  });

  it('multi-ore fragment: a request smaller than the fragment\'s ore content partially splits it, decrementing only the requested ore', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    // volume 0.06 × 0.5 density × 2500 = 75kg for each of oreF and oreG.
    const frag = makeStoredFragment(1, 700, 0.06, { oreF: 0.5, oreG: 0.5 });
    putInStorage(state, frag);
    const collectedOre: Record<string, number> = { oreF: 75, oreG: 75 };

    // 30kg < the fragment's 75kg of oreF — only the sold ore is removed.
    const result = consumeStoredOre(state, collectedOre, 'oreF', 30);

    expect(result.success).toBe(true);
    expect(result.consumedKg).toBe(30);
    // The requested ore type is decremented by exactly the requested amount...
    expect(collectedOre.oreF).toBe(45);
    // ...and the other ore type on the same fragment keeps its exact kg.
    expect(collectedOre.oreG).toBe(75);
    // Storage mass drops only by the sold ore's share: 30/75 of oreF's half.
    expect(state.storedMassKg).toBe(560);
    const tracked = state.fragments.find(f => f.fragment.id === 1);
    expect(tracked).toBeDefined();
    expect(tracked!.state).toBe('stored');
    expect(tracked!.fragment.mass).toBe(560);
    expect(tracked!.fragment.volume).toBeCloseTo(0.048, 9);
    expect(getFragmentCounts(state).stored).toBe(1);
  });
});

// ── splitStoredFragmentMass ─────────────────────────────────────────────────

describe('splitStoredFragmentMass', () => {
  it('removes the requested mass from a stored fragment, returning its own mass/volume/oreDensities and leaving the remainder stored', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    const frag = makeStoredFragment(1, 1000, 0.4, { oreJ: 0.6 });
    putInStorage(state, frag);

    const removed = splitStoredFragmentMass(state, 1, 400);

    expect(removed).not.toBeNull();
    expect(removed!.mass).toBe(400);
    expect(removed!.volume).toBeCloseTo(0.16, 9);
    expect(removed!.oreDensities).toEqual({ oreJ: 0.6 });

    const tracked = state.fragments.find(f => f.fragment.id === 1);
    expect(tracked).toBeDefined();
    expect(tracked!.state).toBe('stored');
    expect(tracked!.fragment.mass).toBe(600);
    expect(tracked!.fragment.volume).toBeCloseTo(0.24, 9);
    expect(state.storedMassKg).toBe(600);
  });

  it('scales the remaining fragment\'s halfExtents down by cbrt(1 - fraction removed)', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    // makeStoredFragment fixes halfExtents at {x:0.5, y:0.5, z:0.5}.
    const frag = makeStoredFragment(1, 1000, 0.4, {});
    putInStorage(state, frag);

    splitStoredFragmentMass(state, 1, 400); // removes 40% of the mass

    const tracked = state.fragments.find(f => f.fragment.id === 1)!;
    const scale = Math.cbrt(1 - 400 / 1000); // remaining fraction = 0.6
    expect(tracked.fragment.halfExtents.x).toBeCloseTo(0.5 * scale, 9);
    expect(tracked.fragment.halfExtents.y).toBeCloseTo(0.5 * scale, 9);
    expect(tracked.fragment.halfExtents.z).toBeCloseTo(0.5 * scale, 9);
  });

  it('returns null when the fragment id does not exist in storage', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    const frag = makeStoredFragment(1, 500, 0.2, {});
    putInStorage(state, frag);

    const removed = splitStoredFragmentMass(state, 999, 100);

    expect(removed).toBeNull();
    expect(state.storedMassKg).toBe(500);
  });

  it('returns null when the fragment exists but is not in the stored state (e.g. on_ground)', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    addBlastFragments(state, [makeFragment(1, 500)]); // on_ground, never picked up

    const removed = splitStoredFragmentMass(state, 1, 100);

    expect(removed).toBeNull();
    expect(state.storedMassKg).toBe(0);
  });

  it('returns null when massToRemoveKg equals the fragment\'s full mass (use sellFragment to remove it whole)', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    const frag = makeStoredFragment(1, 500, 0.2, {});
    putInStorage(state, frag);

    const removed = splitStoredFragmentMass(state, 1, 500);

    expect(removed).toBeNull();
    expect(state.storedMassKg).toBe(500);
    expect(getFragmentCounts(state).stored).toBe(1);
  });

  it('returns null when massToRemoveKg is zero or negative', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    const frag = makeStoredFragment(1, 500, 0.2, {});
    putInStorage(state, frag);

    expect(splitStoredFragmentMass(state, 1, 0)).toBeNull();
    expect(splitStoredFragmentMass(state, 1, -50)).toBeNull();
    expect(state.storedMassKg).toBe(500);
    expect(getFragmentCounts(state).stored).toBe(1);
  });
});

// ── returnFragmentToGround (#974) ────────────────────────────────────────────
// Inverse of pickupFragment — used when a vehicle's haul is aborted mid-flight
// (forced rest, cancellation, driver death) so cargo already picked up isn't
// permanently lost.

describe('returnFragmentToGround', () => {
  it('flips an in_transit fragment back to on_ground, clearing its vehicle association', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    addBlastFragments(state, [makeFragment(1, 100)]);
    pickupFragment(state, 1, 'truck-01', siteOf(state), 0, 0);
    const before = state.fragments.find(f => f.fragment.id === 1)!;
    expect(before.state).toBe('in_transit');
    expect(before.vehicleId).toBe('truck-01');

    const ok = returnFragmentToGround(state, 1);

    expect(ok).toBe(true);
    const after = state.fragments.find(f => f.fragment.id === 1)!;
    expect(after.state).toBe('on_ground');
    expect(after.vehicleId).toBeNull();
  });

  it('returns false and mutates nothing when the fragment is already on_ground (no matching in_transit fragment)', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    addBlastFragments(state, [makeFragment(1, 100)]); // never picked up

    const ok = returnFragmentToGround(state, 1);

    expect(ok).toBe(false);
    const tracked = state.fragments.find(f => f.fragment.id === 1)!;
    expect(tracked.state).toBe('on_ground');
    expect(tracked.vehicleId).toBeNull();
  });

  it('returns false and mutates nothing for a nonexistent fragment id', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    addBlastFragments(state, [makeFragment(1, 100)]);
    pickupFragment(state, 1, 'truck-01', siteOf(state), 0, 0);

    const ok = returnFragmentToGround(state, 999);

    expect(ok).toBe(false);
    const tracked = state.fragments.find(f => f.fragment.id === 1)!;
    expect(tracked.state).toBe('in_transit');
    expect(getFragmentCounts(state).total).toBe(1);
  });

  it('when a navGrid is provided, re-registers the fragment as a nav-grid occupant at its recorded position', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    const navGrid = makeTestNavGrid(5, 5);
    addBlastFragments(state, [makeFragment(1, 100)], navGrid); // registers occupancy at (0,0)
    expect(navGrid.cellAt(0, 0)!.fragmentOccupancy).toBe(1);
    pickupFragment(state, 1, 'truck-01', siteOf(state), 0, 0);
    navGrid.removeFragmentOccupant(0, 0); // mirrors what the real haul pickup path does
    expect(navGrid.cellAt(0, 0)!.fragmentOccupancy).toBe(0);

    const ok = returnFragmentToGround(state, 1, navGrid);

    expect(ok).toBe(true);
    expect(navGrid.cellAt(0, 0)!.fragmentOccupancy).toBe(1);
  });

  it('succeeds without throwing when navGrid is omitted', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    addBlastFragments(state, [makeFragment(1, 100)]);
    pickupFragment(state, 1, 'truck-01', siteOf(state), 0, 0);

    let ok = false;
    expect(() => { ok = returnFragmentToGround(state, 1); }).not.toThrow();
    expect(ok).toBe(true);
    const tracked = state.fragments.find(f => f.fragment.id === 1)!;
    expect(tracked.state).toBe('on_ground');
  });

  it('when dropPosition is provided, relocates the fragment there instead of leaving it at its stale pre-pickup position (#974)', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    // Fragment's ORIGINAL recorded position (where the blast placed it).
    addBlastFragments(state, [makeFragment(1, 100)]); // position: {x: 0, y: 0, z: 0}
    pickupFragment(state, 1, 'truck-01', siteOf(state), 0, 0);

    // Vehicle's CURRENT position, partway through its 'to_depot' leg —
    // clearly different from the fragment's original position.
    const dropPosition = { x: 50, y: 0, z: 30 };
    const ok = returnFragmentToGround(state, 1, undefined, dropPosition);

    expect(ok).toBe(true);
    const tracked = state.fragments.find(f => f.fragment.id === 1)!;
    expect(tracked.fragment.position).toEqual(dropPosition);
    expect(tracked.fragment.position).not.toEqual({ x: 0, y: 0, z: 0 });
  });

  it('when dropPosition is omitted, the fragment reverts to its own already-recorded position', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    addBlastFragments(state, [makeFragment(1, 100)]); // position: {x: 0, y: 0, z: 0}
    pickupFragment(state, 1, 'truck-01', siteOf(state), 0, 0);

    const ok = returnFragmentToGround(state, 1);

    expect(ok).toBe(true);
    const tracked = state.fragments.find(f => f.fragment.id === 1)!;
    expect(tracked.fragment.position).toEqual({ x: 0, y: 0, z: 0 });
  });
});

// ── #1369: initial capacity and free room ──
describe('initial storage capacity (#1369)', () => {
  it('INITIAL_STORAGE_CAPACITY_KG is 0', () => {
    expect(INITIAL_STORAGE_CAPACITY_KG).toBe(0);
  });

  it('createLogisticsState() defaults to zero capacity', () => {
    expect(createLogisticsState().storageCapacityKg).toBe(0);
  });

  it('createLogisticsState(n) honours an explicit capacity', () => {
    expect(createLogisticsState(750).storageCapacityKg).toBe(750);
  });

  it('createGame starts with zero logistics capacity', () => {
    expect(createGame({ seed: 42 }).logistics.storageCapacityKg).toBe(0);
  });
});

describe('storageRoomKg (#1369)', () => {
  it('is capacity minus stored mass', () => {
    const s = createLogisticsState(1000);
    s.storedMassKg = 300;
    expect(storageRoomKg(s)).toBe(700);
  });

  it('is zero for a fresh default state', () => {
    expect(storageRoomKg(createLogisticsState())).toBe(0);
  });

  it('is zero when exactly full', () => {
    const s = createLogisticsState(500);
    s.storedMassKg = 500;
    expect(storageRoomKg(s)).toBe(0);
  });
});

// ── #1370: several fragments in transit at once ──
describe('inTransitMassKg (#1370)', () => {
  it('is zero when nothing is in transit', () => {
    const s = createLogisticsState(TEST_STORAGE_KG);
    addBlastFragments(s, [makeFragment(1, 300)]);
    expect(inTransitMassKg(s)).toBe(0);
  });

  it('is zero for an empty state', () => {
    expect(inTransitMassKg(createLogisticsState(TEST_STORAGE_KG))).toBe(0);
  });

  it('sums the mass of every in_transit fragment and ignores ground and stored ones', () => {
    const s = createLogisticsState(TEST_STORAGE_KG);
    addBlastFragments(s, [makeFragment(1, 300), makeFragment(2, 450), makeFragment(3, 1000), makeFragment(4, 70)]);
    expect(pickupFragment(s, 1, '7', siteOf(s), 0, 0)).toBe(true);
    expect(pickupFragment(s, 2, '7', siteOf(s), 0, 0)).toBe(true);
    expect(pickupFragment(s, 3, '8', siteOf(s), 0, 0)).toBe(true);
    deliverToDepot(s, 3, undefined, siteOf(s), 0, 0);
    expect(inTransitMassKg(s)).toBe(750);
  });

  it('drops back after a fragment is returned to the ground', () => {
    const s = createLogisticsState(TEST_STORAGE_KG);
    addBlastFragments(s, [makeFragment(1, 300), makeFragment(2, 450)]);
    pickupFragment(s, 1, '7', siteOf(s), 0, 0);
    pickupFragment(s, 2, '7', siteOf(s), 0, 0);
    returnFragmentToGround(s, 2);
    expect(inTransitMassKg(s)).toBe(300);
  });
});

describe('pickupFragment counts mass already in transit against capacity (#1370)', () => {
  it('refuses a pickup when stored + in-transit + mass exceeds capacity', () => {
    const s = createLogisticsState(1000);
    addBlastFragments(s, [makeFragment(1, 600), makeFragment(2, 600)]);
    expect(pickupFragment(s, 1, '7', siteOf(s), 0, 0)).toBe(true);
    expect(pickupFragment(s, 2, '7', siteOf(s), 0, 0)).toBe(false);
    expect(s.fragments.find(f => f.fragment.id === 2)!.state).toBe('on_ground');
  });

  it('accepts a pickup that exactly fills capacity with stored + in-transit mass', () => {
    const s = createLogisticsState(1000);
    putInStorage(s, makeFragment(90, 200));
    addBlastFragments(s, [makeFragment(1, 300), makeFragment(2, 500)]);
    expect(pickupFragment(s, 1, '7', siteOf(s), 0, 0)).toBe(true);
    expect(pickupFragment(s, 2, '7', siteOf(s), 0, 0)).toBe(true);
    expect(pickupFragment(s, 1, '7', siteOf(s), 0, 0)).toBe(false); // already in transit: not on the ground
  });

  it('refuses a pickup one kg over when stored and in-transit mass together are counted', () => {
    const s = createLogisticsState(1000);
    putInStorage(s, makeFragment(90, 200));
    addBlastFragments(s, [makeFragment(1, 300), makeFragment(2, 501)]);
    expect(pickupFragment(s, 1, '7', siteOf(s), 0, 0)).toBe(true);
    expect(pickupFragment(s, 2, '7', siteOf(s), 0, 0)).toBe(false);
  });
});

// ── ore sale keeps the other ores (#1371) ────────────────────────────────────

/** Ore kg of one ore carried by one fragment: volume x density x ORE_DENSITY_KG_M3. */
function oreKgIn(f: FragmentData, oreId: string): number {
  return f.volume * (f.oreDensities[oreId] ?? 0) * ORE_DENSITY_KG_M3;
}

/** Ore kg of one ore summed over every stored fragment. */
function storedOreKg(state: LogisticsState, oreId: string): number {
  return state.fragments
    .filter(f => f.state === 'stored')
    .reduce((sum, f) => sum + oreKgIn(f.fragment, oreId), 0);
}

function storedMassSum(state: LogisticsState): number {
  return state.fragments.filter(f => f.state === 'stored').reduce((sum, f) => sum + f.fragment.mass, 0);
}

/** Mixed fragment 1 (400kg rustite + 400kg dirtite, 1000kg) and pure dirtite fragment 2 (400kg, 500kg). */
function mixedStorage(): { state: LogisticsState; collectedOre: Record<string, number> } {
  const state = createLogisticsState(TEST_STORAGE_KG);
  putInStorage(state, makeStoredFragment(1, 1000, 0.32, { rustite: 0.5, dirtite: 0.5 }));
  putInStorage(state, makeStoredFragment(2, 500, 0.16, { dirtite: 1.0 }));
  return { state, collectedOre: { rustite: 400, dirtite: 800 } };
}

describe('consumeStoredOre keeps the other ores of a mixed fragment (#1371)', () => {
  it('repro: selling all rustite leaves the 800kg of dirtite in the ledger and in storage', () => {
    const { state, collectedOre } = mixedStorage();

    const result = consumeStoredOre(state, collectedOre, 'rustite', 400);

    expect(result.success).toBe(true);
    expect(result.consumedKg).toBeCloseTo(400, 6);
    expect(collectedOre.rustite).toBeCloseTo(0, 6);
    expect(collectedOre.dirtite).toBeCloseTo(800, 6);
    expect(storedOreKg(state, 'dirtite')).toBeCloseTo(800, 6);
    expect(storedOreKg(state, 'rustite')).toBeCloseTo(0, 6);
    // Rustite's share of fragment 1 (half its 1000kg) left; the rest stays.
    expect(state.storedMassKg).toBeCloseTo(1000, 6);
    expect(state.fragments.some(f => f.state === 'stored' && oreKgIn(f.fragment, 'dirtite') > 0)).toBe(true);
  });

  it('a single mixed fragment: selling ore A leaves ore B kg unchanged', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    const frag = makeStoredFragment(1, 1000, 0.32, { oreA: 0.5, oreB: 0.5 });
    putInStorage(state, frag);
    const bBefore = oreKgIn(frag, 'oreB');
    const collectedOre: Record<string, number> = { oreA: 400, oreB: 400 };

    const result = consumeStoredOre(state, collectedOre, 'oreA', 400);

    expect(result.success).toBe(true);
    expect(oreKgIn(frag, 'oreB')).toBeCloseTo(bBefore, 6);
    expect(collectedOre.oreB).toBeCloseTo(400, 6);
    expect(collectedOre.oreA).toBeCloseTo(0, 6);
  });

  it('partial slice of A halves A, leaves B untouched and removes mass * d_A * 0.5', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    const frag = makeStoredFragment(1, 1000, 0.32, { oreA: 0.5, oreB: 0.5 });
    putInStorage(state, frag);
    const collectedOre: Record<string, number> = { oreA: 400, oreB: 400 };

    const result = consumeStoredOre(state, collectedOre, 'oreA', 200);

    expect(result.success).toBe(true);
    expect(result.consumedKg).toBeCloseTo(200, 6);
    expect(oreKgIn(frag, 'oreA')).toBeCloseTo(200, 6);
    expect(oreKgIn(frag, 'oreB')).toBeCloseTo(400, 6);
    expect(collectedOre.oreA).toBeCloseTo(200, 6);
    expect(collectedOre.oreB).toBeCloseTo(400, 6);
    expect(state.storedMassKg).toBeCloseTo(1000 - 1000 * 0.5 * 0.5, 6);
    expect(frag.mass).toBeCloseTo(750, 6);
  });

  it('keeps collectedOre and storedMassKg equal to the sums over stored fragments after sequential sales', () => {
    const { state, collectedOre } = mixedStorage();

    consumeStoredOre(state, collectedOre, 'rustite', 150);
    consumeStoredOre(state, collectedOre, 'dirtite', 300);
    consumeStoredOre(state, collectedOre, 'rustite', 100);

    for (const oreId of ['rustite', 'dirtite']) {
      expect(collectedOre[oreId]).toBeCloseTo(storedOreKg(state, oreId), 6);
    }
    expect(collectedOre.rustite).toBeCloseTo(150, 6);
    expect(collectedOre.dirtite).toBeCloseTo(500, 6);
    expect(state.storedMassKg).toBeCloseTo(storedMassSum(state), 6);
  });

  it('selling all dirtite removes pure-dirtite fragment 2 and leaves fragment 1 holding only rustite', () => {
    const { state, collectedOre } = mixedStorage();

    const result = consumeStoredOre(state, collectedOre, 'dirtite', 400 - FRAGMENT_SPLIT_EPSILON_KG / 2 + 400);

    expect(result.success).toBe(true);
    // Fragment 2 is pure dirtite and fully consumed: it must be gone.
    expect(state.fragments.find(f => f.fragment.id === 2)).toBeUndefined();
    const frag1 = state.fragments.find(f => f.fragment.id === 1)!.fragment;
    expect(Object.keys(frag1.oreDensities)).toEqual(['rustite']);
    expect(oreKgIn(frag1, 'rustite')).toBeCloseTo(400, 6);
    expect(state.storedMassKg).toBeCloseTo(storedMassSum(state), 6);
    expect(collectedOre.dirtite).toBeCloseTo(storedOreKg(state, 'dirtite'), 6);
  });

  it('a barren leftover fragment stays in storage and rubble_disposal can consume it', () => {
    const state = createLogisticsState(TEST_STORAGE_KG);
    putInStorage(state, makeStoredFragment(1, 1000, 0.32, { oreA: 0.5 }));
    const collectedOre: Record<string, number> = { oreA: 400 };

    const sale = consumeStoredOre(state, collectedOre, 'oreA', 400);
    expect(sale.success).toBe(true);
    expect(collectedOre.oreA).toBeCloseTo(0, 6);
    // The barren half (500kg of gangue) is still stored.
    expect(state.storedMassKg).toBeCloseTo(500, 6);
    expect(getFragmentCounts(state).stored).toBe(1);

    const rubble = consumeStoredOre(state, collectedOre, '', 500);
    expect(rubble.success).toBe(true);
    expect(rubble.consumedKg).toBeCloseTo(500, 6);
    expect(state.storedMassKg).toBeCloseTo(0, 6);
  });

  it('insufficient stock, NaN and non-positive amounts are still refused without touching state', () => {
    const { state, collectedOre } = mixedStorage();

    expect(consumeStoredOre(state, collectedOre, 'rustite', 401).success).toBe(false);
    expect(consumeStoredOre(state, collectedOre, 'rustite', NaN).success).toBe(false);
    expect(consumeStoredOre(state, collectedOre, 'rustite', -5).success).toBe(false);
    expect(consumeStoredOre(state, collectedOre, '', 99999).success).toBe(false);
    expect(collectedOre).toEqual({ rustite: 400, dirtite: 800 });
    expect(state.storedMassKg).toBe(1500);
  });
});

describe('extractOreFromFragment (#1371)', () => {
  it('removes only the requested ore, returning ore kg, mass and volume taken', () => {
    const { state } = mixedStorage();

    const out = extractOreFromFragment(state, 1, 'rustite', 400);

    expect(out).not.toBeNull();
    expect(out!.oreKg).toBeCloseTo(400, 6);
    expect(out!.mass).toBeCloseTo(500, 6);
    expect(out!.volume).toBeCloseTo(0.16, 6);
    const frag = state.fragments.find(f => f.fragment.id === 1)!.fragment;
    expect(oreKgIn(frag, 'rustite')).toBeCloseTo(0, 6);
    expect(oreKgIn(frag, 'dirtite')).toBeCloseTo(400, 6);
    expect(state.storedMassKg).toBeCloseTo(1000, 6);
  });

  it('removes a fully sold pure-ore fragment', () => {
    const { state } = mixedStorage();

    const out = extractOreFromFragment(state, 2, 'dirtite', 400);

    expect(out).not.toBeNull();
    expect(out!.mass).toBeCloseTo(500, 6);
    expect(state.fragments.find(f => f.fragment.id === 2)).toBeUndefined();
    expect(state.storedMassKg).toBeCloseTo(1000, 6);
  });

  it('clamps to the full contribution when oreKg exceeds it', () => {
    const { state } = mixedStorage();

    const out = extractOreFromFragment(state, 1, 'rustite', 5000);

    expect(out).not.toBeNull();
    expect(out!.oreKg).toBeCloseTo(400, 6);
    expect(out!.mass).toBeCloseTo(500, 6);
    const frag = state.fragments.find(f => f.fragment.id === 1)!.fragment;
    expect(oreKgIn(frag, 'rustite')).toBeCloseTo(0, 6);
    expect(oreKgIn(frag, 'dirtite')).toBeCloseTo(400, 6);
  });

  it('shrinks halfExtents by the cube root of the remaining volume ratio', () => {
    const { state } = mixedStorage();

    extractOreFromFragment(state, 1, 'rustite', 400);

    const frag = state.fragments.find(f => f.fragment.id === 1)!.fragment;
    const expected = 0.5 * Math.cbrt(0.16 / 0.32);
    expect(frag.halfExtents.x).toBeCloseTo(expected, 6);
    expect(frag.halfExtents.y).toBeCloseTo(expected, 6);
    expect(frag.halfExtents.z).toBeCloseTo(expected, 6);
  });

  it('returns null for an unknown fragment, a fragment not in storage, or an absent ore', () => {
    const { state } = mixedStorage();
    addBlastFragments(state, [makeFragment(9, 100)]);

    expect(extractOreFromFragment(state, 999, 'rustite', 10)).toBeNull();
    expect(extractOreFromFragment(state, 9, 'dirtite', 10)).toBeNull();
    expect(extractOreFromFragment(state, 2, 'rustite', 10)).toBeNull();
    expect(state.storedMassKg).toBe(1500);
  });

  it('returns null for NaN, infinite, zero or negative kg', () => {
    const { state } = mixedStorage();

    expect(extractOreFromFragment(state, 1, 'rustite', NaN)).toBeNull();
    expect(extractOreFromFragment(state, 1, 'rustite', Infinity)).toBeNull();
    expect(extractOreFromFragment(state, 1, 'rustite', 0)).toBeNull();
    expect(extractOreFromFragment(state, 1, 'rustite', -1)).toBeNull();
    expect(state.storedMassKg).toBe(1500);
  });
});
