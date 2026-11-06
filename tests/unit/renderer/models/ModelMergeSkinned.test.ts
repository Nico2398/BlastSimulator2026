// ModelMerge — a skinned glTF scene → one armature, skinned buckets on one skeleton
//
// The scenes here are built the way GLTFLoader hands a skinned export over:
// an armature node holding the bone tree and, beside it, one SkinnedMesh per
// part and material (a multi-material part arrives as a Group of them), each
// bound with an identity bind matrix to a skeleton of its own over the same
// bones.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildPrototype, HULL_KEY, TINT_KEY } from '../../../../src/renderer/models/ModelMerge.js';
import { ModelLibrary, PICK_KEY } from '../../../../src/renderer/models/ModelLibrary.js';

type WeightKind = 'float' | 'byte';

function material(name: string, color: number, emissive = 0): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, emissive });
  m.name = name;
  return m;
}

/** A box at height `y`, every vertex weighted fully to joint slot `joint` of `skeleton`. */
function skinnedBox(
  name: string, mat: THREE.Material, skeleton: THREE.Skeleton, joint: number, y: number, weights: WeightKind = 'float',
): THREE.SkinnedMesh {
  const geo = new THREE.BoxGeometry(0.2, 0.2, 0.2).translate(0, y, 0);
  const count = geo.getAttribute('position').count;
  const index = new Uint8Array(count * 4);
  const weight = weights === 'float' ? new Float32Array(count * 4) : new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    index[i * 4] = joint;
    weight[i * 4] = weights === 'float' ? 1 : 255;
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(index, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(weight, 4, weights === 'byte'));
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.name = name;
  mesh.bind(skeleton, new THREE.Matrix4());
  return mesh;
}

interface Rig {
  scene: THREE.Group;
  rig: THREE.Object3D;
  bones: Record<'Hips' | 'Spine' | 'Head' | 'ThighL', THREE.Bone>;
  skeleton: THREE.Skeleton;
}

/** Scene → Rig → Hips(0.5) → Spine(+0.3) → Head(+0.3), Hips → ThighL; no meshes yet. */
function makeRig(): Rig {
  const scene = new THREE.Group();
  const rig = new THREE.Object3D();
  rig.name = 'Rig';
  const bone = (name: string, y: number): THREE.Bone => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.y = y;
    return b;
  };
  const bones = { Hips: bone('Hips', 0.5), Spine: bone('Spine', 0.3), Head: bone('Head', 0.3), ThighL: bone('ThighL', 0) };
  bones.Hips.add(bones.Spine, bones.ThighL);
  bones.Spine.add(bones.Head);
  rig.add(bones.Hips);
  scene.add(rig);
  scene.updateMatrixWorld(true);
  // Inverse bind matrices from the rest pose, as an exporter writes them.
  const skeleton = new THREE.Skeleton([bones.Hips, bones.Spine, bones.Head, bones.ThighL]);
  return { scene, rig, bones, skeleton };
}

/** A worker-shaped skinned scene: tinted skin/overalls/hair, painted boots and eyes, a glowing lamp. */
function makeCharacter(weights: { boots?: WeightKind; head?: WeightKind } = {}): Rig {
  const r = makeRig();
  const { rig, skeleton } = r;
  // GLTFLoader binds each glTF node's primitives to a Skeleton object of its own.
  const own = (): THREE.Skeleton => new THREE.Skeleton(skeleton.bones, skeleton.boneInverses);
  const boots = new THREE.Group();
  boots.name = 'BootL';
  const bootSkin = own();
  boots.add(
    skinnedBox('BootL_1', material('Boot', 0x553311), bootSkin, 3, 0.1, weights.boots),
    skinnedBox('BootL_2', material('Sole', 0x111111), bootSkin, 3, 0.0, weights.boots),
  );
  rig.add(
    boots,
    skinnedBox('HeadSkull', material('TintSkin', 0xffccaa), own(), 2, 1.2, weights.head),
    skinnedBox('HeadHair', material('TintHair', 0x332211), own(), 2, 1.35),
    skinnedBox('Torso', material('TintRole', 0x00aa00), own(), 1, 0.9),
    skinnedBox('HeadEyeL', material('EyeWhite', 0xffffff), own(), 2, 1.25),
    skinnedBox('HatLamp', material('Lamp', 0xffffaa, 0xffee80), own(), 2, 1.45),
  );
  return r;
}

