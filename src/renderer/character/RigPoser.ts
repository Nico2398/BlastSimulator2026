// BlastSimulator2026 — Rig poser
// Forward kinematics, two-bone IK and orientation solves over a skinned
// model's skeleton, in the rig's own space (the armature node: +X the
// character's front, +Y up, +Z its right). A pose is built bone by bone in
// hierarchy order — rotate a bone, or solve it — and everything evaluated
// afterwards sits in the posed frame, so a clip can plant a foot on the ground
// or keep a tool upright while the body moves. The animator poses tens of
// workers every frame, so the hot paths reuse scratch vectors.
//
// Angles are rotations about *rig* axes, applied in the parent's posed frame:
// `rot(b, 0, 0, a)` swings a hanging limb forward by `a` whatever the bone's
// own roll. Sign guide for the bones a worker has:
//   about Z (+): a downward limb swings forward; an upward bone tips backward.
//   about X (+): a downward limb swings toward +Z (the right); an upward bone tips right.
//   about Y (+): yaw to the left.

import * as THREE from 'three';

/** A full pose: one local quaternion and position per bone, in RigPoser bone order. */
export interface PoseBuffer {
  q: Float32Array;
  p: Float32Array;
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix3();
const _m2 = new THREE.Matrix3();
const _e = new THREE.Euler();

/** The rig node: the bones' common ancestor directly under the model root. */
function rigRootOf(bones: readonly THREE.Bone[]): THREE.Object3D | null {
  const first = bones[0];
  let node: THREE.Object3D | null = first ?? null;
  while (node && node instanceof THREE.Bone) node = node.parent;
  return node;
}

export class RigPoser {
  readonly names: readonly string[];
  private readonly bones: THREE.Bone[];
  private readonly index = new Map<string, number>();
  private readonly parent: Int16Array;
  private readonly children: number[][];
  private readonly restQ: THREE.Quaternion[];
  private readonly restP: THREE.Vector3[];
  /** Rest rotation of each bone in rig space, and its inverse. */
  private readonly restRigQ: THREE.Quaternion[];
  private readonly restRigQInv: THREE.Quaternion[];
  private readonly restRigPos: THREE.Vector3[];
  /** Working pose: local rotation and position per bone. */
  private readonly q: THREE.Quaternion[];
  private readonly p: THREE.Vector3[];
  /** Posed rig-space rotation/position cache, valid where `fresh` is set. */
  private readonly posedQ: THREE.Quaternion[];
  private readonly posedP: THREE.Vector3[];
  private readonly fresh: Uint8Array;
  private readonly hinges = new Map<number, THREE.Vector3>();

  constructor(bones: readonly THREE.Bone[]) {
    this.bones = [...bones];
    const n = this.bones.length;
    this.names = this.bones.map(b => b.name);
    this.bones.forEach((b, i) => this.index.set(b.name, i));
    this.parent = new Int16Array(n);
    this.children = this.bones.map(() => []);
    this.bones.forEach((b, i) => {
      const pi = b.parent instanceof THREE.Bone ? this.index.get(b.parent.name) ?? -1 : -1;
      this.parent[i] = pi;
      if (pi >= 0) this.children[pi]!.push(i);
    });
    this.restQ = this.bones.map(b => b.quaternion.clone());
    this.restP = this.bones.map(b => b.position.clone());
    this.restRigQ = new Array(n);
    this.restRigPos = new Array(n);
    for (const i of this.order()) {
      const pi = this.parent[i]!;
      const pq = pi >= 0 ? this.restRigQ[pi]! : new THREE.Quaternion();
      const pp = pi >= 0 ? this.restRigPos[pi]! : new THREE.Vector3();
      this.restRigQ[i] = pq.clone().multiply(this.restQ[i]!);
      this.restRigPos[i] = this.restP[i]!.clone().applyQuaternion(pq).add(pp);
    }
    this.restRigQInv = this.restRigQ.map(q => q.clone().invert());
    this.q = this.restQ.map(q => q.clone());
    this.p = this.restP.map(p => p.clone());
    this.posedQ = this.bones.map(() => new THREE.Quaternion());
    this.posedP = this.bones.map(() => new THREE.Vector3());
    this.fresh = new Uint8Array(n);
  }

  /** Every Bone under `root`, in hierarchy order, or null when the model has no skeleton. */
  static fromModel(root: THREE.Object3D): RigPoser | null {
    const bones: THREE.Bone[] = [];
    root.traverse(o => { if (o instanceof THREE.Bone) bones.push(o); });
    if (bones.length === 0 || !rigRootOf(bones)) return null;
    return new RigPoser(bones);
  }

