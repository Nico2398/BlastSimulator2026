// FragmentTransformMath — unit tests (#485 code review: previously zero direct
// coverage of the module that owns the "settled fragment is bit-identical to
// its spawn transform" invariant).

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  seedUnit,
  spawnOrientation,
  spawnShear,
  normalizeOrFallback,
  tumbleAxis,
  buildBaseTransform,
  composeInstanceMatrix,
} from '../../../src/renderer/FragmentTransformMath.js';

describe('seedUnit', () => {
  it('is deterministic for the same seed and salt', () => {
    expect(seedUnit(7, 2)).toBe(seedUnit(7, 2));
  });

  it('varies with the seed', () => {
    expect(seedUnit(1, 2)).not.toBe(seedUnit(2, 2));
  });

  it('varies with the salt', () => {
    expect(seedUnit(7, 1)).not.toBe(seedUnit(7, 2));
  });

  it('stays in [0, 1) — it is `x - Math.floor(x)`, a fractional part', () => {
    for (let seed = 0; seed < 200; seed++) {
      const v = seedUnit(seed, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('spawnOrientation', () => {
  it('is deterministic per shapeSeed', () => {
    const a = spawnOrientation(5);
    const b = spawnOrientation(5);
    expect(a.x).toBeCloseTo(b.x, 10);
    expect(a.y).toBeCloseTo(b.y, 10);
    expect(a.z).toBeCloseTo(b.z, 10);
    expect(a.w).toBeCloseTo(b.w, 10);
  });

  it('differs between shape seeds (spot check)', () => {
    const a = spawnOrientation(1);
    const b = spawnOrientation(2);
    const same = Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9
      && Math.abs(a.z - b.z) < 1e-9 && Math.abs(a.w - b.w) < 1e-9;
    expect(same).toBe(false);
  });
});

describe('spawnShear', () => {
  it('is deterministic per shapeSeed', () => {
    const a = spawnShear(9).elements;
    const b = spawnShear(9).elements;
    expect(a).toEqual(b);
  });

  it('differs between shape seeds (spot check)', () => {
    const a = spawnShear(1).elements;
    const b = spawnShear(2).elements;
    expect(a).not.toEqual(b);
  });

  it('only sets the three documented off-diagonal shear entries', () => {
    const e = spawnShear(3).elements;
    for (let i = 0; i < 16; i++) {
      if (i === 4 || i === 8 || i === 9) continue;
      // Matrix4 starts as identity; untouched entries keep the identity value.
      const identity = i === 0 || i === 5 || i === 10 || i === 15 ? 1 : 0;
      expect(e[i]).toBe(identity);
    }
  });
});

describe('normalizeOrFallback', () => {
  it('normalizes a well-defined vector to unit length', () => {
    const v = new THREE.Vector3(3, 0, 4);
    const out = normalizeOrFallback(v, new THREE.Vector3(0, 1, 0));
    expect(out.length()).toBeCloseTo(1, 10);
    expect(out.x).toBeCloseTo(0.6, 10);
    expect(out.y).toBeCloseTo(0, 10);
    expect(out.z).toBeCloseTo(0.8, 10);
  });

  it('falls back rather than normalizing a near-zero vector', () => {
    const fallback = new THREE.Vector3(0, 1, 0);
    const out = normalizeOrFallback(new THREE.Vector3(1e-6, 1e-6, 1e-6), fallback);
    expect(out).toBe(fallback);
    expect(out.x).toBe(0);
    expect(out.y).toBe(1);
    expect(out.z).toBe(0);
  });

  it('falls back on the exact zero vector rather than producing NaN', () => {
    const fallback = new THREE.Vector3(0, 1, 0);
    const out = normalizeOrFallback(new THREE.Vector3(0, 0, 0), fallback);
    expect(out).toBe(fallback);
    expect(Number.isNaN(out.x)).toBe(false);
  });
});

describe('tumbleAxis', () => {
  it('returns a unit-length vector for a typical seed', () => {
    const axis = tumbleAxis(42);
    expect(axis.length()).toBeCloseTo(1, 10);
  });

  it('is deterministic per shapeSeed', () => {
    expect(tumbleAxis(11).toArray()).toEqual(tumbleAxis(11).toArray());
  });

  it('varies between shape seeds (spot check)', () => {
    expect(tumbleAxis(1).toArray()).not.toEqual(tumbleAxis(2).toArray());
  });
});

describe('buildBaseTransform', () => {
  it('returns a consistent {rs, axis} for the same shapeSeed', () => {
    const scale = new THREE.Vector3(2, 3, 4);
    const a = buildBaseTransform(6, scale);
    const b = buildBaseTransform(6, scale);
    expect(a.rs.elements).toEqual(b.rs.elements);
    expect(a.axis.toArray()).toEqual(b.axis.toArray());
  });

  it('rs folds in the supplied scale — a bigger scale means bigger basis columns', () => {
    const small = buildBaseTransform(6, new THREE.Vector3(1, 1, 1));
    const big = buildBaseTransform(6, new THREE.Vector3(2, 2, 2));
    const colLen = (m: THREE.Matrix4) => Math.hypot(m.elements[0]!, m.elements[1]!, m.elements[2]!);
    expect(colLen(big.rs)).toBeCloseTo(colLen(small.rs) * 2, 6);
  });
});

describe('composeInstanceMatrix', () => {
  it('identity tumble/settle reproduces the same matrix as a fresh call with the same inputs (settled === spawn, #485 invariant)', () => {
    // FragmentMesh.spawnFragments composes the spawn matrix as
    // composeInstanceMatrix(base, position, 0, {1,1,1}, out) — a "settled"
    // fragment (tumbleAngle 0, settleScale identity) at the same position
    // must be bit-identical to that spawn call.
    const base = buildBaseTransform(17, new THREE.Vector3(1.5, 0.4, 0.9));
    const position = { x: 5, y: 2, z: -3 };
    const identityScale = { x: 1, y: 1, z: 1 };

    const spawnMtx = new THREE.Matrix4();
    composeInstanceMatrix(base, position, 0, identityScale, spawnMtx);

    const settledMtx = new THREE.Matrix4();
    composeInstanceMatrix(base, position, 0, identityScale, settledMtx);

    expect(settledMtx.elements).toEqual(spawnMtx.elements);
  });

  it('reduces to T(position) · base.rs when tumbleAngle is 0 and settleScale is identity', () => {
    const base = buildBaseTransform(23, new THREE.Vector3(1, 1, 1));
    const position = { x: 1, y: 2, z: 3 };

    const out = new THREE.Matrix4();
    composeInstanceMatrix(base, position, 0, { x: 1, y: 1, z: 1 }, out);

    const expected = base.rs.clone();
    expected.setPosition(position.x, position.y, position.z);

    expect(out.elements).toEqual(expected.elements);
  });

  it('a non-zero tumbleAngle produces a different matrix than the settled case', () => {
    const base = buildBaseTransform(23, new THREE.Vector3(1, 1, 1));
    const position = { x: 1, y: 2, z: 3 };
    const identityScale = { x: 1, y: 1, z: 1 };

    const settled = new THREE.Matrix4();
    composeInstanceMatrix(base, position, 0, identityScale, settled);

    const tumbled = new THREE.Matrix4();
    composeInstanceMatrix(base, position, Math.PI / 3, identityScale, tumbled);

    expect(tumbled.elements).not.toEqual(settled.elements);
  });

  it('a non-identity settleScale produces a different matrix than the settled case', () => {
    const base = buildBaseTransform(23, new THREE.Vector3(1, 1, 1));
    const position = { x: 1, y: 2, z: 3 };

    const settled = new THREE.Matrix4();
    composeInstanceMatrix(base, position, 0, { x: 1, y: 1, z: 1 }, settled);

    const squashed = new THREE.Matrix4();
    composeInstanceMatrix(base, position, 0, { x: 1.1, y: 0.8, z: 1.1 }, squashed);

    expect(squashed.elements).not.toEqual(settled.elements);
  });

  it('writes into the supplied out matrix rather than allocating a new one', () => {
    const base = buildBaseTransform(23, new THREE.Vector3(1, 1, 1));
    const out = new THREE.Matrix4();
    const result = composeInstanceMatrix(base, { x: 0, y: 0, z: 0 }, 0, { x: 1, y: 1, z: 1 }, out);
    expect(result).toBeUndefined();
    // out itself was mutated — its position column now reflects the call.
    expect(out.elements[12]).toBe(0);
  });
});