function skinnedMeshes(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const out: THREE.SkinnedMesh[] = [];
  root.traverse(obj => { if (obj instanceof THREE.SkinnedMesh) out.push(obj); });
  return out;
}

/** World position of vertex `i` of `mesh` as the GPU would skin it in the current pose. */
function skinnedVertex(mesh: THREE.SkinnedMesh, i: number): THREE.Vector3 {
  return mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
}

/** First vertex of `mesh`'s own draw range. */
function firstVertexOf(mesh: THREE.SkinnedMesh): number {
  return mesh.geometry.index!.getX(mesh.geometry.drawRange.start);
}

describe('buildPrototype — skinned scene', () => {
  it('keeps the armature as the one node and its bones findable by name, flagging the prototype skinned', () => {
    const proto = buildPrototype(makeCharacter().scene);
    expect(proto.skinned).toBe(true);
    expect(proto.root.children.map(c => c.name)).toEqual(['Rig']);
    for (const name of ['Hips', 'Spine', 'Head', 'ThighL']) {
      expect(proto.root.getObjectByName(name), name).toBeInstanceOf(THREE.Bone);
    }
    expect(proto.root.getObjectByName('Head')!.parent!.name).toBe('Spine');
    // Part groups are merged away: nothing but bones and merged meshes is left.
    expect(proto.root.getObjectByName('BootL')).toBeUndefined();
    expect(proto.root.getObjectByName('HeadSkull')).toBeUndefined();
  });

  it('collapses every primitive into the rigid buckets — painted, one per tint, one per emissive — plus one hull, all SkinnedMeshes on one skeleton', () => {
    const proto = buildPrototype(makeCharacter().scene);
    const rig = proto.root.getObjectByName('Rig')!;
    const meshes = rig.children.filter((c): c is THREE.SkinnedMesh => c instanceof THREE.SkinnedMesh);
    expect(meshes.map(m => m.name).sort()).toEqual(
      ['Rig.emissive', 'Rig.outline', 'Rig.painted', 'Rig.tint', 'Rig.tint', 'Rig.tint']);
    expect(rig.children.filter(c => c instanceof THREE.Mesh && !(c instanceof THREE.SkinnedMesh))).toHaveLength(0);
    const skeleton = meshes[0]!.skeleton;
    expect(meshes.every(m => m.skeleton === skeleton)).toBe(true);
    expect(skeleton.bones.map(b => b.name)).toEqual(['Hips', 'Spine', 'Head', 'ThighL']);
    // The skeleton's bones are the prototype's own, not the source scene's.
    expect(skeleton.bones.every(b => proto.root.getObjectById(b.id) === b)).toBe(true);
    expect(proto.tintNames.sort()).toEqual(['TintHair', 'TintRole', 'TintSkin']);

    const tints = meshes.filter(m => m.userData[TINT_KEY]);
    expect(tints.map(m => m.userData[TINT_KEY]).sort()).toEqual(['TintHair', 'TintRole', 'TintSkin']);
    expect(tints.every(m => (m.material as THREE.MeshToonMaterial).name === m.userData[TINT_KEY])).toBe(true);
    const painted = rig.getObjectByName('Rig.painted') as THREE.SkinnedMesh;
    expect((painted.material as THREE.MeshToonMaterial).vertexColors).toBe(true);
    expect(painted.geometry.getAttribute('color')).toBeDefined();
    expect(tints[0]!.geometry.getAttribute('color')).toBeUndefined();
    const emissive = rig.getObjectByName('Rig.emissive') as THREE.SkinnedMesh;
    expect((emissive.material as THREE.MeshToonMaterial).emissive.getHex()).toBe(0xffee80);
    for (const m of meshes) {
      expect(Object.keys(m.geometry.attributes)).toEqual(expect.arrayContaining(['position', 'normal', 'skinIndex', 'skinWeight']));
    }
    expect(painted.castShadow).toBe(true);
    expect(painted.receiveShadow).toBe(true);
  });

  it('draws every bucket and the hull from one shared set of buffers, each bucket its own index range', () => {
    const proto = buildPrototype(makeCharacter().scene);
    const meshes = skinnedMeshes(proto.root);
    const hull = meshes.find(m => m.userData[HULL_KEY])!;
    const surfaces = meshes.filter(m => !m.userData[HULL_KEY]);
    for (const name of ['position', 'normal', 'skinIndex', 'skinWeight']) {
      expect(surfaces.every(m => m.geometry.getAttribute(name) === hull.geometry.getAttribute(name)), name).toBe(true);
    }
    expect(surfaces.every(m => m.geometry.index === hull.geometry.index)).toBe(true);
    // Seven boxes of 36 indices: the ranges tile the hull's range without overlap.
    const ranges = surfaces.map(m => m.geometry.drawRange).sort((a, b) => a.start - b.start);
    let next = 0;
    for (const r of ranges) {
      expect(r.start).toBe(next);
      next += r.count;
    }
    expect(next).toBe(7 * 36);
    expect(hull.geometry.drawRange.start).toBe(0);
    expect(hull.geometry.drawRange.count).toBeGreaterThanOrEqual(next);
  });

  it('leaves Face* parts out of the outline: they draw in their own buckets past the end of the hull\'s range', () => {
    const r = makeCharacter();
    const own = (): THREE.Skeleton => new THREE.Skeleton(r.skeleton.bones, r.skeleton.boneInverses);
    r.rig.add(
      skinnedBox('FaceEyeL', material('FaceEyeWhite', 0xffffff), own(), 2, 1.25),
      skinnedBox('FaceLidL', material('TintSkin', 0xffccaa), own(), 2, 1.27),
    );
    const proto = buildPrototype(r.scene);
    const meshes = skinnedMeshes(proto.root);
    const hull = meshes.find(m => m.userData[HULL_KEY])!;
    const surfaces = meshes.filter(m => !m.userData[HULL_KEY]);
    const hullEnd = hull.geometry.drawRange.start + hull.geometry.drawRange.count;
    const unlined = surfaces.filter(m => m.geometry.drawRange.start >= hullEnd);
    const lined = surfaces.filter(m => m.geometry.drawRange.start < hullEnd);
    // The face's painted part and its skin-tinted lid each got a bucket outside the hull…
    expect(unlined).toHaveLength(2);
    expect(unlined.some(m => m.userData[TINT_KEY] === 'TintSkin')).toBe(true);
    // Face details cast no shadow; the painted eye takes none either, the skin-tinted lid still does.
    for (const m of unlined) expect(m.castShadow, m.name).toBe(false);
    expect(unlined.find(m => !m.userData[TINT_KEY])!.receiveShadow).toBe(false);
    expect(unlined.find(m => m.userData[TINT_KEY] === 'TintSkin')!.receiveShadow).toBe(true);
    for (const m of lined) expect(m.castShadow && m.receiveShadow, m.name).toBe(true);
    // …while the skull keeps the outlined TintSkin bucket, and both share one per-instance tint material.
    expect(lined.some(m => m.userData[TINT_KEY] === 'TintSkin')).toBe(true);
    expect(lined.every(m => m.geometry.drawRange.start + m.geometry.drawRange.count <= hullEnd)).toBe(true);
    const inst = new ModelLibrary();
    inst.register('w', proto);
    const one = inst.instantiate('w', { size: [1, 1, 1] });
    const skins = skinnedMeshes(one.root).filter(m => m.userData[TINT_KEY] === 'TintSkin');
    expect(skins).toHaveLength(2);
    expect(skins[0]!.material).toBe(skins[1]!.material);
    expect(skins[0]!.material).toBe(one.tints.get('TintSkin'));
  });

  it('gives one skinned inverted-hull outline over the union that never answers a raycast', () => {
    const proto = buildPrototype(makeCharacter().scene);
    const hull = proto.root.getObjectByName('Rig.outline') as THREE.SkinnedMesh;
    expect(hull).toBeInstanceOf(THREE.SkinnedMesh);
    expect(hull.userData[HULL_KEY]).toBe(true);
    const outline = hull.material as THREE.ShaderMaterial;
    expect(outline).toBeInstanceOf(THREE.ShaderMaterial);
    expect(outline.side).toBe(THREE.BackSide);
    expect(hull.castShadow).toBe(false);
    // The chunks three resolves for skinning are named exactly as it ships them.
    const chunks = [...outline.vertexShader.matchAll(/#include <(\w+)>/g)].map(m => m[1]!);
    expect(chunks).toEqual(['skinning_pars_vertex', 'skinbase_vertex', 'skinnormal_vertex', 'skinning_vertex']);
    for (const chunk of chunks) expect(THREE.ShaderChunk[chunk as keyof typeof THREE.ShaderChunk], chunk).toBeTypeOf('string');
    const hits: THREE.Intersection[] = [];
    hull.raycast(new THREE.Raycaster(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0)), hits);
    expect(hits).toHaveLength(0);
  });

  it('reports bind-pose bounds of every part', () => {
    const proto = buildPrototype(makeCharacter().scene);
    expect(proto.bounds.min.y).toBeCloseTo(-0.1); // the sole's bottom
    expect(proto.bounds.max.y).toBeCloseTo(1.55); // the lamp's top
    expect(proto.bounds.max.x).toBeCloseTo(0.1);
  });

  it('sets a culling sphere around the bind pose wide enough for a pose, so three never computes one from a transient pose', () => {
    const proto = buildPrototype(makeCharacter().scene);
    const bindSphere = proto.bounds.getBoundingSphere(new THREE.Sphere());
    for (const mesh of skinnedMeshes(proto.root)) {
      expect(mesh.boundingSphere, mesh.name).not.toBeNull();
      expect(mesh.boundingSphere.center.distanceTo(bindSphere.center)).toBeCloseTo(0);
      expect(mesh.boundingSphere.radius).toBeCloseTo(bindSphere.radius * 1.6);
      expect(mesh.boundingBox.equals(proto.bounds)).toBe(true);
    }
  });

  it('keeps the byte weight type when every primitive agrees, and widens a byte/float mix to float', () => {
    const weight = (p: ReturnType<typeof buildPrototype>): THREE.BufferAttribute =>
      (p.root.getObjectByName('Rig.outline') as THREE.SkinnedMesh).geometry.getAttribute('skinWeight') as THREE.BufferAttribute;
    const r = makeRig();
    r.rig.add(
      skinnedBox('A', material('Boot', 0x553311), r.skeleton, 3, 0.1, 'byte'),
      skinnedBox('B', material('TintSkin', 0xffccaa), r.skeleton, 2, 1.2, 'byte'),
    );
    const allBytes = weight(buildPrototype(r.scene));
    expect(allBytes.array).toBeInstanceOf(Uint8Array);
    expect(allBytes.normalized).toBe(true);
    expect(allBytes.getX(0)).toBe(1);
    // Boots and skull as bytes, every other part float: widened, losing nothing.
    const mixed = weight(buildPrototype(makeCharacter({ boots: 'byte', head: 'byte' }).scene));
    expect(mixed.array).toBeInstanceOf(Float32Array);
    expect(mixed.normalized).toBe(false);
    for (let i = 0; i < mixed.count; i++) {
      expect(mixed.getX(i) + mixed.getY(i) + mixed.getZ(i) + mixed.getW(i)).toBeCloseTo(1, 5);
    }
  });

  it('remaps joint slots of a primitive whose skeleton lists the same bones in another order', () => {
    const r = makeRig();
    const { Hips, Spine, Head, ThighL } = r.bones;
    const reordered = new THREE.Skeleton([Head, ThighL, Hips, Spine]); // inverses from the same rest pose
    const sourceSkull = skinnedBox('Skull', material('TintSkin', 0xffccaa), reordered, 0, 1.2); // slot 0 here is Head
    r.rig.add(skinnedBox('Body', material('TintRole', 0x00aa00), r.skeleton, 1, 0.9), sourceSkull);
    r.scene.updateMatrixWorld(true);
    const exported = skinnedVertex(sourceSkull, 0);
    const lib = new ModelLibrary();
    lib.register('w', buildPrototype(r.scene));
    const inst = lib.instantiate('w', { size: [1, 1, 1] });
    const skull = skinnedMeshes(inst.root).find(m => m.userData[TINT_KEY] === 'TintSkin')!;
    const body = skinnedMeshes(inst.root).find(m => m.userData[TINT_KEY] === 'TintRole')!;
    inst.root.updateMatrixWorld(true);
    const skullRest = skinnedVertex(skull, firstVertexOf(skull));
    const bodyRest = skinnedVertex(body, firstVertexOf(body));
    expect(skullRest.distanceTo(exported)).toBeCloseTo(0); // unposed: where the export put it
    inst.node('Head')!.position.y += 0.5;
    inst.root.updateMatrixWorld(true);
    expect(skinnedVertex(skull, firstVertexOf(skull)).y).toBeCloseTo(skullRest.y + 0.5);
    expect(skinnedVertex(body, firstVertexOf(body)).y).toBeCloseTo(bodyRest.y);
  });

  it('rides a rigid mesh parented to a bone on that bone, and keeps a rigid top-level node rigid', () => {
    const r = makeRig();
    r.rig.add(skinnedBox('Body', material('TintRole', 0x00aa00), r.skeleton, 1, 0.9));
    const tool = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), material('Steel', 0x888888));
    tool.name = 'Wrench';
    tool.position.x = 0.4;
    r.bones.Head.add(tool);
    r.scene.updateMatrixWorld(true);
    const exported = new THREE.Vector3().fromBufferAttribute(tool.geometry.getAttribute('position'), 0);
    tool.localToWorld(exported);
    const crate = new THREE.Group();
    crate.name = 'Crate';
    crate.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material('Wood', 0x996633)));
    r.scene.add(crate);
    const lib = new ModelLibrary();
    const proto = buildPrototype(r.scene);
    expect(proto.root.children.map(c => c.name)).toEqual(['Rig', 'Crate']);
    expect(proto.root.getObjectByName('Crate.painted')).toBeInstanceOf(THREE.Mesh);
    expect(proto.root.getObjectByName('Crate.painted')).not.toBeInstanceOf(THREE.SkinnedMesh);
    expect(proto.root.getObjectByName('Wrench')).toBeUndefined(); // merged into the painted bucket
    lib.register('w', proto);
    const inst = lib.instantiate('w', { size: [1, 1, 1] });
    const painted = inst.root.getObjectByName('Rig.painted') as THREE.SkinnedMesh;
    inst.root.updateMatrixWorld(true);
    const rest = skinnedVertex(painted, firstVertexOf(painted));
    expect(rest.distanceTo(exported)).toBeCloseTo(0); // at rest, exactly where the export put it
    inst.node('Head')!.rotation.y = Math.PI; // turn the head round: the wrench swings to the other side
    inst.root.updateMatrixWorld(true);
    const turned = skinnedVertex(painted, firstVertexOf(painted));
    expect(turned.x).toBeCloseTo(-rest.x);
    expect(turned.z).toBeCloseTo(-rest.z);
    expect(turned.y).toBeCloseTo(rest.y);
  });

  it('refuses an armature whose rigid mesh has no bone to follow, rather than drawing it at the origin', () => {
    const r = makeRig();
    r.rig.add(skinnedBox('Body', material('TintRole', 0x00aa00), r.skeleton, 1, 0.9));
    r.rig.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material('Loose', 0x123456)));
    expect(() => buildPrototype(r.scene)).toThrow(/no bone to follow/);
  });

  it('refuses two skins that disagree on a bone\'s bind pose', () => {
    const r = makeRig();
    const shifted = new THREE.Skeleton(r.skeleton.bones, r.skeleton.boneInverses.map(m => m.clone().multiply(
      new THREE.Matrix4().makeTranslation(0, 0.25, 0))));
    r.rig.add(
      skinnedBox('Body', material('TintRole', 0x00aa00), r.skeleton, 1, 0.9),
      skinnedBox('Odd', material('TintSkin', 0xffccaa), shifted, 2, 1.2),
    );
    expect(() => buildPrototype(r.scene)).toThrow(/two different inverse bind matrices/);
  });
});

