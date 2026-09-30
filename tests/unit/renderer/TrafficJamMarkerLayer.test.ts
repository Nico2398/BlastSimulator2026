// BlastSimulator2026 — TrafficJamMarkerLayer: one ground marker per active jam (#1208)

import { describe, it, expect } from 'vitest';
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
});
