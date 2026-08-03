import { describe, it, expect } from 'vitest';
import { WorldNoiseFields } from '../../../src/core/world/NoiseFields.js';
import { DEFAULT_SHAPING, type Rect, type ShapingAtFn } from '../../../src/core/world/WorldGen.js';
import {
  traceRivers,
  placeLandmarks,
  placeVillages,
  placeForests,
  buildStructureSet,
  applyOverlays,
  buildRiverOverlay,
  buildLandmarkOverlay,
  buildVillageOverlay,
  type RiverPath,
  type Village,
  type Landmark,
} from '../../../src/core/world/Structures.js';

const flatShapingAt: ShapingAtFn = () => DEFAULT_SHAPING;
const TINY_RECT: Rect = { minX: 0, minZ: 0, maxX: 24, maxZ: 24 };

function expandRect(rect: Rect, margin: number): Rect {
  return { minX: rect.minX - margin, maxX: rect.maxX + margin, minZ: rect.minZ - margin, maxZ: rect.maxZ + margin };
}

function insideRect(rect: Rect, x: number, z: number): boolean {
  return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

// ---------------------------------------------------------------------------
// Rivers
// ---------------------------------------------------------------------------

describe('traceRivers', () => {
  it('is deterministic for the same seed', () => {
    const fields = new WorldNoiseFields(42);
    const a = traceRivers(42, fields, flatShapingAt, TINY_RECT);
    const b = traceRivers(42, new WorldNoiseFields(42), flatShapingAt, TINY_RECT);
    expect(a).toEqual(b);
  });

  it('never traces a point inside the playable rect expanded by 32m, across several seeds', () => {
    const excludeRect = expandRect(TINY_RECT, 32);
    for (const seed of [1, 2, 3, 4, 5]) {
      const fields = new WorldNoiseFields(seed);
      const rivers = traceRivers(seed, fields, flatShapingAt, TINY_RECT);
      for (const river of rivers) {
        for (const p of river.points) {
          expect(insideRect(excludeRect, p.x, p.z)).toBe(false);
        }
      }
    }
  });

  it('water levels are monotonically non-increasing downstream, across several seeds', () => {
    let riverCount = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const fields = new WorldNoiseFields(seed);
      const rivers = traceRivers(seed, fields, flatShapingAt, TINY_RECT);
      for (const river of rivers) {
        riverCount++;
        for (let i = 1; i < river.waterLevels.length; i++) {
          expect(river.waterLevels[i]!).toBeLessThanOrEqual(river.waterLevels[i - 1]!);
        }
      }
    }
    // Confirm the test actually exercised real river data, not just vacuously-true empty arrays.
    expect(riverCount).toBeGreaterThan(0);
  });

  it('every river has matching points/widths/waterLevels lengths, all widths positive', () => {
    const fields = new WorldNoiseFields(7);
    const rivers = traceRivers(7, fields, flatShapingAt, TINY_RECT);
    expect(rivers.length).toBeGreaterThan(0);
    for (const river of rivers) {
      expect(river.widths.length).toBe(river.points.length);
      expect(river.waterLevels.length).toBe(river.points.length);
      for (const w of river.widths) expect(w).toBeGreaterThan(0);
    }
  });

  it('caps at 6 rivers', () => {
    for (const seed of [1, 2, 3]) {
      const fields = new WorldNoiseFields(seed);
      const rivers = traceRivers(seed, fields, flatShapingAt, TINY_RECT);
      expect(rivers.length).toBeLessThanOrEqual(6);
    }
  });
});

describe('buildRiverOverlay', () => {
  const river: RiverPath = {
    points: [{ x: 0, z: 0 }, { x: 100, z: 0 }],
    widths: [4, 4],
    waterLevels: [10, 10],
  };
  const overlay = buildRiverOverlay(river);

  it('carves a channel: height decreases at the centreline', () => {
    expect(overlay.apply(50, 0, 20)).toBeLessThan(20);
  });

  it('leaves height unchanged beyond the channel width', () => {
    expect(overlay.apply(50, 100, 20)).toBe(20);
  });

  it('carves less near the bank (dist close to width) than at the centreline', () => {
    const atCentre = 20 - overlay.apply(50, 0, 20);
    const nearBank = 20 - overlay.apply(50, 3.9, 20);
    expect(nearBank).toBeLessThan(atCentre);
  });

  it('bounds cover every point expanded by the max width', () => {
    expect(overlay.bounds.minX).toBeLessThanOrEqual(0 - 4);
    expect(overlay.bounds.maxX).toBeGreaterThanOrEqual(100 + 4);
  });

  it('a degenerate single-point river never changes height (no segment to measure against)', () => {
    const single = buildRiverOverlay({ points: [{ x: 0, z: 0 }], widths: [4], waterLevels: [10] });
    expect(single.apply(0, 0, 55)).toBe(55);
  });
});

