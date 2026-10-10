// CloudMaterial — cartoon cloud bands and per-weather palettes (#1602)

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  CLOUD_PALETTE, createCloudMaterial, lerpCloudPalette,
} from '../../../../src/renderer/ambient/CloudMaterial.js';
import { createOutlineMaterial } from '../../../../src/renderer/models/CartoonMaterial.js';

function luminance(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function uniformColor(material: THREE.ShaderMaterial, name: string): THREE.Color {
  return material.uniforms[name]!.value as THREE.Color;
}

function expectColor(actual: THREE.Color, expected: THREE.Color): void {
  expect(actual.r).toBeCloseTo(expected.r, 6);
  expect(actual.g).toBeCloseTo(expected.g, 6);
  expect(actual.b).toBeCloseTo(expected.b, 6);
}

describe('CLOUD_PALETTE', () => {
  it('paints every weather state lit > shade > belly, so each cloud keeps readable toon bands', () => {
    for (const palette of Object.values(CLOUD_PALETTE)) {
      expect(luminance(palette.lit)).toBeGreaterThan(luminance(palette.shade));
      expect(luminance(palette.shade)).toBeGreaterThan(luminance(palette.belly));
      expect(luminance(palette.belly)).toBeGreaterThan(luminance(palette.outline));
    }
  });

  it('darkens as the weather worsens, storm the darkest', () => {
    const lit = (state: keyof typeof CLOUD_PALETTE) => luminance(CLOUD_PALETTE[state].lit);
    expect(lit('sunny')).toBeGreaterThan(lit('cloudy'));
    expect(lit('cloudy')).toBeGreaterThan(lit('light_rain'));
    expect(lit('heavy_rain')).toBeGreaterThan(lit('storm'));
    for (const state of Object.keys(CLOUD_PALETTE) as Array<keyof typeof CLOUD_PALETTE>) {
      if (state !== 'storm') expect(lit(state)).toBeGreaterThan(lit('storm'));
    }
  });
});

describe('createCloudMaterial', () => {
  it('builds an opaque shader carrying the starting palette and a unit sun direction', () => {
    const m = createCloudMaterial(CLOUD_PALETTE.cloudy);
    expect(m.transparent).toBe(false);
    expect(m.depthWrite).toBe(true);
    expect(uniformColor(m, 'uLit').equals(CLOUD_PALETTE.cloudy.lit)).toBe(true);
    expect(uniformColor(m, 'uBelly').equals(CLOUD_PALETTE.cloudy.belly)).toBe(true);
    expect((m.uniforms['uSunDir']!.value as THREE.Vector3).length()).toBeCloseTo(1, 6);
    expect(m.fragmentShader).toContain('fwidth');
  });

  it('copies the palette rather than aliasing it, so recolouring never edits the shared constant', () => {
    const before = CLOUD_PALETTE.sunny.lit.clone();
    const m = createCloudMaterial(CLOUD_PALETTE.sunny);
    uniformColor(m, 'uLit').set(0x000000);
    expect(CLOUD_PALETTE.sunny.lit.equals(before)).toBe(true);
  });
});

describe('lerpCloudPalette', () => {
  it('snaps the surface bands and the outline colour to the target at t = 1', () => {
    const surface = createCloudMaterial(CLOUD_PALETTE.sunny);
    const outline = createOutlineMaterial();
    lerpCloudPalette(surface, outline, CLOUD_PALETTE.storm, 1);
    expectColor(uniformColor(surface, 'uLit'), CLOUD_PALETTE.storm.lit);
    expectColor(uniformColor(surface, 'uShade'), CLOUD_PALETTE.storm.shade);
    expectColor(uniformColor(surface, 'uBelly'), CLOUD_PALETTE.storm.belly);
    expectColor(uniformColor(outline, 'color'), CLOUD_PALETTE.storm.outline);
  });

  it('leaves every colour untouched at t = 0', () => {
    const surface = createCloudMaterial(CLOUD_PALETTE.sunny);
    const outline = createOutlineMaterial();
    const outlineBefore = uniformColor(outline, 'color').clone();
    lerpCloudPalette(surface, outline, CLOUD_PALETTE.storm, 0);
    expect(uniformColor(surface, 'uLit').equals(CLOUD_PALETTE.sunny.lit)).toBe(true);
    expect(uniformColor(outline, 'color').equals(outlineBefore)).toBe(true);
  });

  it('moves part of the way at 0 < t < 1', () => {
    const surface = createCloudMaterial(CLOUD_PALETTE.sunny);
    const outline = createOutlineMaterial();
    lerpCloudPalette(surface, outline, CLOUD_PALETTE.storm, 0.5);
    const mid = luminance(uniformColor(surface, 'uLit'));
    expect(mid).toBeLessThan(luminance(CLOUD_PALETTE.sunny.lit));
    expect(mid).toBeGreaterThan(luminance(CLOUD_PALETTE.storm.lit));
  });
});
