// WaterSurface — unit tests (#458 T7.2/D12/A26)

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  WaterSurface,
  _buildRiverStrip,
  _buildLakeDisc,
  FOAM_BAND_METRES,
} from '../../../../src/renderer/ambient/WaterSurface.js';
import type { RiverPath, Landmark } from '../../../../src/core/world/Structures.js';

function makeRiver(): RiverPath {
  return {
    points: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 20, z: 0 }],
    widths: [4, 4, 4],
    waterLevels: [10, 9, 8],
  };
}

function waterMesh(scene: THREE.Scene): THREE.Mesh | undefined {
  return scene.children.find((c): c is THREE.Mesh => c.name === 'water-surface');
}

describe('buildRiverStrip (pure geometry)', () => {
  it('returns null for a degenerate single-point path', () => {
    expect(_buildRiverStrip({ points: [{ x: 0, z: 0 }], widths: [4], waterLevels: [10] })).toBeNull();
  });

  it('produces 4 vertices per ring and foam only at the two edge vertices', () => {
    const result = _buildRiverStrip(makeRiver())!;
    expect(result.positions.length / 3).toBe(4 * 3); // 4 verts x 3 rings
    // Per ring: [edge=1, inner=0, inner=0, edge=1]
    expect(result.foam.slice(0, 4)).toEqual([1, 0, 0, 1]);
  });

  it('foam-band inner vertices sit FOAM_BAND_METRES in from the water edge', () => {
    const river = makeRiver(); // width 4 at every point
    const result = _buildRiverStrip(river)!;
    // Ring 0 is centred at (0,0) with the path heading +X, so the
    // perpendicular is along Z — left edge z=+4, left inner z=+(4-FOAM_BAND_METRES).
    const leftEdgeZ = result.positions[2]!;
    const leftInnerZ = result.positions[5]!;
    expect(Math.abs(leftEdgeZ)).toBeCloseTo(4, 5);
    expect(Math.abs(leftInnerZ)).toBeCloseTo(4 - FOAM_BAND_METRES, 5);
  });

  it('never lets the foam-free inner band cross the centreline on a channel narrower than the band', () => {
    const narrow: RiverPath = { points: [{ x: 0, z: 0 }, { x: 10, z: 0 }], widths: [0.3, 0.3], waterLevels: [10, 10] };
    const result = _buildRiverStrip(narrow)!;
    // innerW clamps to 0 — inner vertices collapse onto the centreline, not past it.
    expect(result.positions[3]).toBeCloseTo(0, 5); // x of left-inner
    expect(result.positions[5]).toBeCloseTo(0, 5); // z of left-inner
  });

  it('water Y follows waterLevels at each ring, not a flat plane', () => {
    const result = _buildRiverStrip(makeRiver())!;
    // 4 vertices x 3 floats (x,y,z) per ring — ring i's first vertex Y is at index i*12+1.
    const ringYs = [0, 1, 2].map(i => result.positions[i * 12 + 1]);
    expect(ringYs).toEqual([10, 9, 8]);
  });
});

describe('buildLakeDisc (pure geometry)', () => {
  it('produces a centre vertex plus a ring of LAKE_SEGMENTS+2 rim vertices, all at the given water level', () => {
    const disc = _buildLakeDisc(50, 50, 20, 12);
    expect(disc.positions.length / 3).toBeGreaterThan(20);
    for (let i = 1; i < disc.positions.length / 3; i++) {
      expect(disc.positions[i * 3 + 1]).toBe(12);
    }
  });

  it('marks the rim as foam and the centre as open water', () => {
    const disc = _buildLakeDisc(0, 0, 10, 5);
    expect(disc.foam[0]).toBe(0); // centre
    expect(disc.foam[1]).toBe(1); // rim
  });
});

describe('WaterSurface', () => {
  it('constructs without a browser/DOM and adds a mesh when rivers exist', () => {
    const scene = new THREE.Scene();
    const water = new WaterSurface(scene, 'desert_badlands', [makeRiver()], []);
    expect(waterMesh(scene)).toBeDefined();
    water.dispose();
  });

  it('adds no mesh when there is no river or crater lake', () => {
    const scene = new THREE.Scene();
    const water = new WaterSurface(scene, 'desert_badlands', [], []);
    expect(waterMesh(scene)).toBeUndefined();
    water.dispose(); // must not throw with no mesh
  });

  it('builds a mesh from a crater-lake landmark alone (no rivers)', () => {
    const scene = new THREE.Scene();
    const landmark: Landmark = { kind: 'crater_lake', x: 30, z: 30, radius: 25, waterLevel: 8 };
    const water = new WaterSurface(scene, 'tropical_karst', [], [landmark]);
    expect(waterMesh(scene)).toBeDefined();
    water.dispose();
  });

  it('ignores a mesa landmark (no waterLevel)', () => {
    const scene = new THREE.Scene();
    const landmark: Landmark = { kind: 'mesa', x: 30, z: 30, radius: 25 };
    const water = new WaterSurface(scene, 'red_canyon', [], [landmark]);
    expect(waterMesh(scene)).toBeUndefined();
    water.dispose();
  });

  it('update() does not throw across many frames with wind applied', () => {
    const scene = new THREE.Scene();
    const water = new WaterSurface(scene, 'green_foothills', [makeRiver()], []);
    expect(() => {
      for (let i = 0; i < 50; i++) water.update(0.1, { x: 0.3, z: 0.1 });
    }).not.toThrow();
    water.dispose();
  });

  it('dispose removes the water mesh from the scene', () => {
    const scene = new THREE.Scene();
    const water = new WaterSurface(scene, 'volcanic_flats', [makeRiver()], []);
    expect(waterMesh(scene)).toBeDefined();
    water.dispose();
    expect(waterMesh(scene)).toBeUndefined();
  });
});
