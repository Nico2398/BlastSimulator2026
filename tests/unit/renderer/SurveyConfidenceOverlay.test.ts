// BlastSimulator2026 — SurveyConfidenceOverlay unit tests (#1006)
//
// Retargets the overlay's rendering assertions at the shared GroundTintLayer
// rather than raw PlaneGeometry mesh counting: each confidence quad has to
// conform to the sampled marching-cubes surface under its own footprint
// instead of sitting flat at one fixed Y (the constructor's optional
// SurfaceHeightSampler). confidenceToColor and the stale/fresh colour split
// are unchanged by #1006 and are covered here as regression-safety checks.

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  SurveyConfidenceOverlay,
  confidenceToColor,
  valueToColor,
  type SurveyConfidencePoint,
} from '../../../src/renderer/SurveyConfidenceOverlay.js';
import { SURVEY_OVERLAY_VALUE_FLOOR, SURVEY_OVERLAY_VALUE_CEIL } from '../../../src/core/config/balance.js';
import type { SurfaceHeightSampler } from '../../../src/renderer/GroundTint.js';

let scene: THREE.Scene;

beforeEach(() => {
  scene = new THREE.Scene();
});

/**
 * Every vertex Y across every Mesh in the scene, in WORLD space. Reading
 * `geometry.attributes.position` directly gives LOCAL coordinates — the
 * overlay's existing quads are rotated flat via `mesh.rotation.x`, so their
 * local Y spans their own quad size regardless of terrain height, which
 * would make a still-flat (buggy) quad look like it conforms. Applying
 * `matrixWorld` covers both that legacy rotated-local-plane mesh and a
 * conforming mesh that bakes world height directly into local coordinates
 * at identity transform (a no-op transform in that case).
 */
function allPositionYs(): number[] {
  scene.updateMatrixWorld(true);
  const ys: number[] = [];
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const pos = o.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        v.applyMatrix4(o.matrixWorld);
        ys.push(v.y);
      }
    }
  });
  return ys;
}

function isEffectivelyVisible(obj: THREE.Object3D): boolean {
  let o: THREE.Object3D | null = obj;
  while (o) {
    if (!o.visible) return false;
    o = o.parent;
  }
  return true;
}

function point(overrides: Partial<SurveyConfidencePoint>): SurveyConfidencePoint {
  return { x: 0, z: 0, surfaceY: 0, confidence: 1, fresh: true, ...overrides };
}

describe('confidenceToColor — unchanged by #1006', () => {
  it('maps confidence 1.0 to green', () => {
    const c = confidenceToColor(1);
    expect(c.r).toBeCloseTo(0, 5);
    expect(c.g).toBeCloseTo(1, 5);
    expect(c.b).toBeCloseTo(0, 5);
  });

  it('maps confidence 0.5 to yellow', () => {
    const c = confidenceToColor(0.5);
    expect(c.r).toBeCloseTo(1, 5);
    expect(c.g).toBeCloseTo(1, 5);
    expect(c.b).toBeCloseTo(0, 5);
  });

  it('maps confidence 0.0 to red', () => {
    const c = confidenceToColor(0);
    expect(c.r).toBeCloseTo(1, 5);
    expect(c.g).toBeCloseTo(0, 5);
    expect(c.b).toBeCloseTo(0, 5);
  });

  it('boundary: clamps out-of-range confidence into [0,1]', () => {
    const under = confidenceToColor(-5);
    const over = confidenceToColor(5);
    expect(under.r).toBeCloseTo(confidenceToColor(0).r, 5);
    expect(over.g).toBeCloseTo(confidenceToColor(1).g, 5);
  });
});

describe('SurveyConfidenceOverlay — stale points', () => {
  it('renders stale points grey regardless of their confidence value', () => {
    const overlay = new SurveyConfidenceOverlay(scene);
    overlay.show({ points: [point({ confidence: 0.9, fresh: false })], opacity: 1 });

    // Colour is per-vertex (GroundTintLayer's merged mesh uses vertexColors,
    // not a per-mesh material.color), so read the geometry's `color`
    // attribute rather than each mesh's own material (#1006).
    const greys: [number, number, number][] = [];
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const colorAttr = o.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
        if (!colorAttr) return;
        for (let i = 0; i < colorAttr.count; i++) {
          greys.push([colorAttr.getX(i), colorAttr.getY(i), colorAttr.getZ(i)]);
        }
      }
    });
    expect(greys.length).toBeGreaterThan(0);
    expect(greys.some(([r, g, b]) => Math.abs(r - 0.5) < 0.05 && Math.abs(g - 0.5) < 0.05 && Math.abs(b - 0.5) < 0.05)).toBe(true);
  });
});

