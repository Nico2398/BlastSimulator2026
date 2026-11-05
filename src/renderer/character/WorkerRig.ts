// BlastSimulator2026 — Worker rig
// Names every bone of the crew skeleton (assets/models/blender/workers.py)
// once, and measures the body it was built for — leg length, hip height,
// where the feet stand, which way each hand's fingers and thumb point — so
// the motion code works for the stocky driller and the lanky surveyor alike
// without a per-role constant.

import * as THREE from 'three';
import { RigPoser } from './RigPoser.js';

export type Side = 'L' | 'R';
export const SIDES: readonly Side[] = ['L', 'R'];

/** Bone indices of one side's limbs. */
interface LimbBones {
  shoulder: number;
  upperArm: number;
  forearm: number;
  hand: number;
  thigh: number;
  shin: number;
  foot: number;
  toe: number;
  lid: number;
  brow: number;
}

/** How far the gasp mouth waits inside the skull (worker_face.GASP_HIDE). */
export const GASP_HIDE = 0.04;

/** Rest-pose measurements of one side, rig space (+X front, +Y up, +Z right). */
interface LimbRest {
  /** -1 on the left (−Z), +1 on the right. */
  sign: number;
  hip: THREE.Vector3;
  ankle: THREE.Vector3;
  /** Ball of the foot — the toe joint itself, which stays put while the heel peels and the toe lies flat — and the heel's ground contact. */
  ball: THREE.Vector3;
  heel: THREE.Vector3;
  shoulder: THREE.Vector3;
  wrist: THREE.Vector3;
  /** Rest direction of the fingers (wrist → fingertips) and of the thumb. */
  finger: THREE.Vector3;
  thumb: THREE.Vector3;
  legLength: number;
  armLength: number;
  /** Elevation (radians) of the lid's front edge when the eye rests open — how far it turns to shut. */
  lidOpen: number;
}

export interface WorkerRig {
  poser: RigPoser;
  hips: number;
  spine: number;
  chest: number;
  neck: number;
  head: number;
  /** The role's tool bone (child of the tool hand), or -1. */
  tool: number;
  /** The hard hat's bone (child of the head) — knocked off in a collapse. */
  hat: number;
  /** The everyday mouth and the gaping one parked inside the skull (WorkerMotion swaps them). */
  mouth: number;
  gasp: number;
  /** The manager's pointing finger (child of HandL), or -1. */
  finger: number;
  /** Which hand holds the tool, when there is one. */
  toolSide: Side | null;
  /** The leg an injured worker favours: the free hand's side, so that hand can clutch it. */
  limpSide: Side;
  limbs: Record<Side, LimbBones>;
  rest: Record<Side, LimbRest>;
  /** Rest height of the hips joint. */
  hipHeight: number;
  /** Rest head of the tool bone relative to its hand's wrist (rig space). */
  gripOffset: THREE.Vector3;
}

/** Heel contact sits this far behind the ankle — the boot's back, in metres. */
const HEEL_BACK = 0.06;

/** Name the crew skeleton's bones; null when the model is not a worker rig. */
export function workerRig(root: THREE.Object3D): WorkerRig | null {
  const poser = RigPoser.fromModel(root);
  if (!poser || !poser.has('Hips') || !poser.has('ThighL') || !poser.has('HandR')) return null;
  const id = (n: string): number => poser.id(n);
  const limbs = {} as Record<Side, LimbBones>;
  const rest = {} as Record<Side, LimbRest>;
  const v = (i: number): THREE.Vector3 => poser.restPos(i, new THREE.Vector3());
  const q = new THREE.Quaternion();
  for (const s of SIDES) {
    const b: LimbBones = {
      shoulder: id(`Shoulder${s}`), upperArm: id(`UpperArm${s}`), forearm: id(`Forearm${s}`), hand: id(`Hand${s}`),
      thigh: id(`Thigh${s}`), shin: id(`Shin${s}`), foot: id(`Foot${s}`), toe: id(`Toe${s}`),
      lid: id(`Lid${s}`), brow: id(`Brow${s}`),
    };
    limbs[s] = b;
    const ankle = v(b.foot);
    const ball = v(b.toe);
    const elbow = v(b.forearm);
    const wrist = v(b.hand);
    const finger = wrist.clone().sub(elbow).normalize();
    const thumb = new THREE.Vector3(1, 0, 0).addScaledVector(finger, -finger.x).normalize();
    rest[s] = {
      sign: ankle.z < 0 ? -1 : 1,
      hip: v(b.thigh), ankle, ball,
      heel: new THREE.Vector3(ankle.x - HEEL_BACK, 0, ankle.z),
      shoulder: v(b.upperArm), wrist, finger, thumb,
      legLength: poser.restLength(b.thigh, b.shin) + poser.restLength(b.shin, b.foot),
      armLength: poser.restLength(b.upperArm, b.forearm) + poser.restLength(b.forearm, b.hand),
      // A bone's local +Y runs head to tail; the lid bone's tail marks its edge's resting elevation.
      lidOpen: Math.asin(Math.max(-1, Math.min(1, new THREE.Vector3(0, 1, 0).applyQuaternion(poser.restRotation(b.lid, q)).y))),
    };
  }
  const tool = poser.has('Tool') ? id('Tool') : -1;
  const opt = (n: string): number => (poser.has(n) ? id(n) : -1);
  let toolSide: Side | null = null;
  const gripOffset = new THREE.Vector3();
  if (tool >= 0) {
    const toolPos = v(tool);
    toolSide = toolPos.distanceTo(rest.L.wrist) < toolPos.distanceTo(rest.R.wrist) ? 'L' : 'R';
    gripOffset.copy(toolPos).sub(rest[toolSide].wrist);
  }
  return {
    poser, hips: id('Hips'), spine: id('Spine'), chest: id('Chest'), neck: id('Neck'), head: id('Head'),
    tool, toolSide, limpSide: toolSide === 'R' ? 'L' : 'R', hat: opt('Hat'), mouth: opt('Mouth'), gasp: opt('Gasp'), finger: opt('Finger'),
    limbs, rest, hipHeight: v(id('Hips')).y, gripOffset,
  };
}
