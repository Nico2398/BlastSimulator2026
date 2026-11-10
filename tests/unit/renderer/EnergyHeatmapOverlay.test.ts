// BlastSimulator2026 — top-down energy heatmap overlay: one ground patch per column (#2200)
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EnergyHeatmapOverlay, columnPatch } from '../../../src/renderer/EnergyHeatmapOverlay.js';
import type { ColumnBandSummary } from '../../../src/core/mining/EnergyHeatmap.js';
import { FRAGMENTATION_BANDS, FRAGMENTATION_BAND_COLORS, type FragmentationBand } from '../../../src/core/mining/FragmentationBand.js';
import { HEATMAP_OVERLAY_OPACITY } from '../../../src/core/config/balance.js';

function column(x: number, z: number, band: FragmentationBand, over: Partial<ColumnBandSummary> = {}): ColumnBandSummary {
  const counts = { intact: 0, cracked: 0, coarse: 0, good: 0, fines: 0, dust: 0 };
  counts[band] = 4;
  return { x, z, band, worstBand: band, goodShare: band === 'good' ? 1 : 0, maxIntensity: 1, counts, ...over };
}

const hexOf = (color: THREE.Color | number): number => new THREE.Color(color).getHex();

describe('columnPatch', () => {
  it('is a single-cell patch at the column\'s (x, z)', () => {
    const patch = columnPatch(column(7, 12, 'good'));
    expect(patch.shape).toEqual({ kind: 'cell', x: 7, z: 12 });
  });

  it('takes the colour token of the column\'s displayed band', () => {
    for (const band of FRAGMENTATION_BANDS) {
      expect(hexOf(columnPatch(column(1, 1, band)).color), band).toBe(FRAGMENTATION_BAND_COLORS[band]);
    }
  });

  it('colours by the displayed band, not the worst band', () => {
    const patch = columnPatch(column(3, 3, 'good', { worstBand: 'dust' }));
    expect(hexOf(patch.color)).toBe(FRAGMENTATION_BAND_COLORS.good);
  });

  it('carries HEATMAP_OVERLAY_OPACITY', () => {
    expect(columnPatch(column(1, 1, 'fines')).opacity).toBe(HEATMAP_OVERLAY_OPACITY);
    expect(HEATMAP_OVERLAY_OPACITY).toBeGreaterThan(0);
    expect(HEATMAP_OVERLAY_OPACITY).toBeLessThanOrEqual(1);
  });

  it('has an id per column: stable for one column, distinct across columns', () => {
    const a = columnPatch(column(4, 5, 'good')).id;
    expect(columnPatch(column(4, 5, 'dust')).id).toBe(a);
    const others = [columnPatch(column(5, 4, 'good')).id, columnPatch(column(4, 6, 'good')).id, columnPatch(column(14, 5, 'good')).id, columnPatch(column(4, 15, 'good')).id];
    expect(new Set([a, ...others]).size).toBe(5);
  });

  it('keeps ids of (1, 23) and (12, 3) apart', () => {
    expect(columnPatch(column(1, 23, 'good')).id).not.toBe(columnPatch(column(12, 3, 'good')).id);
  });
});

function setup(surface: (x: number, z: number) => number = () => 5) {
  const scene = new THREE.Scene();
  return { scene, overlay: new EnergyHeatmapOverlay(scene, surface) };
}

function meshOf(scene: THREE.Scene): THREE.Mesh | undefined {
  let m: THREE.Mesh | undefined;
  scene.traverse(o => { if (o instanceof THREE.Mesh) m = o; });
  return m;
}

/** Colour painted on each grid cell ("x,z"), read from the layer's vertices (same probe as WallStabilityOverlay.test). */
function cellColors(scene: THREE.Scene): Map<string, THREE.Color> {
  const out = new Map<string, THREE.Color>();
  const m = meshOf(scene);
  if (!m) return out;
  const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const col = m.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!pos || !col) return out;
  for (let i = 0; i < pos.count; i++) {
    out.set(`${Math.floor(pos.getX(i) - 1e-6)},${Math.floor(pos.getZ(i) - 1e-6)}`, new THREE.Color(col.getX(i), col.getY(i), col.getZ(i)));
  }
  return out;
}

