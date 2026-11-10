// BlastSimulator2026 — projection risk zone overlay: a tint over the columns a dry run throws rock from (#2201)
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ProjectionZoneOverlay } from '../../../src/renderer/ProjectionZoneOverlay.js';

function setup(surface: (x: number, z: number) => number = () => 5) {
  const scene = new THREE.Scene();
  return { scene, overlay: new ProjectionZoneOverlay(scene, surface) };
}

function meshOf(scene: THREE.Scene): THREE.Mesh | undefined {
  let m: THREE.Mesh | undefined;
  scene.traverse(o => { if (o instanceof THREE.Mesh) m = o; });
  return m;
}

/** Grid cells ("x,z") that carry a vertex of the layer, read from its positions. */
function cells(scene: THREE.Scene): Set<string> {
  const out = new Set<string>();
  const m = meshOf(scene);
  if (!m) return out;
  const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos) return out;
  for (let i = 0; i < pos.count; i++) {
    out.add(`${Math.floor(pos.getX(i) - 1e-6)},${Math.floor(pos.getZ(i) - 1e-6)}`);
  }
  return out;
}

describe('ProjectionZoneOverlay', () => {
  it('adds a mesh to the scene and starts hidden', () => {
    const { scene } = setup();
    expect(meshOf(scene)).toBeDefined();
    expect(meshOf(scene)!.visible).toBe(false);
  });

  it('show() makes the layer visible when there are columns', () => {
    const { scene, overlay } = setup();
    overlay.show([{ x: 5, z: 5 }]);
    expect(meshOf(scene)!.visible).toBe(true);
  });

  it('show() tints each column given and nothing else', () => {
    const { scene, overlay } = setup();
    overlay.show([{ x: 5, z: 5 }, { x: 6, z: 5 }, { x: 8, z: 9 }]);
    const painted = cells(scene);
    expect(painted.has('5,5')).toBe(true);
    expect(painted.has('6,5')).toBe(true);
    expect(painted.has('8,9')).toBe(true);
    expect(painted.has('9,9')).toBe(false);
    expect(painted.has('5,6')).toBe(false);
  });

  it('show() again replaces the earlier columns instead of adding to them', () => {
    const { scene, overlay } = setup();
    overlay.show([{ x: 5, z: 5 }, { x: 6, z: 6 }]);
    overlay.show([{ x: 5, z: 5 }]);
    const painted = cells(scene);
    expect(painted.has('6,6')).toBe(false);
    expect(painted.has('5,5')).toBe(true);
  });

  it('show([]) hides the layer and leaves nothing painted', () => {
    const { scene, overlay } = setup();
    overlay.show([{ x: 5, z: 5 }]);
    overlay.show([]);
    expect(meshOf(scene)!.visible).toBe(false);
    expect(cells(scene).size).toBe(0);
  });

  it('show([]) on a fresh overlay stays hidden', () => {
    const { scene, overlay } = setup();
    overlay.show([]);
    expect(meshOf(scene)!.visible).toBe(false);
  });

  it('hide() hides the layer, and a later show() brings it back', () => {
    const { scene, overlay } = setup();
    overlay.show([{ x: 5, z: 5 }]);
    overlay.hide();
    expect(meshOf(scene)!.visible).toBe(false);
    overlay.show([{ x: 5, z: 5 }]);
    expect(meshOf(scene)!.visible).toBe(true);
  });

  it('hide() before any show() does not throw', () => {
    expect(() => setup().overlay.hide()).not.toThrow();
  });

  it('follows the terrain: patches sit near the surface height the sampler gives', () => {
    const { scene, overlay } = setup((x) => 3 + x * 0.5);
    overlay.show([{ x: 5, z: 5 }]);
    const pos = meshOf(scene)!.geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(pos.count).toBeGreaterThan(0);
    for (let i = 0; i < pos.count; i++) {
      const surface = 3 + pos.getX(i) * 0.5;
      expect(pos.getY(i)).toBeGreaterThanOrEqual(surface);
      expect(pos.getY(i) - surface).toBeLessThan(1);
    }
  });

  it('dispose() removes the mesh from the scene', () => {
    const { scene, overlay } = setup();
    overlay.show([{ x: 5, z: 5 }]);
    overlay.dispose();
    expect(meshOf(scene)).toBeUndefined();
  });
});
