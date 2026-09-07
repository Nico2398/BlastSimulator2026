// CartoonMaterial — toon ramp and outline hull materials

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  createOutlineMaterial, createToonMaterial, toonGradient, OUTLINE_UNIFORMS,
} from '../../../../src/renderer/models/CartoonMaterial.js';

describe('toonGradient', () => {
  it('is a shared, nearest-filtered ramp that rises monotonically to full light', () => {
    const g = toonGradient();
    expect(toonGradient()).toBe(g);
    expect(g.magFilter).toBe(THREE.NearestFilter);
    const data = g.image.data as Uint8Array;
    const steps: number[] = [];
    for (let i = 0; i < g.image.width; i++) steps.push(data[i * 4]!);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeGreaterThanOrEqual(steps[i - 1]!);
    expect(steps[0]).toBeGreaterThan(0);
    expect(steps[steps.length - 1]).toBe(255);
  });
});

describe('createToonMaterial', () => {
  it('builds a MeshToonMaterial carrying the ramp, colour, emissive and vertex-colour flag', () => {
    const m = createToonMaterial({
      color: new THREE.Color(0x2266ff), emissive: new THREE.Color(0x102030), vertexColors: true, name: 'painted',
    });
    expect(m).toBeInstanceOf(THREE.MeshToonMaterial);
    expect(m.gradientMap).toBe(toonGradient());
    expect(m.color.getHex()).toBe(0x2266ff);
    expect(m.emissive.getHex()).toBe(0x102030);
    expect(m.vertexColors).toBe(true);
    expect(m.name).toBe('painted');
  });

  it('defaults to white, no emissive, no vertex colours', () => {
    const m = createToonMaterial();
    expect(m.color.getHex()).toBe(0xffffff);
    expect(m.emissive.getHex()).toBe(0x000000);
    expect(m.vertexColors).toBe(false);
  });
});

describe('createOutlineMaterial', () => {
  it('draws back faces only and reads the shared viewport-height uniform', () => {
    const m = createOutlineMaterial();
    expect(m.side).toBe(THREE.BackSide);
    expect(m.uniforms['viewportHeight']).toBe(OUTLINE_UNIFORMS.viewportHeight);
    OUTLINE_UNIFORMS.viewportHeight.value = 1080;
    expect(m.uniforms['viewportHeight']!.value).toBe(1080);
    expect(m.vertexShader).toContain('thicknessPx');
    expect(m.vertexShader).toContain('maxWorld');
  });
});