const near = (a: THREE.Color, b: THREE.Color): boolean => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 0.05;

describe('EnergyHeatmapOverlay', () => {
  it('adds a mesh to the scene and starts hidden', () => {
    const { scene } = setup();
    expect(meshOf(scene)).toBeDefined();
    expect(meshOf(scene)!.visible).toBe(false);
  });

  it('show() makes the layer visible', () => {
    const { scene, overlay } = setup();
    overlay.show([column(5, 5, 'good')]);
    expect(meshOf(scene)!.visible).toBe(true);
  });

  it('show() paints one cell per column in that column\'s band colour', () => {
    const { scene, overlay } = setup();
    overlay.show([column(5, 5, 'good'), column(6, 5, 'dust'), column(5, 6, 'intact'), column(7, 7, 'fines'), column(8, 8, 'cracked')]);
    const cells = cellColors(scene);
    expect(near(cells.get('5,5')!, new THREE.Color(FRAGMENTATION_BAND_COLORS.good))).toBe(true);
    expect(near(cells.get('6,5')!, new THREE.Color(FRAGMENTATION_BAND_COLORS.dust))).toBe(true);
    expect(near(cells.get('5,6')!, new THREE.Color(FRAGMENTATION_BAND_COLORS.intact))).toBe(true);
    expect(near(cells.get('7,7')!, new THREE.Color(FRAGMENTATION_BAND_COLORS.fines))).toBe(true);
    expect(near(cells.get('8,8')!, new THREE.Color(FRAGMENTATION_BAND_COLORS.cracked))).toBe(true);
  });

  it('paints nothing for a column that was not given', () => {
    const { scene, overlay } = setup();
    overlay.show([column(5, 5, 'good')]);
    expect(cellColors(scene).has('9,9')).toBe(false);
  });

  it('show() again replaces the earlier columns instead of adding to them', () => {
    const { scene, overlay } = setup();
    overlay.show([column(5, 5, 'good'), column(6, 6, 'good')]);
    overlay.show([column(5, 5, 'dust')]);
    const cells = cellColors(scene);
    expect(cells.has('6,6')).toBe(false);
    expect(near(cells.get('5,5')!, new THREE.Color(FRAGMENTATION_BAND_COLORS.dust))).toBe(true);
  });

  it('hide() hides the layer, and a later show() brings it back', () => {
    const { scene, overlay } = setup();
    overlay.show([column(5, 5, 'good')]);
    overlay.hide();
    expect(meshOf(scene)!.visible).toBe(false);
    overlay.show([column(5, 5, 'good')]);
    expect(meshOf(scene)!.visible).toBe(true);
  });

  it('hide() before any show() does not throw', () => {
    expect(() => setup().overlay.hide()).not.toThrow();
  });

  it('show([]) leaves nothing painted', () => {
    const { scene, overlay } = setup();
    overlay.show([column(5, 5, 'good')]);
    overlay.show([]);
    expect(cellColors(scene).size).toBe(0);
  });

  it('follows the terrain: patches sit near the surface height the sampler gives', () => {
    const { scene, overlay } = setup((x) => 3 + x * 0.5);
    overlay.show([column(5, 5, 'good')]);
    const pos = meshOf(scene)!.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const surface = 3 + pos.getX(i) * 0.5;
      expect(pos.getY(i)).toBeGreaterThanOrEqual(surface);
      expect(pos.getY(i) - surface).toBeLessThan(1);
    }
  });

  it('dispose() removes the mesh from the scene', () => {
    const { scene, overlay } = setup();
    overlay.show([column(5, 5, 'good')]);
    overlay.dispose();
    expect(meshOf(scene)).toBeUndefined();
  });
});
