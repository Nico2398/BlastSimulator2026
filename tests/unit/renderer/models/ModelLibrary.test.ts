// ModelLibrary — prototypes in, instances out

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { ModelLibrary, modelLibrary, PICK_KEY } from '../../../../src/renderer/models/ModelLibrary.js';
import { buildPrototype, HULL_KEY, TINT_KEY } from '../../../../src/renderer/models/ModelMerge.js';
import { loadedModelLibrary } from '../../../helpers/models.js';

function protoWithTint(): ReturnType<typeof buildPrototype> {
  const scene = new THREE.Group();
  const node = new THREE.Group();
  node.name = 'Head';
  const tint = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
  tint.name = 'TintRole';
  const skin = new THREE.MeshStandardMaterial({ color: 0xffddaa });
  skin.name = 'Skin';
  node.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), tint), new THREE.Mesh(new THREE.SphereGeometry(0.5), skin));
  scene.add(node);
  return buildPrototype(scene);
}

describe('ModelLibrary', () => {
  it('starts empty and exposes a shared default instance', () => {
    const lib = new ModelLibrary();
    expect(lib.size).toBe(0);
    expect(lib.has('worker_driller')).toBe(false);
    expect(modelLibrary).toBeInstanceOf(ModelLibrary);
  });

  it('instantiates a registered prototype as a clone sharing geometry but owning its tint material', () => {
    const lib = new ModelLibrary();
    lib.register('thing', protoWithTint());
    const a = lib.instantiate('thing', { size: [1, 1, 1] });
    const b = lib.instantiate('thing', { size: [1, 1, 1] });
    expect(a.isFallback).toBe(false);
    expect(a.root.name).toBe('thing');
    expect(a.node('Head')).not.toBeNull();
    expect(a.node('Nope')).toBeNull();
    const tintA = a.tints.get('TintRole')!;
    const tintB = b.tints.get('TintRole')!;
    expect(tintA).not.toBe(tintB);
    tintA.color.setHex(0xff0000);
    expect(tintB.color.getHex()).toBe(0x00ff00);
    const meshA = a.root.getObjectByName('Head.tint') as THREE.Mesh;
    const meshB = b.root.getObjectByName('Head.tint') as THREE.Mesh;
    expect(meshA.geometry).toBe(meshB.geometry);
    expect(meshA.material).toBe(tintA);
    expect(meshA.userData[TINT_KEY]).toBe('TintRole');
  });

  it('hands out a stand-in box for an unknown id, tinted under the requested name, and reports it as fallback', () => {
    const lib = new ModelLibrary();
    const inst = lib.instantiate('missing', { size: [2, 3, 4], tint: 'TintBody' });
    expect(inst.isFallback).toBe(true);
    expect(inst.tints.has('TintBody')).toBe(true);
    const size = inst.bounds.getSize(new THREE.Vector3());
    expect(size.toArray().map(v => +v.toFixed(3))).toEqual([2, 3, 4]);
    expect(inst.bounds.min.y).toBeCloseTo(0); // stands on the ground
    // The stand-in is cached per id, so a second request shares its geometry.
    const again = lib.instantiate('missing', { size: [2, 3, 4], tint: 'TintBody' });
    const m1 = inst.root.getObjectByName('Body.tint') as THREE.Mesh;
    const m2 = again.root.getObjectByName('Body.tint') as THREE.Mesh;
    expect(m1.geometry).toBe(m2.geometry);
  });

  it('runs the material setup hook on registered prototypes, on later registrations and on every cloned tint, with teardown on dispose', () => {
    const lib = new ModelLibrary();
    lib.register('early', protoWithTint());
    const seen: THREE.Material[] = [];
    const torn: THREE.Material[] = [];
    lib.setMaterialSetup(m => { seen.push(m); return () => { torn.push(m); }; });
    // 'early' has two surface materials (tint + painted); the hull is skipped.
    expect(seen).toHaveLength(2);
    lib.register('late', protoWithTint());
    expect(seen).toHaveLength(4);
    const inst = lib.instantiate('late', { size: [1, 1, 1] });
    expect(seen).toHaveLength(5);
    expect(seen[4]).toBe(inst.tints.get('TintRole'));
    inst.dispose();
    expect(torn).toEqual([inst.tints.get('TintRole')]);
    // Fallbacks get the hook too.
    const fb = lib.instantiate('nothing', { size: [1, 1, 1], tint: 'TintX' });
    expect(seen).toContain(fb.tints.get('TintX'));
  });

  it('clearing a hook is harmless and clear() drops everything and bumps the revision', () => {
    const lib = new ModelLibrary();
    const r0 = lib.revision;
    lib.register('a', protoWithTint());
    expect(lib.revision).toBe(r0 + 1);
    lib.setMaterialSetup(null);
    lib.instantiate('a', { size: [1, 1, 1] });
    const dispose = vi.fn();
    lib.instantiate('gone', { size: [1, 1, 1] });
    lib.clear();
    expect(lib.size).toBe(0);
    expect(lib.has('a')).toBe(false);
    expect(lib.revision).toBe(r0 + 2);
    expect(dispose).not.toHaveBeenCalled();
  });
});

