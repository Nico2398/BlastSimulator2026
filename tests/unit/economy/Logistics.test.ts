import { describe, it, expect } from 'vitest';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import {
  createLogisticsState,
  addBlastFragments,
  pickupFragment,
  deliverToDepot,
  sellFragment,
  getFragmentCounts,
  consumeStoredOre,
  type LogisticsState,
} from '../../../src/core/economy/Logistics.js';

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
  };
}

/** Push a fragment directly into storage (bypassing pickup/deliver) for consumeStoredOre setup. */
function putInStorage(state: LogisticsState, fragment: FragmentData): void {
  state.fragments.push({ fragment, state: 'stored', vehicleId: null });
  state.storedMassKg += fragment.mass;
}

describe('Fragment logistics', () => {
  it('after blast, fragments are in on_ground state', () => {
    const state = createLogisticsState();
    addBlastFragments(state, [makeFragment(1), makeFragment(2), makeFragment(3)]);

    const counts = getFragmentCounts(state);
    expect(counts.onGround).toBe(3);
    expect(counts.inTransit).toBe(0);
    expect(counts.stored).toBe(0);
  });

  it('pickupFragment moves fragment to in_transit', () => {
    const state = createLogisticsState();
    addBlastFragments(state, [makeFragment(1)]);

    const ok = pickupFragment(state, 1, 'truck-01');
    expect(ok).toBe(true);

    const counts = getFragmentCounts(state);
    expect(counts.onGround).toBe(0);
    expect(counts.inTransit).toBe(1);
  });

  it('delivering fragment to depot moves it to stored', () => {
    const state = createLogisticsState();
    addBlastFragments(state, [makeFragment(1, 50)]);
    pickupFragment(state, 1, 'truck-01');
    deliverToDepot(state, 1);

    const counts = getFragmentCounts(state);
    expect(counts.stored).toBe(1);
    expect(state.storedMassKg).toBe(50);
  });

  it('selling fragment against contract credits income and reduces quantity', () => {
    const state = createLogisticsState();
    addBlastFragments(state, [makeFragment(1, 200)]);
    pickupFragment(state, 1, 'truck-01');
    deliverToDepot(state, 1);

    const result = sellFragment(state, 1);
    expect(result).not.toBeNull();
    expect(result!.mass).toBe(200);
    expect(result!.oreDensities).toEqual({ dirtite: 0.3 });

    const counts = getFragmentCounts(state);
    expect(counts.total).toBe(0);
    expect(state.storedMassKg).toBe(0);
  });

  it('deliverToDepot without collectedOre works as before', () => {
    const state = createLogisticsState();
    addBlastFragments(state, [makeFragment(1, 100)]);
    pickupFragment(state, 1, 'truck-01');
    const result = deliverToDepot(state, 1);
    expect(result).toBe(true);
    const counts = getFragmentCounts(state);
    expect(counts.stored).toBe(1);
  });

  it('deliverToDepot with collectedOre accumulates ore mass correctly', () => {
    const state = createLogisticsState();
    addBlastFragments(state, [makeFragment(1, 100)]);
    pickupFragment(state, 1, 'truck-01');
    const collectedOre: Record<string, number> = {};
    deliverToDepot(state, 1, collectedOre);
    // fragment volume = 100/2.5 = 40, ore mass = 40 * 0.3 * 2500 = 30000 kg
    expect(collectedOre.dirtite).toBeCloseTo(30000);
  });

  it('deliverToDepot accumulates multiple fragments into collectedOre', () => {
    const state = createLogisticsState();
    addBlastFragments(state, [makeFragment(1, 100), makeFragment(2, 200)]);
    pickupFragment(state, 1, 'truck-01');
    pickupFragment(state, 2, 'truck-01');
    const collectedOre: Record<string, number> = {};
    deliverToDepot(state, 1, collectedOre);
    deliverToDepot(state, 2, collectedOre);
    // Fragment 1: 40*0.3*2500 = 30000, Fragment 2: 80*0.3*2500 = 60000, total = 90000
    expect(collectedOre.dirtite).toBeCloseTo(90000);
  });

  it('deliverToDepot adds to existing ore type in collectedOre', () => {
    const state = createLogisticsState();
    addBlastFragments(state, [makeFragment(1, 100)]);
    pickupFragment(state, 1, 'truck-01');
    const collectedOre: Record<string, number> = { existingOre: 50 };
    deliverToDepot(state, 1, collectedOre);
    // fragment volume = 40, ore mass = 40 * 0.3 * 2500 = 30000 kg
    expect(collectedOre.dirtite).toBeCloseTo(30000);
    expect(collectedOre.existingOre).toBe(50);
  });

  it('deliverToDepot returns false for missing fragment even with collectedOre', () => {
    const state = createLogisticsState();
    addBlastFragments(state, [makeFragment(1, 100)]);
    pickupFragment(state, 1, 'truck-01');
    const collectedOre: Record<string, number> = {};
    const result = deliverToDepot(state, 999, collectedOre);
    expect(result).toBe(false);
    expect(collectedOre).toEqual({});
  });

  it('no available storage → cannot pick up more fragments', () => {
    const state = createLogisticsState(150); // Only 150kg capacity
    addBlastFragments(state, [makeFragment(1, 100), makeFragment(2, 100)]);

    // First pickup succeeds
    const ok1 = pickupFragment(state, 1, 'truck-01');
    expect(ok1).toBe(true);
    deliverToDepot(state, 1);

    // Second pickup fails — would exceed capacity
    const ok2 = pickupFragment(state, 2, 'truck-01');
    expect(ok2).toBe(false);

    const counts = getFragmentCounts(state);
    expect(counts.onGround).toBe(1);
    expect(counts.stored).toBe(1);
  });
});

