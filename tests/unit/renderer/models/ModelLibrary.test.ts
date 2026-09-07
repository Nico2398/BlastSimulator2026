// ModelLibrary — prototypes in, instances out

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { ModelLibrary, modelLibrary } from '../../../../src/renderer/models/ModelLibrary.js';
import { buildPrototype, TINT_KEY } from '../../../../src/renderer/models/ModelMerge.js';

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
