// ProceduralTexture — unit tests

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { sampleRockColor, applyProceduralColors, createRockMaterial } from '../../../src/renderer/ProceduralTexture.js';

describe('sampleRockColor', () => {
  it('returns a valid THREE.Color for known rock type', () => {
    const c = sampleRockColor('sandite', 10, 5, 8);
    expect(c).toBeInstanceOf(THREE.Color);
    expect(c.r).toBeGreaterThanOrEqual(0);
    expect(c.r).toBeLessThanOrEqual(1);
    expect(c.g).toBeGreaterThanOrEqual(0);
    expect(c.b).toBeGreaterThanOrEqual(0);
  });

  it('returns a valid color for unknown rock type (falls back gracefully)', () => {
    const c = sampleRockColor('unknown_rock', 0, 0, 0);
    expect(c).toBeInstanceOf(THREE.Color);
    expect(c.r).toBeGreaterThanOrEqual(0);
  });

  it('is spatially coherent — nearby positions give similar colors', () => {
    const c1 = sampleRockColor('molite', 10.0, 5.0, 8.0);
    const c2 = sampleRockColor('molite', 10.1, 5.0, 8.0);
    // Colors at close positions should be very similar (low-frequency noise)
    const diff = Math.abs(c1.r - c2.r) + Math.abs(c1.g - c2.g) + Math.abs(c1.b - c2.b);
    expect(diff).toBeLessThan(0.1);
  });

  it('different rock types give different base colors at same position', () => {
    const c1 = sampleRockColor('cruite', 5, 5, 5);    // light beige
    const c2 = sampleRockColor('titanite', 5, 5, 5);  // very dark
    // cruite is light, titanite is very dark — should be clearly different
    const brightness1 = (c1.r + c1.g + c1.b) / 3;
    const brightness2 = (c2.r + c2.g + c2.b) / 3;
    expect(Math.abs(brightness1 - brightness2)).toBeGreaterThan(0.1);
  });

  it('is deterministic — same inputs give same output', () => {
    const c1 = sampleRockColor('stubite', 7.5, 3.2, 14.8);
    const c2 = sampleRockColor('stubite', 7.5, 3.2, 14.8);
    expect(c1.r).toBeCloseTo(c2.r, 6);
    expect(c1.g).toBeCloseTo(c2.g, 6);
    expect(c1.b).toBeCloseTo(c2.b, 6);
  });
});

describe('applyProceduralColors', () => {
  it('adds color attribute to geometry', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    applyProceduralColors(geo, 'sandite');
    const colorAttr = geo.getAttribute('color');
    expect(colorAttr).toBeDefined();
    expect(colorAttr.count).toBe(geo.getAttribute('position').count);
  });

  it('color values are in [0,1] range', () => {
    const geo = new THREE.SphereGeometry(1, 4, 4);
    applyProceduralColors(geo, 'clunkite', new THREE.Vector3(10, 20, 30));
    const colorAttr = geo.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < colorAttr.count; i++) {
      expect(colorAttr.getX(i)).toBeGreaterThanOrEqual(0);
      expect(colorAttr.getX(i)).toBeLessThanOrEqual(1);
      expect(colorAttr.getY(i)).toBeGreaterThanOrEqual(0);
      expect(colorAttr.getZ(i)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('createRockMaterial', () => {
  it('returns a MeshPhongMaterial with vertexColors enabled', () => {
    const mat = createRockMaterial();
    expect(mat).toBeInstanceOf(THREE.MeshPhongMaterial);
    expect(mat.vertexColors).toBe(true);
    mat.dispose();
  });
});