  has(name: string): boolean {
    return this.index.has(name);
  }

  /** Index of a bone, throwing for a name the rig does not have (a typo is a bug, not a fallback). */
  id(name: string): number {
    const i = this.index.get(name);
    if (i === undefined) throw new Error(`RigPoser: no bone named ${name}`);
    return i;
  }

  /** Bone indices with every parent before its children. */
  private order(): number[] {
    const out: number[] = [];
    const visit = (i: number): void => { out.push(i); for (const c of this.children[i]!) visit(c); };
    this.parent.forEach((pi, i) => { if (pi < 0) visit(i); });
    return out;
  }

  // ---------------------------------------------------------------- state

  /** Back to the rest (bind) pose. */
  reset(): this {
    for (let i = 0; i < this.q.length; i++) {
      this.q[i]!.copy(this.restQ[i]!);
      this.p[i]!.copy(this.restP[i]!);
    }
    this.fresh.fill(0);
    return this;
  }

  private dirtyAll(i: number): void {
    this.fresh[i] = 0;
    for (const c of this.children[i]!) this.dirtyAll(c);
  }

  private evaluate(i: number): void {
    if (this.fresh[i]) return;
    const pi = this.parent[i]!;
    if (pi >= 0) {
      this.evaluate(pi);
      this.posedQ[i]!.copy(this.posedQ[pi]!).multiply(this.q[i]!);
      this.posedP[i]!.copy(this.p[i]!).applyQuaternion(this.posedQ[pi]!).add(this.posedP[pi]!);
    } else {
      this.posedQ[i]!.copy(this.q[i]!);
      this.posedP[i]!.copy(this.p[i]!);
    }
    this.fresh[i] = 1;
  }

  /** Posed head of bone `i` in rig space (written into `out`). */
  pos(i: number, out: THREE.Vector3): THREE.Vector3 {
    this.evaluate(i);
    return out.copy(this.posedP[i]!);
  }

  /** Posed rig-space rotation of bone `i` (written into `out`). */
  rotation(i: number, out: THREE.Quaternion): THREE.Quaternion {
    this.evaluate(i);
    return out.copy(this.posedQ[i]!);
  }

  /** Rotation of bone `i` relative to its rest orientation, in rig space: what orient() would be handed to hold it. */
  absRotation(i: number, out: THREE.Quaternion): THREE.Quaternion {
    this.evaluate(i);
    return out.copy(this.posedQ[i]!).multiply(this.restRigQInv[i]!);
  }

  /** Rest orientation of bone `i` in rig space. */
  restRotation(i: number, out: THREE.Quaternion): THREE.Quaternion {
    return out.copy(this.restRigQ[i]!);
  }

  /** Rest head of bone `i` in rig space. */
  restPos(i: number, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.restRigPos[i]!);
  }

  /** Where a rest-pose rig-space point carried by bone `i` sits in the current pose. */
  carry(i: number, restPoint: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    this.evaluate(i);
    out.copy(restPoint).sub(this.restRigPos[i]!).applyQuaternion(this.restRigQInv[i]!);
    return out.applyQuaternion(this.posedQ[i]!).add(this.posedP[i]!);
  }

  /** Distance from a bone's head to its child's head at rest — the length an IK chain uses. */
  restLength(i: number, child: number): number {
    return this.restRigPos[child]!.distanceTo(this.restRigPos[i]!);
  }

  // -------------------------------------------------------------- setting

  /** Rotate bone `i` by Euler angles (radians, rig axes X→Y→Z) relative to its parent's posed frame. */
  rot(i: number, x: number, y: number, z: number): this {
    _q.setFromEuler(_e.set(x, y, z, 'XYZ'));
    return this.rotQ(i, _q);
  }

  /** Rotate bone `i` by a rig-axis quaternion relative to its parent's posed frame. */
  rotQ(i: number, qRig: THREE.Quaternion): this {
    // local = restLocal · restRig⁻¹ · qRig · restRig
    this.q[i]!.copy(this.restQ[i]!).multiply(this.restRigQInv[i]!).multiply(qRig).multiply(this.restRigQ[i]!);
    this.dirtyAll(i);
    return this;
  }

  /** Stack a further rig-axis rotation on top of whatever bone `i` already holds. */
  addRot(i: number, x: number, y: number, z: number): this {
    _q.setFromEuler(_e.set(x, y, z, 'XYZ'));
    // Expressed in the bone's rest frame so it composes like rot() does.
    _q2.copy(this.restRigQInv[i]!).multiply(_q).multiply(this.restRigQ[i]!);
    this.q[i]!.multiply(_q2);
    this.dirtyAll(i);
    return this;
  }