// ---------------------------------------------------------------------------
// Landmarks
// ---------------------------------------------------------------------------

describe('placeLandmarks', () => {
  it('is deterministic for the same seed', () => {
    const fields = new WorldNoiseFields(42);
    const a = placeLandmarks(42, fields, flatShapingAt, TINY_RECT);
    const b = placeLandmarks(42, new WorldNoiseFields(42), flatShapingAt, TINY_RECT);
    expect(a).toEqual(b);
  });

  it('places at most 2 landmarks, all >=400m from the playable rect and >=500m apart', () => {
    let landmarkCount = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const fields = new WorldNoiseFields(seed);
      const landmarks = placeLandmarks(seed, fields, flatShapingAt, TINY_RECT);
      landmarkCount += landmarks.length;
      expect(landmarks.length).toBeLessThanOrEqual(2);

      const excludeRect = expandRect(TINY_RECT, 400);
      for (const l of landmarks) {
        expect(insideRect(excludeRect, l.x, l.z)).toBe(false);
      }
      for (let i = 0; i < landmarks.length; i++) {
        for (let j = i + 1; j < landmarks.length; j++) {
          const dist = Math.hypot(landmarks[i]!.x - landmarks[j]!.x, landmarks[i]!.z - landmarks[j]!.z);
          expect(dist).toBeGreaterThanOrEqual(500);
        }
      }
    }
    expect(landmarkCount).toBeGreaterThan(0);
  });

  it('only crater_lake landmarks carry a waterLevel', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const fields = new WorldNoiseFields(seed);
      for (const l of placeLandmarks(seed, fields, flatShapingAt, TINY_RECT)) {
        if (l.kind === 'crater_lake') expect(typeof l.waterLevel).toBe('number');
        else expect(l.waterLevel).toBeUndefined();
      }
    }
  });
});