describe('SurveyConfidenceOverlay — ground-tint conformance (#1006)', () => {
  it('a single confidence quad conforms to the slope within its own footprint, not a single flat Y', () => {
    const sampler: SurfaceHeightSampler = (x, _z) => x * 5; // strong local slope
    const overlay = new SurveyConfidenceOverlay(scene, sampler);
    // surfaceY deliberately stale/flat — the point genuinely conforming to the
    // slope has to come from the sampler, not from trusting this field alone.
    overlay.show({ points: [point({ x: 10, z: 10, surfaceY: 50 })], opacity: 1 });

    const ys = allPositionYs();
    expect(ys.length, 'a confidence point should render geometry').toBeGreaterThan(0);
    expect(
      Math.max(...ys) - Math.min(...ys),
      'the quad should conform to the slope beneath it instead of sitting flat (#1006)',
    ).toBeGreaterThan(1);
  });

  it('two points whose sampler-reported heights differ get correspondingly different vertex Y', () => {
    const sampler: SurfaceHeightSampler = (x, _z) => (x < 5 ? 2 : 40);
    const overlay = new SurveyConfidenceOverlay(scene, sampler);
    // Both points report the same (stale) surfaceY on purpose, so a pass here
    // can only mean the overlay is really reading the live sampler.
    overlay.show({
      points: [
        point({ x: 1, z: 1, surfaceY: 5 }),
        point({ x: 20, z: 1, surfaceY: 5 }),
      ],
      opacity: 1,
    });

    const ys = allPositionYs();
    expect(Math.min(...ys)).toBeLessThan(10);
    expect(Math.max(...ys)).toBeGreaterThan(30);
  });
});

describe('SurveyConfidenceOverlay — visibility toggle (unchanged)', () => {
  it('show() makes the overlay visible and hide() makes it invisible', () => {
    const overlay = new SurveyConfidenceOverlay(scene);
    overlay.show({ points: [point({})], opacity: 1 });

    const meshes: THREE.Mesh[] = [];
    scene.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.every(isEffectivelyVisible)).toBe(true);

    overlay.hide();
    expect(meshes.every((m) => !isEffectivelyVisible(m))).toBe(true);
  });

  it('boundary: hide() before any show() does not throw', () => {
    const overlay = new SurveyConfidenceOverlay(scene);
    expect(() => overlay.hide()).not.toThrow();
  });
});

describe('SurveyConfidenceOverlay — dispose/clear', () => {
  it('clear() renders nothing (the merged ground-tint mesh stays in the scene, empty — #1006)', () => {
    const overlay = new SurveyConfidenceOverlay(scene);
    overlay.show({ points: [point({}), point({ x: 5, z: 5 })], opacity: 1 });
    overlay.clear();

    expect(allPositionYs()).toHaveLength(0);
  });

  it('rejection: show() with an empty points array renders nothing but does not throw', () => {
    const overlay = new SurveyConfidenceOverlay(scene);
    expect(() => overlay.show({ points: [], opacity: 1 })).not.toThrow();
    expect(allPositionYs()).toHaveLength(0);
  });
});

// ── Value colouring (#1684) ──────────────────────────────────────────────────

/** Per-vertex RGBA of every vertex the overlay drew into `sc`. */
function vertexColors(sc: THREE.Scene): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  sc.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const a = o.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!a) return;
    for (let i = 0; i < a.count; i++) out.push([a.getX(i), a.getY(i), a.getZ(i), a.itemSize > 3 ? a.getW(i) : 1]);
  });
  return out;
}

/** Colour a lone point gets when shown by itself. */
function colorOf(p: SurveyConfidencePoint): [number, number, number, number] {
  const sc = new THREE.Scene();
  new SurveyConfidenceOverlay(sc).show({ points: [p], opacity: 1 });
  const cols = vertexColors(sc);
  expect(cols.length).toBeGreaterThan(0);
  return cols[0]!;
}

const rgbDistance = (a: ArrayLike<number>, b: ArrayLike<number>): number =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

const colorTuple = (c: THREE.Color): [number, number, number] => [c.r, c.g, c.b];

