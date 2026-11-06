// RigPoser — unit tests on a small synthetic leg (hip → knee → ankle → toe)

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { blendPose, RigPoser } from '../../../../src/renderer/character/RigPoser.js';

/**
 * A leg hanging from a hips bone at y = 1, built the way glTF delivers a
 * Blender rig: each bone's local frame points its +Y down the limb, so the
 * rest rotations are far from identity. The knee is bent slightly forward
 * (+X), which is what defines the chain's bend axis.
 */
function leg(): { root: THREE.Group; poser: RigPoser; ids: Record<string, number> } {
  const root = new THREE.Group();
  const hips = new THREE.Bone(); hips.name = 'Hips'; hips.position.set(0, 1, 0);
  const thigh = new THREE.Bone(); thigh.name = 'Thigh';
  const shin = new THREE.Bone(); shin.name = 'Shin';
  const foot = new THREE.Bone(); foot.name = 'Foot';
  const toe = new THREE.Bone(); toe.name = 'Toe';
  root.add(hips); hips.add(thigh); thigh.add(shin); shin.add(foot); foot.add(toe);
  // Thigh points down and a touch forward; shin down and a touch back.
  thigh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.05, -1, 0).normalize());
  shin.position.set(0, 0.5, 0);
  const shinWorld = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-0.05, -1, 0).normalize());
  shin.quaternion.copy(thigh.quaternion.clone().invert().multiply(shinWorld));
  foot.position.set(0, 0.5, 0);
  foot.quaternion.copy(shinWorld.clone().invert());
  toe.position.set(0.15, 0, 0);
  root.updateMatrixWorld(true);
  const poser = RigPoser.fromModel(root)!;
  const ids = Object.fromEntries(['Hips', 'Thigh', 'Shin', 'Foot', 'Toe'].map(n => [n, poser.id(n)]));
  return { root, poser, ids };
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('RigPoser', () => {
  it('measures the rest pose in rig space', () => {
    const { root, poser, ids } = leg();
    for (const name of ['Hips', 'Thigh', 'Shin', 'Foot', 'Toe']) {
      const want = root.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
      expect(poser.restPos(ids[name]!, new THREE.Vector3()).distanceTo(want)).toBeLessThan(1e-6);
    }
    expect(poser.restLength(ids.Thigh!, ids.Shin!)).toBeCloseTo(0.5, 6);
  });

  it('rot() turns a bone about rig axes in its parent\'s frame: +Z swings a hanging leg forward', () => {
    const { poser, ids } = leg();
    poser.rot(ids.Thigh!, 0, 0, Math.PI / 2);
    const knee = poser.pos(ids.Shin!, new THREE.Vector3());
    // Hip at (0, 1, 0); a quarter turn forward puts the knee level with it, in front.
    expect(knee.y).toBeCloseTo(1 + 0.5 * Math.sin(Math.atan2(0.05, 1)), 2);
    expect(knee.x).toBeGreaterThan(0.45);
    // A child set afterwards rides the parent's pose.
    poser.rot(ids.Shin!, 0, 0, 0);
    expect(poser.pos(ids.Foot!, new THREE.Vector3()).x).toBeGreaterThan(0.9);
  });

  it('ik2 lands the ankle exactly on a reachable target, knee toward the pole', () => {
    const { poser, ids } = leg();
    const target = v(0.3, 0.3, 0.05);
    poser.ik2(ids.Thigh!, ids.Shin!, ids.Foot!, target, v(1, 0, 0));
    expect(poser.pos(ids.Foot!, new THREE.Vector3()).distanceTo(target)).toBeLessThan(1e-5);
    // The knee bends forward, not backward or sideways.
    const knee = poser.pos(ids.Shin!, new THREE.Vector3());
    const hip = poser.pos(ids.Thigh!, new THREE.Vector3());
    const mid = hip.clone().lerp(target, 0.5);
    expect(knee.x - mid.x).toBeGreaterThan(0.05);
    // Bone lengths are preserved.
    expect(knee.distanceTo(hip)).toBeCloseTo(0.5, 5);
  });

  it('ik2 at the rest target with the rest pole reproduces the rest pose', () => {
    const { poser, ids } = leg();
    const rest = poser.restPos(ids.Foot!, new THREE.Vector3());
    poser.ik2(ids.Thigh!, ids.Shin!, ids.Foot!, rest, v(1, 0, 0));
    const q = poser.rotation(ids.Shin!, new THREE.Quaternion());
    poser.reset();
    const r = poser.rotation(ids.Shin!, new THREE.Quaternion());
    expect(q.angleTo(r)).toBeLessThan(1e-3);
  });

  it('ik2 straightens toward an out-of-reach target instead of failing', () => {
    const { poser, ids } = leg();
    poser.ik2(ids.Thigh!, ids.Shin!, ids.Foot!, v(0, -3, 0), v(1, 0, 0));
    const ankle = poser.pos(ids.Foot!, new THREE.Vector3());
    expect(ankle.y).toBeCloseTo(0, 2); // full length below the hip
    expect(Number.isFinite(ankle.x)).toBe(true);
  });

  it('orient() holds a bone\'s absolute rotation whatever its parents do', () => {
    const { poser, ids } = leg();
    const flat = new THREE.Quaternion();
    poser.rot(ids.Thigh!, 0, 0, 0.7).orient(ids.Foot!, flat);
    const toe = poser.pos(ids.Toe!, new THREE.Vector3()).sub(poser.pos(ids.Foot!, new THREE.Vector3()));
    // At rest the toe is straight ahead of the ankle; a flat foot keeps it there.
    expect(toe.normalize().distanceTo(v(1, 0, 0))).toBeLessThan(1e-5);
  });

  it('placeAt() and shift() move a bone\'s head; reset() returns the rest pose', () => {
    const { poser, ids } = leg();
    poser.shift(ids.Hips!, 0.1, -0.2, 0);
    expect(poser.pos(ids.Hips!, new THREE.Vector3()).distanceTo(v(0.1, 0.8, 0))).toBeLessThan(1e-6);
    poser.placeAt(ids.Toe!, v(1, 2, 3));
    expect(poser.pos(ids.Toe!, new THREE.Vector3()).distanceTo(v(1, 2, 3))).toBeLessThan(1e-6);
    poser.reset();
    expect(poser.pos(ids.Hips!, new THREE.Vector3()).distanceTo(v(0, 1, 0))).toBeLessThan(1e-6);
  });

  it('apply() writes the captured pose onto the scene bones', () => {
    const { root, poser, ids } = leg();
    poser.rot(ids.Thigh!, 0, 0, 0.5);
    poser.apply(poser.capture(poser.createBuffer()));
    root.updateMatrixWorld(true);
    const knee = root.getObjectByName('Shin')!.getWorldPosition(new THREE.Vector3());
    expect(knee.distanceTo(poser.pos(ids.Shin!, new THREE.Vector3()))).toBeLessThan(1e-6);
  });

  it('blendPose mixes two poses: 0 keeps the first, 1 gives the second, ½ lands between', () => {
    const { poser, ids } = leg();
    const a = poser.capture(poser.createBuffer());
    poser.rot(ids.Thigh!, 0, 0, 1);
    const b = poser.capture(poser.createBuffer());
    const mixed = poser.createBuffer();
    const angleOf = (buf: typeof a): number => {
      poser.apply(buf);
      return new THREE.Quaternion().fromArray(buf.q, ids.Thigh! * 4).angleTo(new THREE.Quaternion().fromArray(a.q, ids.Thigh! * 4));
    };
    mixed.q.set(a.q); mixed.p.set(a.p);
    // Poses are stored as float32: acos near 1 resolves only to ~1e-3 rad.
    expect(angleOf(blendPose(mixed, b, 0))).toBeCloseTo(0, 2);
    mixed.q.set(a.q); mixed.p.set(a.p);
    expect(angleOf(blendPose(mixed, b, 1))).toBeCloseTo(1, 4);
    mixed.q.set(a.q); mixed.p.set(a.p);
    expect(angleOf(blendPose(mixed, b, 0.5))).toBeCloseTo(0.5, 2);
  });

  it('rejects a bone name the rig does not have', () => {
    const { poser } = leg();
    expect(() => poser.id('Tail')).toThrow(/no bone named Tail/);
    expect(RigPoser.fromModel(new THREE.Group())).toBeNull();
  });
});
