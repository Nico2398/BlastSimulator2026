// BlastSimulator2026 — RampArrow unit tests (#1211)
//
// The arrow shows the ramp that will actually be dug: tail on the origin
// (upper end), tip on the last carved step (origin + direction × (length−1)),
// along the snapped cardinal axis, inside a RAMP_WIDTH-wide corridor.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  rampArrowLayout, buildRampArrow, RampArrowLayer, RAMP_ARROW_COLOR, RAMP_ARROW_RENDER_ORDER,
} from '../../../src/renderer/RampArrow.js';
import { GHOST_RENDER_ORDER } from '../../../src/renderer/GhostMesh.js';
import { RAMP_WIDTH, rampDefFromEndpoints } from '../../../src/core/mining/Ramp.js';
import { isSceneOverlay } from '../../../src/renderer/post/SceneOverlay.js';

const flat = (): number => 0;

function bodyVertices(group: THREE.Group): THREE.Vector3[] {
  const body = group.getObjectByName('ramp-arrow-body') as THREE.Mesh;
  const pos = body.geometry.getAttribute('position') as THREE.BufferAttribute;
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(pos, i));
  return out;
}

describe('rampArrowLayout()', () => {
  it('puts the tail on the origin tile and the tip on the last dug tile (tutorial box cut)', () => {
    const layout = rampArrowLayout({ originX: 16, originZ: 19, direction: 'south', length: 12 })!;
    expect(layout.tail).toEqual({ x: 16, z: 19 });
    expect(layout.tip).toEqual({ x: 16, z: 30 });
    expect(layout.dir).toEqual({ dx: 0, dz: 1 });
  });

  it('follows the snapped axis of a diagonal drag, not the raw diagonal', () => {
    const def = rampDefFromEndpoints(10, 10, 13, 20, 4);
    const layout = rampArrowLayout(def)!;
    expect(layout.tail).toEqual({ x: 10, z: 10 });
    expect(layout.tip).toEqual({ x: 10, z: 19 });
  });

  it.each([
    ['north', { x: 5, z: -1 }],
    ['east', { x: 11, z: 5 }],
    ['west', { x: -1, z: 5 }],
  ] as const)('points %s', (direction, tip) => {
    expect(rampArrowLayout({ originX: 5, originZ: 5, direction, length: 7 })!.tip).toEqual(tip);
  });

  it('outlines a corridor RAMP_WIDTH wide, centred on the axis, spanning steps 0..length-1', () => {
    const ns = rampArrowLayout({ originX: 16, originZ: 19, direction: 'south', length: 12 })!.corridor;
    expect(ns.maxX - ns.minX + 1).toBe(RAMP_WIDTH);
    expect(ns).toEqual({ minX: 15, maxX: 17, minZ: 19, maxZ: 30 });

    const ew = rampArrowLayout({ originX: 8, originZ: 4, direction: 'west', length: 5 })!.corridor;
    expect(ew.maxZ - ew.minZ + 1).toBe(RAMP_WIDTH);
    expect(ew).toEqual({ minX: 4, maxX: 8, minZ: 3, maxZ: 5 });
  });

  it('has nothing to draw for a zero-length ramp', () => {
    expect(rampArrowLayout({ originX: 0, originZ: 0, direction: 'south', length: 0 })).toBeNull();
    expect(buildRampArrow({ originX: 0, originZ: 0, direction: 'south', length: 0 }, flat)).toBeNull();
  });
});

describe('buildRampArrow()', () => {
  it('draws the arrowhead at the lower end: the widest point sits nearer the tip than the tail', () => {
    const group = buildRampArrow({ originX: 16, originZ: 19, direction: 'south', length: 12 }, flat)!;
    const verts = bodyVertices(group);
    const maxZ = Math.max(...verts.map(v => v.z));
    const minZ = Math.min(...verts.map(v => v.z));
    // Tail tile centre 19.5, tip tile centre 30.5 — the arrow reaches both.
    expect(minZ).toBeLessThan(19.5);
    expect(maxZ).toBeGreaterThan(30.5);
    const tipVertex = verts.find(v => v.z === maxZ)!;
    expect(tipVertex.x).toBeCloseTo(16.5);
    const widest = verts.reduce((a, b) => (Math.abs(b.x - 16.5) > Math.abs(a.x - 16.5) ? b : a));
    expect(widest.z).toBeGreaterThan(25);
  });

  it('is yellow, sits over the ghost cubes, and stays out of the GTAO prepass', () => {
    const group = buildRampArrow({ originX: 0, originZ: 0, direction: 'east', length: 6 }, flat)!;
    expect(isSceneOverlay(group)).toBe(true);
    const body = group.getObjectByName('ramp-arrow-body') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    expect(body.material.color.getHex()).toBe(RAMP_ARROW_COLOR);
    expect(body.renderOrder).toBeGreaterThan(GHOST_RENDER_ORDER);
    expect(RAMP_ARROW_RENDER_ORDER).toBeGreaterThan(GHOST_RENDER_ORDER);
    // A dark underlay keeps the yellow legible on pale ground.
    expect(group.getObjectByName('ramp-arrow-underlay')).toBeDefined();
    expect(group.getObjectByName('ramp-corridor-outline')).toBeDefined();
  });

  it('lies on the sampled ground', () => {
    const group = buildRampArrow({ originX: 0, originZ: 0, direction: 'east', length: 8 }, (x) => 10 - x)!;
    for (const v of bodyVertices(group)) expect(v.y).toBeCloseTo(10 - v.x + 0.12, 5);
  });

  it('takes a caller colour', () => {
    const group = buildRampArrow({ originX: 0, originZ: 0, direction: 'east', length: 3 }, flat, { color: 0xff0000 })!;
    const body = group.getObjectByName('ramp-arrow-body') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    expect(body.material.color.getHex()).toBe(0xff0000);
  });
});

describe('RampArrowLayer', () => {
  it('rebuilds surviving arrows when the terrain changed, so they follow the dug ground', () => {
    const scene = new THREE.Scene();
    let height = 5;
    const layer = new RampArrowLayer(scene, () => height);
    const ramps = [{ id: 1, def: { originX: 0, originZ: 0, direction: 'south' as const, length: 4 }, segments: [{ done: false }] }];
    layer.sync(ramps);
    const first = layer.getArrow(1);
    height = 2;
    layer.sync(ramps);
    expect(layer.getArrow(1)).toBe(first);
    layer.sync(ramps, true);
    expect(layer.getArrow(1)).not.toBe(first);
    expect(bodyVertices(layer.getArrow(1)!)[0]!.y).toBeCloseTo(2.12);
    layer.dispose();
    expect(layer.count).toBe(0);
    expect(scene.children).toHaveLength(0);
  });
});