describe('valueToColor (#1684)', () => {
  it('clamps below the floor to the floor colour', () => {
    const floor = valueToColor(SURVEY_OVERLAY_VALUE_FLOOR);
    expect(rgbDistance(colorTuple(valueToColor(SURVEY_OVERLAY_VALUE_FLOOR / 100)), colorTuple(floor))).toBeLessThan(1e-6);
    expect(rgbDistance(colorTuple(valueToColor(0)), colorTuple(floor))).toBeLessThan(1e-6);
  });

  it('clamps above the ceiling to the ceiling colour', () => {
    const ceil = valueToColor(SURVEY_OVERLAY_VALUE_CEIL);
    expect(rgbDistance(colorTuple(valueToColor(SURVEY_OVERLAY_VALUE_CEIL * 100)), colorTuple(ceil))).toBeLessThan(1e-6);
  });

  it('rejection: negative and NaN values do not throw and give a finite colour', () => {
    for (const v of [-50, Number.NaN]) {
      const c = valueToColor(v);
      expect(Number.isFinite(c.r) && Number.isFinite(c.g) && Number.isFinite(c.b)).toBe(true);
    }
  });

  it('poor and rich ends of the ramp are visibly different', () => {
    const d = rgbDistance(
      colorTuple(valueToColor(SURVEY_OVERLAY_VALUE_FLOOR)),
      colorTuple(valueToColor(SURVEY_OVERLAY_VALUE_CEIL)),
    );
    expect(d).toBeGreaterThan(0.5);
  });

  it('log-spaced values give distinct colours step to step across the ramp', () => {
    const ratio = Math.pow(SURVEY_OVERLAY_VALUE_CEIL / SURVEY_OVERLAY_VALUE_FLOOR, 1 / 4);
    const cols = [0, 1, 2, 3, 4].map(i => colorTuple(valueToColor(SURVEY_OVERLAY_VALUE_FLOOR * Math.pow(ratio, i))));
    for (let i = 1; i < cols.length; i++) {
      expect(rgbDistance(cols[i - 1]!, cols[i]!), `step ${i}`).toBeGreaterThan(0.05);
    }
    // No two stops collapse onto each other.
    for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) {
      expect(rgbDistance(cols[i]!, cols[j]!)).toBeGreaterThan(0.05);
    }
  });

  it('is log-scaled: the geometric midpoint sits halfway between the ends', () => {
    const lo = colorTuple(valueToColor(SURVEY_OVERLAY_VALUE_FLOOR));
    const hi = colorTuple(valueToColor(SURVEY_OVERLAY_VALUE_CEIL));
    const mid = colorTuple(valueToColor(Math.sqrt(SURVEY_OVERLAY_VALUE_FLOOR * SURVEY_OVERLAY_VALUE_CEIL)));
    const dLo = rgbDistance(lo, mid);
    const dHi = rgbDistance(mid, hi);
    expect(dLo).toBeGreaterThan(0.1);
    expect(dHi).toBeGreaterThan(0.1);
    expect(Math.abs(dLo - dHi)).toBeLessThan(0.35 * (dLo + dHi));
  });
});

describe('SurveyConfidenceOverlay — value colouring (#1684)', () => {
  it('two fresh, equal-confidence points with different valuePerM3 get different vertex colours', () => {
    const poor = colorOf(point({ confidence: 0.8, valuePerM3: SURVEY_OVERLAY_VALUE_FLOOR }));
    const rich = colorOf(point({ confidence: 0.8, valuePerM3: SURVEY_OVERLAY_VALUE_CEIL }));
    expect(rgbDistance(poor, rich)).toBeGreaterThan(0.3);
  });

  it('both columns in one show() call keep their own colours', () => {
    const sc = new THREE.Scene();
    new SurveyConfidenceOverlay(sc).show({
      points: [
        point({ x: 0, z: 0, confidence: 0.8, valuePerM3: SURVEY_OVERLAY_VALUE_FLOOR }),
        point({ x: 5, z: 5, confidence: 0.8, valuePerM3: SURVEY_OVERLAY_VALUE_CEIL }),
      ],
      opacity: 1,
    });
    const distinct = new Set(vertexColors(sc).map(c => c.slice(0, 3).map(v => v.toFixed(3)).join(',')));
    expect(distinct.size).toBeGreaterThanOrEqual(2);
  });

  it('a fresh point with a value is coloured by value, not by confidence', () => {
    const c = colorOf(point({ confidence: 0.9, valuePerM3: SURVEY_OVERLAY_VALUE_CEIL }));
    const expected = valueToColor(SURVEY_OVERLAY_VALUE_CEIL);
    expect(rgbDistance(c, colorTuple(expected))).toBeLessThan(0.02);
  });

  it('a fresh point without valuePerM3 falls back to the confidence colour', () => {
    const c = colorOf(point({ confidence: 0.25 }));
    expect(rgbDistance(c, colorTuple(confidenceToColor(0.25)))).toBeLessThan(0.02);
  });

  it('a stale point stays grey whatever its value', () => {
    for (const valuePerM3 of [SURVEY_OVERLAY_VALUE_FLOOR, SURVEY_OVERLAY_VALUE_CEIL]) {
      const c = colorOf(point({ fresh: false, confidence: 0.9, valuePerM3 }));
      expect(Math.abs(c[0] - 0.5)).toBeLessThan(0.05);
      expect(Math.abs(c[1] - 0.5)).toBeLessThan(0.05);
      expect(Math.abs(c[2] - 0.5)).toBeLessThan(0.05);
    }
  });

  it('confidence modulates quad opacity of a value-coloured point', () => {
    const sure = colorOf(point({ confidence: 0.95, valuePerM3: SURVEY_OVERLAY_VALUE_CEIL }));
    const unsure = colorOf(point({ confidence: 0.3, valuePerM3: SURVEY_OVERLAY_VALUE_CEIL }));
    expect(sure[3]).toBeGreaterThan(unsure[3]);
    expect(unsure[3]).toBeGreaterThan(0);
  });
});
