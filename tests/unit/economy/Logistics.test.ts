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
  splitStoredFragmentMass,
  type LogisticsState,
} from '../../../src/core/economy/Logistics.js';
import { FRAGMENT_SPLIT_EPSILON_KG } from '../../../src/core/config/balance.js';

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

    // 300kg < the oldest fragment's own 500kg — this must be a PARTIAL split
    // of the oldest fragment only, not a full sellFragment that destroys its
    // 200kg surplus (issue #973's bug: a small request used to consume an
    // entire oversized fragment).
    const result = consumeStoredOre(state, collectedOre, '', 300);

    expect(result.success).toBe(true);
    expect(result.consumedKg).toBe(300);
    // collectedOre must be completely untouched by a rubble disposal.
    expect(collectedOre).toEqual(collectedOreBefore);
    // Exactly 300kg removed overall...
    expect(state.storedMassKg).toBe(500);
    // ...taken entirely from the oldest fragment, which survives with its
    // 200kg surplus intact rather than being destroyed whole.
    const oldest = state.fragments.find(f => f.fragment.id === 1);
    expect(oldest).toBeDefined();
    expect(oldest!.state).toBe('stored');
    expect(oldest!.fragment.mass).toBe(200);
    // The newer fragment is completely untouched.
    const newer = state.fragments.find(f => f.fragment.id === 2);
    expect(newer).toBeDefined();
    expect(newer!.fragment.mass).toBe(300);
    // Nothing was fully removed — both fragments remain in storage.
    expect(getFragmentCounts(state).stored).toBe(2);
  });

  it('rubble: two sequential small deliveries against a single oversized fragment both succeed via partial splits (issue #973 regression)', () => {
    const state = createLogisticsState();
    // Mirrors the actual reported bug shape: a single large stored fragment,
    // then a 100kg delivery followed by a 40kg delivery one step later.
    const frag = makeStoredFragment(1, 795.75, 0.3183, {}); // barren — rubble ignores ore anyway
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
    const state = createLogisticsState();
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
    const state = createLogisticsState();
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

  it('rubble: a partial split leaves a fragment\'s ore content completely untouched', () => {
    const state = createLogisticsState();
    // Fragment carries real ore, but rubble disposal must ignore it entirely.
    const frag = makeStoredFragment(1, 500, 0.04, { oreX: 1.0 }); // 100kg oreX
    putInStorage(state, frag);
    const collectedOre: Record<string, number> = { oreX: 100 };
    const collectedOreBefore = { ...collectedOre };

    const result = consumeStoredOre(state, collectedOre, '', 200);

    expect(result.success).toBe(true);
    expect(result.consumedKg).toBe(200);
    // collectedOre is completely unaffected by a rubble request, partial or not.
    expect(collectedOre).toEqual(collectedOreBefore);
    const tracked = state.fragments.find(f => f.fragment.id === 1);
    expect(tracked).toBeDefined();
    expect(tracked!.fragment.mass).toBe(300);
    expect(state.storedMassKg).toBe(300);
    expect(getFragmentCounts(state).stored).toBe(1);
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

  it('rejects a non-finite amount (NaN), leaving state and collectedOre untouched', () => {
    const state = createLogisticsState();
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
    const state = createLogisticsState();
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

  it('multi-ore fragment: a request smaller than the fragment\'s ore content partially splits it, decrementing every ore key proportionally', () => {
    const state = createLogisticsState();
    // volume 0.06 × 0.5 density × 2500 = 75kg for each of oreF and oreG.
    const frag = makeStoredFragment(1, 700, 0.06, { oreF: 0.5, oreG: 0.5 });
    putInStorage(state, frag);
    const collectedOre: Record<string, number> = { oreF: 75, oreG: 75 };

    // 30kg < the fragment's 75kg of oreF — a partial split, removing 30/75 =
    // 40% of the fragment's mass/volume and the SAME 40% of every ore key it
    // carries, not just the requested one.
    const result = consumeStoredOre(state, collectedOre, 'oreF', 30);

    expect(result.success).toBe(true);
    expect(result.consumedKg).toBe(30);
    // The requested ore type is decremented by exactly the requested amount...
    expect(collectedOre.oreF).toBe(45);
    // ...and the other ore type on the same fragment drops by the same 40%
    // fraction, not zero and not left unchanged.
    expect(collectedOre.oreG).toBe(45);
    // The fragment survives in storage, reduced by the same 40%.
    expect(state.storedMassKg).toBe(420);
    const tracked = state.fragments.find(f => f.fragment.id === 1);
    expect(tracked).toBeDefined();
    expect(tracked!.state).toBe('stored');
    expect(tracked!.fragment.mass).toBe(420);
    expect(tracked!.fragment.volume).toBeCloseTo(0.036, 9);
    expect(getFragmentCounts(state).stored).toBe(1);
  });
});

// ── splitStoredFragmentMass ─────────────────────────────────────────────────

describe('splitStoredFragmentMass', () => {
  it('removes the requested mass from a stored fragment, returning its own mass/volume/oreDensities and leaving the remainder stored', () => {
    const state = createLogisticsState();
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
    const state = createLogisticsState();
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
    const state = createLogisticsState();
    const frag = makeStoredFragment(1, 500, 0.2, {});
    putInStorage(state, frag);

    const removed = splitStoredFragmentMass(state, 999, 100);

    expect(removed).toBeNull();
    expect(state.storedMassKg).toBe(500);
  });

  it('returns null when the fragment exists but is not in the stored state (e.g. on_ground)', () => {
    const state = createLogisticsState();
    addBlastFragments(state, [makeFragment(1, 500)]); // on_ground, never picked up

    const removed = splitStoredFragmentMass(state, 1, 100);

    expect(removed).toBeNull();
    expect(state.storedMassKg).toBe(0);
  });

  it('returns null when massToRemoveKg equals the fragment\'s full mass (use sellFragment to remove it whole)', () => {
    const state = createLogisticsState();
    const frag = makeStoredFragment(1, 500, 0.2, {});
    putInStorage(state, frag);

    const removed = splitStoredFragmentMass(state, 1, 500);

    expect(removed).toBeNull();
    expect(state.storedMassKg).toBe(500);
    expect(getFragmentCounts(state).stored).toBe(1);
  });

  it('returns null when massToRemoveKg is zero or negative', () => {
    const state = createLogisticsState();
    const frag = makeStoredFragment(1, 500, 0.2, {});
    putInStorage(state, frag);

    expect(splitStoredFragmentMass(state, 1, 0)).toBeNull();
    expect(splitStoredFragmentMass(state, 1, -50)).toBeNull();
    expect(state.storedMassKg).toBe(500);
    expect(getFragmentCounts(state).stored).toBe(1);
  });
});
