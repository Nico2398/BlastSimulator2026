// VehicleAlertPictograms — canvas glyph path (#2226). Node has no 2D canvas, so the factory is faked.

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

const calls: string[] = [];

vi.mock('../../../src/renderer/createCanvas2d.js', () => {
  const ctx = new Proxy({}, {
    get: (_t, prop: string) => (...args: unknown[]) => { calls.push(`${prop}:${args.length}`); },
    set: () => true,
  });
  return { createCanvas2d: () => ({ canvas: { width: 128, height: 128 }, ctx }) };
});

import { VehicleAlertPictograms } from '../../../src/renderer/VehicleAlertPictograms.js';

describe('VehicleAlertPictograms canvas glyphs', () => {
  it('draws a textured glyph per kind and disposes it', () => {
    const pictograms = new VehicleAlertPictograms(new THREE.Scene(), new THREE.PerspectiveCamera());
    // a triangle path for broken (moveTo) and an arc for stuck
    expect(calls.some(c => c.startsWith('moveTo'))).toBe(true);
    expect(calls.some(c => c.startsWith('arc'))).toBe(true);
    expect(calls.filter(c => c.startsWith('fillRect')).length).toBeGreaterThanOrEqual(3);
    expect(() => pictograms.dispose()).not.toThrow();
  });
});
