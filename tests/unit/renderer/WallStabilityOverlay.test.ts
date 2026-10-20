// BlastSimulator2026 — wall overlay tint thresholds and render gating (#1943)
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { WallStabilityOverlay, wallFaceTint } from '../../../src/renderer/WallStabilityOverlay.js';
import { buildWallOverlayFaces } from '../../../src/renderer/GameRendererSync.js';
import { buildWallGrid, standardShot } from '../../helpers/wallWarningFixture.js';
import { WALL_WARN_RATIO, WALL_OVERLAY_MAX_FACE_CELLS } from '../../../src/core/config/balance.js';
import type { WallFace } from '../../../src/core/mining/WallStability.js';

describe('wallFaceTint', () => {
  it('warns from 80% of the safe height', () => {
    expect(WALL_WARN_RATIO).toBe(0.8);
  });

  it('is null under 80% of the safe height', () => {
    expect(wallFaceTint(0, 12)).toBeNull();
    expect(wallFaceTint(9, 12)).toBeNull(); // 75%
    expect(wallFaceTint(9.59, 12)).toBeNull();
  });

  it('is amber from exactly 80% up to (not including) the safe height', () => {
    expect(wallFaceTint(9.6, 12)).toBe('amber');
    expect(wallFaceTint(8, 10)).toBe('amber'); // exactly 0.8
    expect(wallFaceTint(11, 12)).toBe('amber');
    expect(wallFaceTint(11.99, 12)).toBe('amber');
  });

  it('is red at exactly the safe height and above', () => {
    expect(wallFaceTint(12, 12)).toBe('red');
    expect(wallFaceTint(13, 12)).toBe('red');
    expect(wallFaceTint(40, 12)).toBe('red');
  });

  it('scales with the rock: 20 m is red for tier 1 (12 m) and null for tier 5 (30 m)', () => {
    expect(wallFaceTint(20, 12)).toBe('red');
    expect(wallFaceTint(20, 30)).toBeNull();
    expect(wallFaceTint(24, 30)).toBe('amber');
  });
});

describe('buildWallOverlayFaces', () => {
  it('is empty on a non-progression site even when the plan would leave a tall face', () => {
    const shot = standardShot('krackle', 8, false);
    expect(shot.state.grade).toBeUndefined();
    expect(buildWallOverlayFaces(shot.state, buildWallGrid({ plateauTop: 25 }))).toEqual([]);
  });

  it('is empty without a grid', () => {
    expect(buildWallOverlayFaces(standardShot().state, null)).toEqual([]);
  });

  it('is empty when no plan is armed', () => {
    const { state } = standardShot();
    state.drillHoles.length = 0;
    expect(buildWallOverlayFaces(state, buildWallGrid({ plateauTop: 25 }))).toEqual([]);
  });

  it('lists the predicted faces on a progression site', () => {
    const faces = buildWallOverlayFaces(standardShot().state, buildWallGrid({ plateauTop: 25 }));
    expect(faces.length).toBeGreaterThan(0);
    const f = faces.find(face => face.crest.x === 13 && face.crest.z === 20)!;
    expect(f.heightM).toBe(13);
    expect(f.safeM).toBe(12);
  });

  it('is empty when the plan leaves only low faces', () => {
    expect(buildWallOverlayFaces(standardShot().state, buildWallGrid({ plateauTop: 21 }))).toEqual([]);
  });
});

// ── WallStabilityOverlay rendering ───────────────────────────────────────────

const AMBER = new THREE.Color(0xffb000);
const RED = new THREE.Color(0xff2a1a);

/** Crest at (x0, z0) running +x; ground drops to 0 from world x >= 8.5. */
function face(heightM: number, safeM: number, over: Partial<WallFace> = {}): WallFace {
  return { crest: { x: 5, z: 5 }, dir: { dx: 1, dz: 0 }, crestY: 10, toeY: 0, heightM, safeM, ...over };
}
const cliff = (x: number): number => (x < 8.5 ? 10 : 0);

function setup(surface: (x: number, z: number) => number = cliff) {
  const scene = new THREE.Scene();
  return { scene, overlay: new WallStabilityOverlay(scene, surface) };
}

function meshOf(scene: THREE.Scene): THREE.Mesh | undefined {
  let m: THREE.Mesh | undefined;
  scene.traverse(o => { if (o instanceof THREE.Mesh) m = o; });
  return m;
}

