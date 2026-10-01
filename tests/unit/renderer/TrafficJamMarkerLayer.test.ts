// BlastSimulator2026 — TrafficJamMarkerLayer: one ground marker per active jam (#1208)

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { TrafficJamMarkerLayer } from '../../../src/renderer/TrafficJamMarkerLayer.js';
import type { TrafficJam } from '../../../src/core/events/TrafficJams.js';

const flat = (): number => 3;

function jam(key: string, x = 10.5, z = 10.5): TrafficJam {
  return { key, kind: 'ramp_head', rampId: 1, x, z, agentIds: [1, 2, 3], vehicleCount: 2 };
}

describe('TrafficJamMarkerLayer', () => {
  it('adds no children for an empty jam list', () => {
    const scene = new THREE.Scene();
    const layer = new TrafficJamMarkerLayer(scene, flat);
    layer.sync([]);
    expect(scene.children).toHaveLength(0);
  });

  it('adds one marker per jam key', () => {
    const scene = new THREE.Scene();
    const layer = new TrafficJamMarkerLayer(scene, flat);
    layer.sync([jam('ramp:1'), jam('passage:40,40', 40.5, 40.5)]);
    expect(scene.children).toHaveLength(2);
  });

  it('places a marker at the jam position, above the sampled surface', () => {
    const scene = new THREE.Scene();
    const layer = new TrafficJamMarkerLayer(scene, flat);
    layer.sync([jam('ramp:1', 12.5, 20.5)]);
    const box = new THREE.Box3().setFromObject(scene.children[0]!);
    const centre = box.getCenter(new THREE.Vector3());
    expect(centre.x).toBeCloseTo(12.5, 0);
    expect(centre.z).toBeCloseTo(20.5, 0);
    expect(box.max.y).toBeGreaterThanOrEqual(3);
  });

  it('is idempotent: syncing the same jams keeps the same marker objects', () => {
    const scene = new THREE.Scene();
    const layer = new TrafficJamMarkerLayer(scene, flat);
    layer.sync([jam('ramp:1')]);
    const first = scene.children[0];
    layer.sync([jam('ramp:1')]);
    layer.sync([jam('ramp:1')]);
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]).toBe(first);
  });

  it('removes the marker when its jam is gone, keeping the others', () => {
    const scene = new THREE.Scene();
    const layer = new TrafficJamMarkerLayer(scene, flat);
    layer.sync([jam('ramp:1'), jam('ramp:2')]);
    layer.sync([jam('ramp:2')]);
    expect(scene.children).toHaveLength(1);
    layer.sync([]);
    expect(scene.children).toHaveLength(0);
  });

  it('dispose removes every marker and is safe to call twice', () => {
    const scene = new THREE.Scene();
    const layer = new TrafficJamMarkerLayer(scene, flat);
    layer.sync([jam('ramp:1'), jam('ramp:2'), jam('ramp:3')]);
    layer.dispose();
    expect(scene.children).toHaveLength(0);
    expect(() => layer.dispose()).not.toThrow();
  });

  it('can sync again after dispose', () => {
    const scene = new THREE.Scene();
    const layer = new TrafficJamMarkerLayer(scene, flat);
    layer.sync([jam('ramp:1')]);
    layer.dispose();
    layer.sync([jam('ramp:1')]);
    expect(scene.children).toHaveLength(1);
  });

  it('count reflects the number of markers drawn', () => {
    const layer = new TrafficJamMarkerLayer(new THREE.Scene(), flat);
    expect(layer.count).toBe(0);
    layer.sync([jam('ramp:1'), jam('ramp:2')]);
    expect(layer.count).toBe(2);
    layer.sync([jam('ramp:2')]);
    expect(layer.count).toBe(1);
  });

  it('pulses the ring scale on render', () => {
    const scene = new THREE.Scene();
    const layer = new TrafficJamMarkerLayer(scene, flat);
    layer.sync([jam('ramp:1')]);
    const ring = (scene.children[0] as THREE.Group).children[0] as THREE.Mesh;
    vi.spyOn(performance, 'now').mockReturnValue(225); // quarter period: sin = 1
    ring.onBeforeRender({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    expect(ring.scale.x).toBeCloseTo(1.18, 5);
  });

  describe('with a 2D canvas available', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    function stubDocument(ctx: unknown): void {
      vi.stubGlobal('document', {
        createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
      });
    }

    it('draws the label onto a canvas texture and disposes it on removal', () => {
      const fillText = vi.fn();
      stubDocument({ fillStyle: '', font: '', textAlign: '', textBaseline: '', fillRect: vi.fn(), fillText });
      const scene = new THREE.Scene();
      const layer = new TrafficJamMarkerLayer(scene, flat);
      layer.sync([jam('ramp:1')]);
      expect(fillText).toHaveBeenCalledTimes(1);
      const label = (scene.children[0] as THREE.Group).children[1] as THREE.Mesh;
      const map = (label.material as THREE.MeshBasicMaterial).map;
      expect(map).toBeInstanceOf(THREE.CanvasTexture);
      const disposed = vi.fn();
      map!.addEventListener('dispose', disposed);
      layer.sync([]);
      expect(disposed).toHaveBeenCalledTimes(1);
    });

    it('falls back to a flat colour when the canvas has no 2D context', () => {
      stubDocument(null);
      const scene = new THREE.Scene();
      const layer = new TrafficJamMarkerLayer(scene, flat);
      layer.sync([jam('ramp:1')]);
      const label = (scene.children[0] as THREE.Group).children[1] as THREE.Mesh;
      expect((label.material as THREE.MeshBasicMaterial).map).toBeNull();
    });
  });
});