// ── consumeStoredOre ─────────────────────────────────────────────────────────

describe('consumeStoredOre', () => {
  it('happy path: consumes a stored fragment covering the requested ore amount', () => {
    const state = createLogisticsState();
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
    const state = createLogisticsState();
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
    const state = createLogisticsState();
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
    const state = createLogisticsState();
    const frag = makeStoredFragment(1, 500, 0.04, { oreD: 1.0 });
    putInStorage(state, frag);
    const collectedOre: Record<string, number> = {};

    const result = consumeStoredOre(state, collectedOre, 'unknownOre', 50);

    expect(result.success).toBe(false);
    expect(result.consumedKg).toBe(0);
    expect(result.error).toBeDefined();
    expect(state.storedMassKg).toBe(500);
  });

  it('rubble (materialId "") consumes raw stored mass regardless of ore content, ignoring collectedOre', () => {
    const state = createLogisticsState();
    // One ore-bearing fragment, one barren fragment — rubble disposal doesn't care.
    const oreFrag = makeStoredFragment(1, 500, 0.04, { oreE: 1.0 }); // 500kg mass, 100kg oreE
    const barrenFrag = makeStoredFragment(2, 300, 0.02, {}); // 300kg mass, no ore
    putInStorage(state, oreFrag);
    putInStorage(state, barrenFrag);
    const collectedOre: Record<string, number> = { oreE: 100 };
    const collectedOreBefore = { ...collectedOre };

    const result = consumeStoredOre(state, collectedOre, '', 300);

    expect(result.success).toBe(true);
    expect(result.consumedKg).toBeGreaterThan(0);
    // collectedOre must be completely untouched by a rubble disposal.
    expect(collectedOre).toEqual(collectedOreBefore);
    // Some physical mass was removed from storage.
    expect(state.storedMassKg).toBeLessThan(800);
  });

  it('rubble boundary: requesting exactly the stored mass succeeds and empties storage', () => {
    const state = createLogisticsState();
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
    const state = createLogisticsState();
    const frag = makeStoredFragment(1, 200, 0.02, {});
    putInStorage(state, frag);
    const collectedOre: Record<string, number> = {};

    const result = consumeStoredOre(state, collectedOre, '', 500);

    expect(result.success).toBe(false);
    expect(result.consumedKg).toBe(0);
    expect(result.error).toBeDefined();
    expect(state.storedMassKg).toBe(200);
  });

  it('multi-ore fragment: consuming one ore type also decrements every other ore the removed fragment touched', () => {
    const state = createLogisticsState();
    // volume 0.06 × 0.5 density × 2500 = 75kg for each of oreF and oreG.
    const frag = makeStoredFragment(1, 700, 0.06, { oreF: 0.5, oreG: 0.5 });
    putInStorage(state, frag);
    const collectedOre: Record<string, number> = { oreF: 75, oreG: 75 };

    const result = consumeStoredOre(state, collectedOre, 'oreF', 75);

    expect(result.success).toBe(true);
    expect(result.consumedKg).toBe(75);
    // The requested ore type is decremented...
    expect(collectedOre.oreF).toBe(0);
    // ...and so is the other ore type carried by the same (now-removed) fragment.
    expect(collectedOre.oreG).toBe(0);
    expect(state.storedMassKg).toBe(0);
    expect(getFragmentCounts(state).stored).toBe(0);
  });
});