/** Colour painted on each grid cell ("x,z"), read from the layer's vertices. */
function cellColors(scene: THREE.Scene): Map<string, THREE.Color> {
  const out = new Map<string, THREE.Color>();
  const m = meshOf(scene);
  if (!m) return out;
  const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const col = m.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!pos || !col) return out;
  for (let i = 0; i < pos.count; i++) {
    // Cell (x, z) spans [x, x+1] x [z, z+1]; probe by the vertex nudged inward is unnecessary
    // because every vertex of one cell shares its colour: key by the cell's min corner.
    out.set(`${Math.floor(pos.getX(i) - 1e-6)},${Math.floor(pos.getZ(i) - 1e-6)}`, new THREE.Color(col.getX(i), col.getY(i), col.getZ(i)));
  }
  return out;
}

const near = (a: THREE.Color, b: THREE.Color): boolean => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 0.05;

describe('WallStabilityOverlay', () => {
  it('starts hidden with nothing drawn', () => {
    const { scene } = setup();
    expect(meshOf(scene)!.visible).toBe(false);
  });

  it('show() paints amber cells from the crest down to the toe and becomes visible', () => {
    const { scene, overlay } = setup();
    overlay.show([face(9.6, 12)]);
    expect(meshOf(scene)!.visible).toBe(true);
    const cells = cellColors(scene);
    const painted = [...cells.keys()].filter(k => cells.get(k) && near(cells.get(k)!, AMBER));
    expect(painted.length).toBeGreaterThan(0);
    // Crest cell (5,5) is painted; the walk stops once the ground drops to the toe (x >= 8.5).
    expect(cells.has('5,5')).toBe(true);
    expect(cells.has('7,5')).toBe(true);
    expect(cells.has('9,5')).toBe(false);
  });

  it('show() paints a face at or over its safe height red', () => {
    const { scene, overlay } = setup();
    overlay.show([face(13, 12)]);
    const c = cellColors(scene).get('5,5')!;
    expect(near(c, RED)).toBe(true);
  });

  it('walk is capped at WALL_OVERLAY_MAX_FACE_CELLS when the ground never reaches the toe', () => {
    const { scene, overlay } = setup(() => 100);
    overlay.show([face(13, 12)]);
    const xs = new Set([...cellColors(scene).keys()].map(k => Number(k.split(',')[0])));
    expect(xs.has(5 + WALL_OVERLAY_MAX_FACE_CELLS - 1)).toBe(true);
    expect(xs.has(5 + WALL_OVERLAY_MAX_FACE_CELLS)).toBe(false);
  });

  it('walks along dir (z axis too)', () => {
    const { scene, overlay } = setup((_x, z) => (z < 8.5 ? 10 : 0));
    overlay.show([face(13, 12, { dir: { dx: 0, dz: 1 } })]);
    const cells = cellColors(scene);
    expect(cells.has('5,5')).toBe(true);
    expect(cells.has('5,7')).toBe(true);
    expect(cells.has('5,9')).toBe(false);
  });

  it('red wins over amber on overlapping cells, whichever face comes first', () => {
    for (const order of [[face(9.6, 12), face(13, 12)], [face(13, 12), face(9.6, 12)]]) {
      const { scene, overlay } = setup();
      overlay.show(order);
      expect(near(cellColors(scene).get('5,5')!, RED)).toBe(true);
    }
  });

  it('amber does not overwrite amber of an earlier amber face (later overlap replaces it)', () => {
    const { scene, overlay } = setup();
    overlay.show([face(9.6, 12), face(10, 12)]);
    expect(near(cellColors(scene).get('5,5')!, AMBER)).toBe(true);
  });

  it('a face under the warn ratio paints nothing and leaves the layer hidden', () => {
    const { scene, overlay } = setup();
    overlay.show([face(5, 12)]);
    expect(meshOf(scene)!.visible).toBe(false);
    expect(cellColors(scene).size).toBe(0);
  });

  it('show([]) after a tinted show clears the patches and hides', () => {
    const { scene, overlay } = setup();
    overlay.show([face(13, 12)]);
    overlay.show([]);
    expect(meshOf(scene)!.visible).toBe(false);
    expect(cellColors(scene).size).toBe(0);
  });

  it('hide() hides the layer but a later show() brings it back', () => {
    const { scene, overlay } = setup();
    overlay.show([face(13, 12)]);
    overlay.hide();
    expect(meshOf(scene)!.visible).toBe(false);
    overlay.show([face(13, 12)]);
    expect(meshOf(scene)!.visible).toBe(true);
  });

  it('hide() before any show() does not throw', () => {
    expect(() => setup().overlay.hide()).not.toThrow();
  });

  it('dispose() removes the mesh from the scene', () => {
    const { scene, overlay } = setup();
    overlay.show([face(13, 12)]);
    overlay.dispose();
    expect(meshOf(scene)).toBeUndefined();
  });
});
