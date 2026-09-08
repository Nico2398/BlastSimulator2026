// ModelMerge — glTF scene → merged toon prototype

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildPrototype, HULL_KEY, TINT_KEY } from '../../../../src/renderer/models/ModelMerge.js';

function part(name: string, material: THREE.MeshStandardMaterial, x = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.name = name;
  mesh.position.x = x;
  return mesh;
}

function makeScene(): THREE.Group {
  const scene = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'Body';
  body.position.y = 0.5;
  const paint = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  paint.name = 'TintBody';
  const grey = new THREE.MeshStandardMaterial({ color: 0x808080 });
  grey.name = 'Steel';
  const blue = new THREE.MeshStandardMaterial({ color: 0x0000ff });
  blue.name = 'Glass';
  const lamp = new THREE.MeshStandardMaterial({ color: 0xffffaa, emissive: 0xffee80 });
  lamp.name = 'Lamp';
  body.add(part('Shell', paint), part('Frame', grey, 2), part('Window', blue, 4), part('Light', lamp, 6));
  const wheel = new THREE.Group();
  wheel.name = 'WheelFL';
  wheel.position.set(1, 0.4, 1);
  wheel.add(part('Tyre', grey));
  scene.add(body, wheel);
  return scene;
}

describe('buildPrototype', () => {
  it('keeps one node per top-level child, with its name and transform', () => {
    const proto = buildPrototype(makeScene());
    expect(proto.root.children.map(c => c.name)).toEqual(['Body', 'WheelFL']);
    expect(proto.root.children[0]!.position.y).toBeCloseTo(0.5);
    expect(proto.root.children[1]!.position.toArray()).toEqual([1, 0.4, 1]);
  });

  it('merges fixed-colour parts into one vertex-coloured mesh, keeps tint and emissive parts apart, and adds one hull', () => {
    const proto = buildPrototype(makeScene());
    const body = proto.root.children[0]!;
    const names = body.children.map(c => c.name).sort();
    expect(names).toEqual(['Body.emissive', 'Body.outline', 'Body.painted', 'Body.tint']);
    const painted = body.getObjectByName('Body.painted') as THREE.Mesh;
    const geo = painted.geometry as THREE.BufferGeometry;
    // Frame (24 verts) + Window (24 verts) — the two fixed-colour boxes.
    expect(geo.getAttribute('position').count).toBe(48);
    expect(geo.getAttribute('color')).toBeDefined();
    expect((painted.material as THREE.MeshToonMaterial).vertexColors).toBe(true);
    const tint = body.getObjectByName('Body.tint') as THREE.Mesh;
    expect(tint.userData[TINT_KEY]).toBe('TintBody');
    expect((tint.material as THREE.MeshToonMaterial).color.getHex()).toBe(0xff0000);
    const emissive = body.getObjectByName('Body.emissive') as THREE.Mesh;
    expect((emissive.material as THREE.MeshToonMaterial).emissive.getHex()).toBe(0xffee80);
    const hull = body.getObjectByName('Body.outline') as THREE.Mesh;
    expect(hull.userData[HULL_KEY]).toBe(true);
    expect((hull.geometry as THREE.BufferGeometry).getAttribute('position').count).toBe(96);
    expect(hull.castShadow).toBe(false);
    expect(painted.castShadow).toBe(true);
  });

  it('bakes each part\'s offset relative to its node into the merged geometry', () => {
    const proto = buildPrototype(makeScene());
    const painted = proto.root.getObjectByName('Body.painted') as THREE.Mesh;
    painted.geometry.computeBoundingBox();
    const box = painted.geometry.boundingBox!;
    // Frame at x=2 and Window at x=4, each a unit cube: spans 1.5..4.5 in node space.
    expect(box.min.x).toBeCloseTo(1.5);
    expect(box.max.x).toBeCloseTo(4.5);
  });

  it('lists the tint names found and the bounds of the whole model (hulls excluded)', () => {
    const proto = buildPrototype(makeScene());
    expect(proto.tintNames).toEqual(['TintBody']);
    expect(proto.bounds.min.y).toBeCloseTo(-0.1); // wheel tyre bottom: 0.4 - 0.5
    expect(proto.bounds.max.x).toBeCloseTo(6.5);
  });

  it('gives an empty node no meshes and skips the hull', () => {
    const scene = new THREE.Group();
    const empty = new THREE.Group();
    empty.name = 'Pivot';
    scene.add(empty);
    const proto = buildPrototype(scene);
    expect(proto.root.children[0]!.children).toHaveLength(0);
    expect(proto.tintNames).toEqual([]);
  });

  it('hulls never answer a raycast, so picking lands on the surface mesh', () => {
    const proto = buildPrototype(makeScene());
    proto.root.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObject(proto.root, true);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every(h => !h.object.userData[HULL_KEY])).toBe(true);
  });
});