describe('ModelLibrary.instantiate — skinned prototype', () => {
  function library(): ModelLibrary {
    const lib = new ModelLibrary();
    lib.register('worker', buildPrototype(makeCharacter().scene));
    return lib;
  }

  it('gives each instance its own bones and one skeleton shared by all its surfaces', () => {
    const lib = library();
    const a = lib.instantiate('worker', { size: [1, 1, 1] });
    const b = lib.instantiate('worker', { size: [1, 1, 1] });
    expect(a.skinned).toBe(true);
    expect(a.isFallback).toBe(false);
    const headA = a.node('Head')!;
    expect(headA).toBeInstanceOf(THREE.Bone);
    expect(headA).not.toBe(b.node('Head'));
    const meshesA = skinnedMeshes(a.root);
    const skeleton = meshesA[0]!.skeleton;
    expect(meshesA.every(m => m.skeleton === skeleton)).toBe(true);
    expect(skeleton).not.toBe(skinnedMeshes(b.root)[0]!.skeleton);
    expect(skeleton.bones.every(bone => a.root.getObjectById(bone.id) === bone)).toBe(true);
    expect(skeleton.bones).toContain(headA);
  });

  it('poses one instance without moving another: surfaces and hull follow the bone', () => {
    const lib = library();
    const a = lib.instantiate('worker', { size: [1, 1, 1] });
    const b = lib.instantiate('worker', { size: [1, 1, 1] });
    const skull = (inst: typeof a): THREE.SkinnedMesh =>
      skinnedMeshes(inst.root).find(m => m.userData[TINT_KEY] === 'TintSkin')!;
    const hull = (inst: typeof a): THREE.SkinnedMesh => inst.root.getObjectByName('Rig.outline') as THREE.SkinnedMesh;
    a.root.updateMatrixWorld(true);
    b.root.updateMatrixWorld(true);
    const vertex = firstVertexOf(skull(a));
    const rest = skinnedVertex(skull(a), vertex);
    a.node('Head')!.rotation.z = Math.PI / 2;
    a.root.updateMatrixWorld(true);
    const posed = skinnedVertex(skull(a), vertex);
    expect(posed.distanceTo(rest)).toBeGreaterThan(0.05);
    expect(skinnedVertex(hull(a), vertex).distanceTo(posed)).toBeCloseTo(0); // the outline bends with it
    expect(skinnedVertex(skull(b), vertex).distanceTo(rest)).toBeCloseTo(0);
    expect(b.node('Head')!.rotation.z).toBeCloseTo(0);
  });

  it('clones TintRole, TintSkin and TintHair per instance onto the skinned surfaces', () => {
    const lib = library();
    const a = lib.instantiate('worker', { size: [1, 1, 1] });
    const b = lib.instantiate('worker', { size: [1, 1, 1] });
    expect([...a.tints.keys()].sort()).toEqual(['TintHair', 'TintRole', 'TintSkin']);
    for (const name of ['TintHair', 'TintRole', 'TintSkin']) {
      expect(a.tints.get(name)).not.toBe(b.tints.get(name));
      const mesh = skinnedMeshes(a.root).find(m => m.userData[TINT_KEY] === name)!;
      expect(mesh.material).toBe(a.tints.get(name));
    }
    a.tints.get('TintSkin')!.color.setHex(0x8d5524);
    expect(b.tints.get('TintSkin')!.color.getHex()).toBe(0xffccaa);
  });

  it('picks through invisible per-bone proxy boxes: skinned surfaces never raycast', () => {
    const lib = library();
    const inst = lib.instantiate('worker', { size: [1, 1, 1] });
    const proxies: THREE.Mesh[] = [];
    inst.root.traverse(o => { if (o instanceof THREE.Mesh && o.userData[PICK_KEY]) proxies.push(o); });
    expect(proxies.length).toBeGreaterThan(0);
    for (const proxy of proxies) {
      expect(proxy).not.toBeInstanceOf(THREE.SkinnedMesh);
      expect(proxy.parent).toBeInstanceOf(THREE.Bone);
      expect(proxy.name).toBe(`worker.pick.${proxy.parent!.name}`);
      expect((proxy.material as THREE.Material).visible).toBe(false);
      expect(proxy.castShadow).toBe(false);
    }
    // Together, at rest, the boxes cover the model's bind bounds (plus their slack).
    inst.root.updateMatrixWorld(true);
    const union = new THREE.Box3();
    for (const proxy of proxies) union.union(new THREE.Box3().setFromObject(proxy));
    expect(union.containsBox(inst.bounds)).toBe(true);
    inst.root.position.set(10, 0, 4);
    inst.root.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(10, 5, 4), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObject(inst.root, true);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every(h => h.object.userData[PICK_KEY] === true)).toBe(true);
    // A second instance shares each bone's proxy geometry.
    const again = lib.instantiate('worker', { size: [1, 1, 1] });
    const first = proxies[0]!;
    expect((again.root.getObjectByName(first.name) as THREE.Mesh).geometry).toBe(first.geometry);
  });

  it('keeps the culling sphere set on every instance surface, and the frustum test never recomputes it', () => {
    const lib = library();
    const inst = lib.instantiate('worker', { size: [1, 1, 1] });
    inst.node('Hips')!.rotation.z = Math.PI / 2; // a transient pose
    inst.root.updateMatrixWorld(true);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().makeOrthographic(-50, 50, 50, -50, -50, 50));
    for (const mesh of skinnedMeshes(inst.root)) {
      const before = mesh.boundingSphere.clone();
      mesh.computeBoundingSphere = () => { throw new Error('recomputed from a pose'); };
      expect(frustum.intersectsObject(mesh)).toBe(true);
      expect(mesh.boundingSphere.equals(before)).toBe(true);
    }
  });

  it('releases its skeleton and tints on dispose, leaving the prototype\'s shared geometry alone', () => {
    const lib = library();
    const inst = lib.instantiate('worker', { size: [1, 1, 1] });
    const skeleton = skinnedMeshes(inst.root)[0]!.skeleton;
    skeleton.computeBoneTexture();
    const texture = skeleton.boneTexture!;
    let disposed = false;
    texture.addEventListener('dispose', () => { disposed = true; });
    inst.dispose();
    expect(disposed).toBe(true);
    expect(skeleton.boneTexture).toBeNull();
  });
});