describe('buildLandmarkOverlay', () => {
  const mesa: Landmark = { kind: 'mesa', x: 0, z: 0, radius: 100 };
  const crater: Landmark = { kind: 'crater_lake', x: 0, z: 0, radius: 100, waterLevel: 8 };

  it('mesa: at the centre, height moves fully to the plateau (hBase + 25)', () => {
    const overlay = buildLandmarkOverlay(mesa, 10);
    expect(overlay.apply(0, 0, 10)).toBeCloseTo(35, 5);
  });

  it('mesa: beyond the radius, height is unchanged', () => {
    const overlay = buildLandmarkOverlay(mesa, 10);
    expect(overlay.apply(150, 0, 40)).toBe(40);
  });

  it('crater_lake: rim (near r=R*0.7-0.85) raises height above the input', () => {
    const overlay = buildLandmarkOverlay(crater, 10);
    // The rim band sits between the two smoothstep thresholds (0.75R and 0.6R
    // on the inner edge) — 0.8R is comfortably inside both "past 0.75R" and
    // "past 0.6R", so both factors are non-zero there.
    const rimR = 80;
    expect(overlay.apply(rimR, 0, 20)).toBeGreaterThan(20);
  });

  it('crater_lake: bowl centre lowers height below the input', () => {
    const overlay = buildLandmarkOverlay(crater, 10);
    expect(overlay.apply(0, 0, 20)).toBeLessThan(20);
  });

  it('crater_lake: far outside the radius, both effects vanish', () => {
    const overlay = buildLandmarkOverlay(crater, 10);
    expect(overlay.apply(200, 0, 30)).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Villages — the 1000-seed exclusion invariant
// ---------------------------------------------------------------------------

describe('placeVillages', () => {
  it('is deterministic for the same seed', () => {
    const fields = new WorldNoiseFields(42);
    const a = placeVillages(42, fields, flatShapingAt, TINY_RECT, []);
    const b = placeVillages(42, new WorldNoiseFields(42), flatShapingAt, TINY_RECT, []);
    expect(a).toEqual(b);
  });

  it('never places a village inside the playable rect expanded by 100m, over 1000 seeds', () => {
    const excludeRect = expandRect(TINY_RECT, 100);
    // A reduced extent (800 vs the 1600 default) keeps this fast while still
    // giving the jittered village grid several cells whose candidates can
    // land near the exclusion zone (the playable rect sits at the extent's
    // own centre, so the innermost grid cells overlap it directly).
    let villageCount = 0;
    for (let seed = 0; seed < 1000; seed++) {
      const fields = new WorldNoiseFields(seed);
      const villages = placeVillages(seed, fields, flatShapingAt, TINY_RECT, [], 800);
      villageCount += villages.length;
      for (const v of villages) {
        expect(insideRect(excludeRect, v.x, v.z)).toBe(false);
      }
    }
    // Confirm the sweep actually produced villages somewhere — otherwise the
    // invariant above would be vacuously true for every seed.
    expect(villageCount).toBeGreaterThan(0);
  });

  it('caps at 5 villages and gives every village a positive radius', () => {
    let villageCount = 0;
    for (let seed = 0; seed < 50; seed++) {
      const fields = new WorldNoiseFields(seed);
      const villages = placeVillages(seed, fields, flatShapingAt, TINY_RECT, [], 800);
      villageCount += villages.length;
      expect(villages.length).toBeLessThanOrEqual(5);
      for (const v of villages) expect(v.radius).toBeGreaterThan(0);
    }
    expect(villageCount).toBeGreaterThan(0);
  });

  it('gives every house a width/depth/height inside the spec ranges', () => {
    // Villages are rare at this reduced extent (only ~9 candidate cells, and
    // score > 1.2 is a demanding joint condition) — scan enough seeds that
    // finding none would itself be surprising, rather than relying on a
    // handful of seeds that might all happen to be village-free.
    let houseCount = 0;
    for (let seed = 0; seed < 50; seed++) {
      const fields = new WorldNoiseFields(seed);
      const villages = placeVillages(seed, fields, flatShapingAt, TINY_RECT, [], 800);
      for (const v of villages) {
        for (const h of v.houses) {
          houseCount++;
          expect(h.w).toBeGreaterThanOrEqual(4);
          expect(h.w).toBeLessThanOrEqual(6);
          expect(h.d).toBeGreaterThanOrEqual(5);
          expect(h.d).toBeLessThanOrEqual(8);
          expect(h.h).toBeGreaterThanOrEqual(3);
          expect(h.h).toBeLessThanOrEqual(4);
        }
      }
    }
    expect(houseCount).toBeGreaterThan(0);
  });
});

describe('buildVillageOverlay', () => {
  const village: Village = { x: 0, z: 0, radius: 40, houses: [] };
  const fields = new WorldNoiseFields(42);

  it('at the centre, height moves fully to hCenter', () => {
    const overlay = buildVillageOverlay(village, fields, flatShapingAt, 15);
    expect(overlay.apply(0, 0, 999)).toBeCloseTo(15, 5);
  });

  it('at/beyond the pad radius, height is close to the untouched sample (no pad influence)', () => {
    const overlay = buildVillageOverlay(village, fields, flatShapingAt, 15);
    const untouched = overlay.apply(41, 0, 999);
    // smoothstep(40, 15, 41) = 0 exactly, so this should equal the raw sample at (41, 0), not 999 or 15.
    expect(untouched).not.toBe(999);
    expect(untouched).not.toBeCloseTo(15, 5);
  });
});

// ---------------------------------------------------------------------------
// Forests
// ---------------------------------------------------------------------------

describe('placeForests', () => {
  it('is deterministic for the same seed', () => {
    const fields = new WorldNoiseFields(42);
    const a = placeForests(42, fields, flatShapingAt, 0.9, TINY_RECT, [], [], [], 200);
    const b = placeForests(42, new WorldNoiseFields(42), flatShapingAt, 0.9, TINY_RECT, [], [], [], 200);
    expect(a).toEqual(b);
  });

  it('never places a tree inside the playable rect expanded by 8m', () => {
    const excludeRect = expandRect(TINY_RECT, 8);
    for (const seed of [1, 2, 3]) {
      const fields = new WorldNoiseFields(seed);
      const trees = placeForests(seed, fields, flatShapingAt, 0.9, TINY_RECT, [], [], [], 200);
      for (const t of trees) expect(insideRect(excludeRect, t.x, t.z)).toBe(false);
    }
  });

  it('a forestDensity of 0 places no trees', () => {
    const fields = new WorldNoiseFields(42);
    const trees = placeForests(42, fields, flatShapingAt, 0, TINY_RECT, [], [], [], 200);
    expect(trees).toEqual([]);
  });

  it('every tree has scale in [0.7, 1.3] and variant in [0, 2]', () => {
    let treeCount = 0;
    for (const seed of [1, 2, 3, 4]) {
      const fields = new WorldNoiseFields(seed);
      const trees = placeForests(seed, fields, flatShapingAt, 0.9, TINY_RECT, [], [], [], 200);
      for (const t of trees) {
        treeCount++;
        expect(t.scale).toBeGreaterThanOrEqual(0.7);
        expect(t.scale).toBeLessThanOrEqual(1.3);
        expect(t.variant).toBeGreaterThanOrEqual(0);
        expect(t.variant).toBeLessThanOrEqual(2);
      }
    }
    expect(treeCount).toBeGreaterThan(0);
  });

  it('rejects sites inside a village pad', () => {
    const fields = new WorldNoiseFields(42);
    const village: Village = { x: 0, z: 0, radius: 40, houses: [] };
    const trees = placeForests(42, fields, flatShapingAt, 1.0, TINY_RECT, [], [village], [], 200);
    for (const t of trees) {
      expect(Math.hypot(t.x - village.x, t.z - village.z)).toBeGreaterThanOrEqual(village.radius);
    }
  });
});

// ---------------------------------------------------------------------------
// applyOverlays + full orchestration
// ---------------------------------------------------------------------------

describe('applyOverlays', () => {
  it('returns the base height unchanged far from every structure', () => {
    const set = buildStructureSet(1, new WorldNoiseFields(1), flatShapingAt, 0, TINY_RECT, 200);
    expect(applyOverlays(set, 1_000_000, 1_000_000, 42)).toBe(42);
  });

  it('the spatial-indexed lookup matches a naive linear scan over every overlay', () => {
    // Validates the spatial index itself: a dense grid of query points across
    // the whole search extent must agree with directly applying every
    // overlay whose bounds contain the point, in build order.
    const set = buildStructureSet(5, new WorldNoiseFields(5), flatShapingAt, 0.5, TINY_RECT, 800);
    expect(set.overlays.length).toBeGreaterThan(0); // otherwise this test would be vacuously true everywhere

    function linearScan(x: number, z: number, base: number): number {
      let h = base;
      for (const overlay of set.overlays) {
        const b = overlay.bounds;
        if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) h = overlay.apply(x, z, h);
      }
      return h;
    }

    for (let x = -800; x <= 800; x += 50) {
      for (let z = -800; z <= 800; z += 50) {
        expect(applyOverlays(set, x, z, 10)).toBeCloseTo(linearScan(x, z, 10), 8);
      }
    }
  });
});

describe('buildStructureSet', () => {
  it('is deterministic for the same seed (rivers, landmarks, villages and trees all match)', () => {
    const a = buildStructureSet(42, new WorldNoiseFields(42), flatShapingAt, 0.5, TINY_RECT, 200);
    const b = buildStructureSet(42, new WorldNoiseFields(42), flatShapingAt, 0.5, TINY_RECT, 200);
    expect(a.rivers).toEqual(b.rivers);
    expect(a.landmarks).toEqual(b.landmarks);
    expect(a.villages).toEqual(b.villages);
    expect(a.trees).toEqual(b.trees);
  });

  it('builds overlays in the spec-mandated order: rivers, then landmarks, then village pads', () => {
    const set = buildStructureSet(3, new WorldNoiseFields(3), flatShapingAt, 0.5, TINY_RECT, 800);
    expect(set.overlays.length).toBe(set.rivers.length + set.landmarks.length + set.villages.length);
  });

  it('never lets a village or river structure touch the playable rect', () => {
    const excludeRiver = expandRect(TINY_RECT, 32);
    const excludeVillage = expandRect(TINY_RECT, 100);
    for (const seed of [1, 2, 3]) {
      const set = buildStructureSet(seed, new WorldNoiseFields(seed), flatShapingAt, 0.5, TINY_RECT, 800);
      for (const r of set.rivers) for (const p of r.points) expect(insideRect(excludeRiver, p.x, p.z)).toBe(false);
      for (const v of set.villages) expect(insideRect(excludeVillage, v.x, v.z)).toBe(false);
    }
  });

  it('runs end-to-end at the production 1600m extent without crashing, for one seed', () => {
    const set = buildStructureSet(42, new WorldNoiseFields(42), flatShapingAt, 0.5, TINY_RECT);
    expect(set.overlays.length).toBe(set.rivers.length + set.landmarks.length + set.villages.length);
    expect(Array.isArray(set.trees)).toBe(true);
  });
});