describe('ModelLibrary — the exported assets', () => {
  const ids = ['worker_driller', 'vehicle_drill_rig_t2', 'building_explosive_warehouse_t2'];

  it('instantiates a rigid vehicle and building as before: plain nodes of plain meshes, no bones, no pick proxy', async () => {
    const lib = await loadedModelLibrary(ids);
    for (const id of ids.slice(1)) {
      const proto = lib.prototype(id)!;
      expect(proto.skinned, id).toBe(false);
      const inst = lib.instantiate(id, { size: [1, 1, 1] });
      expect(inst.skinned, id).toBe(false);
      expect(inst.root.children.map(c => c.name)).toEqual(proto.root.children.map(c => c.name));
      expect(inst.root.getObjectByName(`${id}.pick`)).toBeUndefined();
      inst.root.traverse(obj => {
        expect(obj).not.toBeInstanceOf(THREE.Bone);
        expect(obj).not.toBeInstanceOf(THREE.SkinnedMesh);
      });
      // Every node holds its merged surfaces then exactly one hull, named after it.
      for (const node of inst.root.children) {
        const meshes = node.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
        if (meshes.length === 0) continue;
        expect(meshes.filter(m => m.userData[HULL_KEY]).map(m => m.name)).toEqual([`${node.name}.outline`]);
        expect(meshes.at(-1)!.userData[HULL_KEY]).toBe(true);
        for (const m of meshes) expect(m.name.startsWith(`${node.name}.`)).toBe(true);
      }
    }
  });

  it('instantiates the skinned worker: named bones, one skeleton per instance, the crew tints, a pick proxy', async () => {
    const lib = await loadedModelLibrary(ids);
    const a = lib.instantiate('worker_driller', { size: [0.6, 1.4, 0.6], tint: 'TintRole' });
    const b = lib.instantiate('worker_driller', { size: [0.6, 1.4, 0.6], tint: 'TintRole' });
    expect(a.skinned).toBe(true);
    for (const bone of ['Hips', 'Spine', 'Chest', 'Neck', 'Head', 'HandL', 'HandR', 'ThighL', 'FootR']) {
      expect(a.node(bone), bone).toBeInstanceOf(THREE.Bone);
    }
    const skinned: THREE.SkinnedMesh[] = [];
    a.root.traverse(obj => { if (obj instanceof THREE.SkinnedMesh) skinned.push(obj); });
    expect(skinned.length).toBeGreaterThan(1);
    expect(new Set(skinned.map(m => m.skeleton)).size).toBe(1);
    expect(skinned.filter(m => m.userData[HULL_KEY])).toHaveLength(1);
    for (const tint of ['TintRole', 'TintSkin', 'TintHair']) {
      expect(a.tints.get(tint), tint).toBeDefined();
      expect(a.tints.get(tint)).not.toBe(b.tints.get(tint));
    }
    // Pick boxes ride the bones they cover.
    const headBox = a.root.getObjectByName('worker_driller.pick.Head')!;
    expect(headBox.userData[PICK_KEY]).toBe(true);
    expect(headBox.parent).toBe(a.node('Head'));
    // Posing one worker leaves the other at rest.
    a.node('ThighL')!.rotation.x += 1;
    expect(b.node('ThighL')!.quaternion.equals(lib.prototype('worker_driller')!.root.getObjectByName('ThighL')!.quaternion))
      .toBe(true);
  });

  it('picks a collapsed worker anywhere along his body: the pick boxes follow the pose (a bind-pose box missed his head)', async () => {
    const lib = await loadedModelLibrary(['worker_driller']);
    const inst = lib.instantiate('worker_driller', { size: [1, 1, 1] });
    inst.node('Hips')!.rotation.z = Math.PI / 2; // flat on his back along +X/−X
    inst.root.updateMatrixWorld(true);
    const head = inst.node('Head')!.getWorldPosition(new THREE.Vector3());
    // Straight down onto where his head now lies, far outside the standing bounds' footprint.
    expect(Math.abs(head.x)).toBeGreaterThan(inst.bounds.max.x);
    const ray = new THREE.Raycaster(new THREE.Vector3(head.x, 5, head.z), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObject(inst.root, true);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every(h => h.object.userData[PICK_KEY] === true)).toBe(true);
    // And empty air above his standing height no longer selects him.
    const above = new THREE.Raycaster(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0), 0, 5 - 1.0);
    expect(above.intersectObject(inst.root, true)).toHaveLength(0);
  });

  it('culls the worker against a sphere that still holds it lying face-down with its arms flung out', async () => {
    const lib = await loadedModelLibrary(['worker_driller']);
    const inst = lib.instantiate('worker_driller', { size: [1, 1, 1] });
    inst.node('Hips')!.rotation.z = -Math.PI / 2; // collapsed forward along its +X facing
    inst.node('ShoulderL')!.rotation.x += Math.PI / 2;
    inst.node('ShoulderR')!.rotation.x -= Math.PI / 2;
    inst.root.updateMatrixWorld(true);
    const hull = inst.root.getObjectByName('Rig.outline') as THREE.SkinnedMesh;
    const sphere = hull.boundingSphere.clone().applyMatrix4(hull.matrixWorld);
    const v = new THREE.Vector3();
    let outside = 0;
    const count = hull.geometry.getAttribute('position').count;
    for (let i = 0; i < count; i++) {
      hull.getVertexPosition(i, v).applyMatrix4(hull.matrixWorld);
      if (!sphere.containsPoint(v)) outside++;
    }
    expect(outside).toBe(0);
  });
});