  /** Give bone `i` the absolute rig-space rotation `qAbs` relative to its rest orientation, whatever its parents do. */
  orient(i: number, qAbs: THREE.Quaternion): this {
    const pi = this.parent[i]!;
    // posed = parentPosed · local = qAbs · restRig  →  local = parentPosed⁻¹ · qAbs · restRig
    if (pi >= 0) {
      this.evaluate(pi);
      _q2.copy(this.posedQ[pi]!).invert();
    } else {
      _q2.identity();
    }
    this.q[i]!.copy(_q2).multiply(qAbs).multiply(this.restRigQ[i]!);
    this.dirtyAll(i);
    return this;
  }

  /** Move bone `i`'s head by `offset` (rig axes) from where its parent's pose puts it at rest. */
  shift(i: number, x: number, y: number, z: number): this {
    const pi = this.parent[i]!;
    _v.set(x, y, z);
    if (pi >= 0) {
      this.evaluate(pi);
      _q2.copy(this.posedQ[pi]!).invert();
      _v.applyQuaternion(_q2);
    }
    this.p[i]!.copy(this.restP[i]!).add(_v);
    this.dirtyAll(i);
    return this;
  }

  /**
   * Move bone `i`'s head by `offset`, given in rig axes *as they were at rest*
   * and carried by the parent: a brow raised "up" stays up the face when the
   * head tips, where shift() would move it straight up the world.
   */
  shiftRest(i: number, x: number, y: number, z: number): this {
    const pi = this.parent[i]!;
    _v.set(x, y, z);
    if (pi >= 0) _v.applyQuaternion(this.restRigQInv[pi]!);
    this.p[i]!.copy(this.restP[i]!).add(_v);
    this.dirtyAll(i);
    return this;
  }

  /** Put bone `i`'s head at the rig-space point `target`. */
  placeAt(i: number, target: THREE.Vector3): this {
    const pi = this.parent[i]!;
    if (pi >= 0) {
      this.evaluate(pi);
      _q2.copy(this.posedQ[pi]!).invert();
      this.p[i]!.copy(target).sub(this.posedP[pi]!).applyQuaternion(_q2);
    } else {
      this.p[i]!.copy(target);
    }
    this.dirtyAll(i);
    return this;
  }

  /**
   * Two-bone IK: rotate `upper` and `lower` so the head of `end` lands on
   * `target`, bending the joint toward `pole` (a rig-space direction). The
   * chain's twist keeps the joint's rest hinge axis perpendicular to the
   * plane of the bend, so a knee only ever folds like a knee. Out-of-reach
   * targets straighten the chain toward them.
   */
  ik2(upper: number, lower: number, end: number, target: THREE.Vector3, pole: THREE.Vector3): this {
    const p0 = this.pos(upper, new THREE.Vector3());
    const l1 = this.restLength(upper, lower);
    const l2 = this.restLength(lower, end);
    const to = _v.copy(target).sub(p0);
    const dist = Math.min(Math.max(to.length(), Math.abs(l1 - l2) + 1e-4), (l1 + l2) * 0.9995);
    const d = to.normalize().clone();
    const pl = _v2.copy(pole).addScaledVector(d, -pole.dot(d));
    if (pl.lengthSq() < 1e-10) pl.set(1, 0, 0).addScaledVector(d, -d.x);
    pl.normalize();
    const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
    const a = Math.acos(Math.max(-1, Math.min(1, cosA)));
    const joint = p0.clone().addScaledVector(d, Math.cos(a) * l1).addScaledVector(pl, Math.sin(a) * l1);
    const end3 = p0.clone().addScaledVector(d, dist);
    // (joint − p0) × (end − joint) is parallel to pole × dir for any bend, so
    // this is the bend axis in the same sign convention as restHinge's.
    const hinge = new THREE.Vector3().crossVectors(pl, d).normalize();
    const restHinge = this.restHinge(upper, lower, end);
    this.aim(upper, lower, joint.clone().sub(p0).normalize(), hinge, restHinge);
    this.aim(lower, end, end3.sub(joint).normalize(), hinge, restHinge);
    return this;
  }

  /**
   * The chain's bend axis at rest: (joint − head) × (end − joint). The worker
   * rig is bound with every knee and elbow slightly bent, so this is defined
   * by the skeleton itself — fixed per chain, whatever pole a pose asks for.
   */
  private restHinge(upper: number, lower: number, end: number): THREE.Vector3 {
    const cached = this.hinges.get(upper);
    if (cached) return cached;
    const a = this.restRigPos[lower]!.clone().sub(this.restRigPos[upper]!);
    const b = this.restRigPos[end]!.clone().sub(this.restRigPos[lower]!);
    const h = a.cross(b);
    if (h.lengthSq() < 1e-12) throw new Error(`RigPoser: chain at ${this.names[upper]} is straight at rest; its bend axis is undefined`);
    h.normalize();
    this.hinges.set(upper, h);
    return h;
  }

  /**
   * Turn bone `i` so the rig-space directions `restA`/`restB` it carries at
   * rest end up along `wantA`/`wantB` (B is orthogonalised against A). How a
   * hand is aimed: fingers one way, thumb another, the held tool following.
   */
  orientBasis(i: number, restA: THREE.Vector3, restB: THREE.Vector3, wantA: THREE.Vector3, wantB: THREE.Vector3): this {
    const ra = restA.clone().normalize();
    const rb = restB.clone().addScaledVector(ra, -restB.dot(ra)).normalize();
    const wa = wantA.clone().normalize();
    const wb = wantB.clone().addScaledVector(wa, -wantB.dot(wa)).normalize();
    const rest = basis(_m, ra, rb);
    const want = basis(_m2, wa, wb);
    const r = new THREE.Matrix4().setFromMatrix3(want.multiply(rest.transpose()));
    return this.orient(i, _q.setFromRotationMatrix(r));
  }

  /** Orient bone `i` (pointing at its child `c`) along `dir`, with `restHinge` mapped onto `hinge`. */
  private aim(i: number, c: number, dir: THREE.Vector3, hinge: THREE.Vector3, restHinge: THREE.Vector3): void {
    const restDir = this.restRigPos[c]!.clone().sub(this.restRigPos[i]!).normalize();
    const hr = restHinge.clone().addScaledVector(restDir, -restHinge.dot(restDir)).normalize();
    const hw = hinge.clone().addScaledVector(dir, -hinge.dot(dir)).normalize();
    const rest = basis(_m, restDir, hr);
    const want = basis(_m2, dir, hw);
    // R = want · restᵀ, as a quaternion
    const r = new THREE.Matrix4().setFromMatrix3(want.multiply(rest.transpose()));
    this.orient(i, _q.setFromRotationMatrix(r));
  }

  // ---------------------------------------------------------------- output

  /** Copy the working pose into `out` (allocated with `createBuffer`). */
  capture(out: PoseBuffer): PoseBuffer {
    for (let i = 0; i < this.q.length; i++) {
      this.q[i]!.toArray(out.q, i * 4);
      this.p[i]!.toArray(out.p, i * 3);
    }
    return out;
  }

  createBuffer(): PoseBuffer {
    return { q: new Float32Array(this.q.length * 4), p: new Float32Array(this.q.length * 3) };
  }

  /** Write `pose` onto the scene's bones. */
  apply(pose: PoseBuffer): void {
    for (let i = 0; i < this.bones.length; i++) {
      const b = this.bones[i]!;
      b.quaternion.fromArray(pose.q, i * 4);
      b.position.fromArray(pose.p, i * 3);
    }
  }
}

/** Rotation matrix whose columns are (dir, hinge, dir × hinge). */
function basis(out: THREE.Matrix3, dir: THREE.Vector3, hinge: THREE.Vector3): THREE.Matrix3 {
  const third = new THREE.Vector3().crossVectors(dir, hinge);
  return out.set(
    dir.x, hinge.x, third.x,
    dir.y, hinge.y, third.y,
    dir.z, hinge.z, third.z,
  );
}

/** Blend `b` into `a` by weight `t` (0 keeps `a`), in place: nlerp per quaternion, lerp per position. */
export function blendPose(a: PoseBuffer, b: PoseBuffer, t: number): PoseBuffer {
  if (t <= 0) return a;
  const n = a.q.length / 4;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let dot = a.q[o]! * b.q[o]! + a.q[o + 1]! * b.q[o + 1]! + a.q[o + 2]! * b.q[o + 2]! + a.q[o + 3]! * b.q[o + 3]!;
    const s = dot < 0 ? -1 : 1;
    dot = 0;
    for (let k = 0; k < 4; k++) {
      const v = a.q[o + k]! + (b.q[o + k]! * s - a.q[o + k]!) * t;
      a.q[o + k] = v;
      dot += v * v;
    }
    const inv = 1 / Math.sqrt(dot || 1);
    for (let k = 0; k < 4; k++) a.q[o + k] = a.q[o + k]! * inv;
  }
  for (let i = 0; i < a.p.length; i++) a.p[i] = a.p[i]! + (b.p[i]! - a.p[i]!) * t;
  return a;
}
