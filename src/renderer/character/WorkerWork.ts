// BlastSimulator2026 — Worker tools in motion
// How each role carries its tool about, and what it does with it on the job.
// Carry poses overlay the walk and the idle (the manager's mug stays level at
// his chest, the surveyor keeps his clipboard up, the driver slings his wrench
// on his shoulder), held out where the game camera can see them past the hat
// brim. Work poses are whole-body loops played while a task ticks down, each
// one doing something *to* something: the driller leans on a drill planted in
// the rock, the blaster slams a plunger whose box sits on the ground, the
// driver kneels and hauls a wrench round a nut, the surveyor sights along his
// arm and scribbles, the manager points and sips his coffee.
//
// Hands are aimed by their finger and thumb directions and placed by their
// grip — the tool's own rest position in the fist — so a tool goes exactly
// where the pose asks whatever the arm length.

import * as THREE from 'three';
import type { Side, WorkerRig } from './WorkerRig.js';
import { SIDES } from './WorkerRig.js';
import { basis, curlFinger, DEG, hangArm, keyed, lerp, placeFoot, smooth, type Temperament } from './WorkerMotion.js';

const TAU = Math.PI * 2;
const _grip = new THREE.Vector3();
const _knee = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _f = new THREE.Vector3();
const _t = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
// reach()'s own scratch — never handed to it as an argument.
const _rWrist = new THREE.Vector3();
const _rOff = new THREE.Vector3();
const _rQ = new THREE.Quaternion();

/** The tool's grip relative to the wrist at rest, for either hand (the other hand is the mirror image). */
function gripOffset(rig: WorkerRig, s: Side, out: THREE.Vector3): THREE.Vector3 {
  out.copy(rig.gripOffset);
  if (rig.toolSide && s !== rig.toolSide) out.z = -out.z;
  if (!rig.toolSide) out.set(0.0, -0.06, rig.rest[s].sign * -0.03);
  return out;
}

/**
 * Put hand `s`'s grip on `grip`, fingers along `finger` and thumb along
 * `thumb` (rig-space directions), the elbow bent toward `elbowDir`.
 */
function reach(rig: WorkerRig, s: Side, grip: THREE.Vector3, finger: THREE.Vector3, thumb: THREE.Vector3, elbowDir: THREE.Vector3): void {
  const P = rig.poser;
  const b = rig.limbs[s];
  const r = rig.rest[s];
  // The hand's absolute turn maps the rest finger/thumb onto the wanted ones;
  // the wrist sits where that turn carries the rest grip offset back from the grip.
  basis(r.finger, r.thumb, finger, thumb, _rQ);
  gripOffset(rig, s, _rOff).applyQuaternion(_rQ);
  _rWrist.copy(grip).sub(_rOff);
  P.ik2(b.upperArm, b.forearm, b.hand, _rWrist, elbowDir);
  P.orient(b.hand, _rQ);
}

/** Point relative to the hips joint, in rig space: forward, up, right. */
function body(rig: WorkerRig, fwd: number, up: number, right: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(fwd, rig.hipHeight + up, right);
}

function dir(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(x, y, z).normalize();
}

// ----------------------------------------------------------------- carry

/**
 * Overlay the role's way of carrying its tool on whatever the body is doing.
 * `walk` 0..1 tells how much the arms are swinging, so a held tool can sway
 * with the stride. The caller fades this out when the worker is spent: an
 * exhausted man lets his tool hang.
 */
export function carryTool(rig: WorkerRig, role: string, temp: Temperament, t: number, phase: number, walk: number, seed: number): void {
  const P = rig.poser;
  const sw = Math.cos(TAU * phase) * walk;
  const lag = Math.cos(TAU * (phase - 0.12)) * walk;
  const R = rig.rest.R.sign;
  const L = rig.rest.L.sign;
  const still = walk < 0.5;
  switch (role) {
    case 'manager': {
      // Mug held level out in front of the belly; a sip now and then while standing,
      // the other fist planted on his hip.
      const sip = (1 - walk) * smooth((Math.sin(t * 0.45 + seed) - 0.75) * 5);
      const hand = body(rig, lerp(0.3, 0.2, sip), lerp(0.22, 0.5, sip) + 0.012 * sw, R * lerp(0.17, 0.07, sip), _grip);
      reach(rig, 'R', hand, dir(1, -0.1 - 0.5 * sip, -0.1 * R, _f), dir(-0.1, 1, 0, _t), dir(-0.3, -1, 0.6 * R, _pole));
      if (sip > 0.01) P.addRot(rig.head, 0, 0, 0.25 * sip);
      if (still) handOnHip(rig, 'L', 0.03);
      // His free arm swings with an extra strut.
      else P.addRot(rig.limbs.L.upperArm, 0, 0, sw * 10 * DEG);
      break;
    }
    case 'surveyor': {
      // Clipboard held up across the chest, tilted back toward his face; hugged higher and
      // closer while he stands reading it.
      const hold = still ? 1 : 0;
      const hand = body(rig, lerp(0.25, 0.2, hold), lerp(0.22, 0.3, hold) + 0.008 * sw, L * lerp(0.1, 0.05, hold), _grip);
      reach(rig, 'L', hand, dir(0.1, 0.12, -L, _f), dir(0.55, 0.84, 0, _t), dir(-0.3, -1, 0.5 * L, _pole));
      if (still) P.addRot(rig.head, 0, -L * 0.12, -0.1);
      break;
    }
    case 'driver': {
      // Wrench slung along the top of his shoulder while he stands, the other fist on his hip;
      // swung at his side, a beat behind the arm, as he walks.
      if (still) {
        const hand = body(rig, -0.03, 0.4, R * 0.31, _grip);
        reach(rig, 'R', hand, dir(-0.4, 0.2, -R, _f), dir(-0.7, 0.6, 0.25 * R, _t), dir(0.4, -1, 0.5 * R, _pole));
        handOnHip(rig, 'L', 0.0);
      } else {
        // The shaft runs along the fist's thumb side: thumb down, it hangs along his leg.
        hangArm(rig, 'R', temp, sw * 16 * DEG + 4 * DEG, 8 * DEG, 20 * DEG);
        P.orientBasis(rig.limbs.R.hand, rig.rest.R.finger, rig.rest.R.thumb, _f.set(0.8, 0.1, -0.5 * R), _t.set(0.2 - 0.35 * lag, -1, 0.05 * R));
      }
      break;
    }
    case 'driller': {
      // The drill hangs heavy and plumb from his fist, bit down, swinging a beat behind the
      // arm; he leans away from its weight, the shoulder dragged down, the free arm out.
      hangArm(rig, 'R', temp, sw * 8 * DEG + 4 * DEG, 14 * DEG, (10 + 6 * walk) * DEG);
      P.orientBasis(rig.limbs.R.hand, rig.rest.R.finger, rig.rest.R.thumb, _f.set(-0.25 * lag, -1, 0.04 * R), _t.set(1, 0, 0));
      leanFrom(rig, 'R', 8);
      break;
    }
    case 'blaster': {
      // Detonator dangling by its handle off a near-straight arm. Fist, plunger rod and box
      // hang plumb as one piece — the rod rides in the fist — and swing a beat behind the arm.
      hangArm(rig, 'L', temp, sw * 10 * DEG + 6 * DEG + walk * 14 * DEG, 10 * DEG, (12 + 14 * walk + 6 * Math.abs(sw)) * DEG);
      _f.set(-0.3 * lag, -1, 0.05 * Math.sin(t * 1.3));
      _t.set(1, 0, 0);
      P.orientBasis(rig.limbs.L.hand, rig.rest.L.finger, rig.rest.L.thumb, _f, _t);
      if (rig.tool >= 0) P.orientBasis(rig.tool, rig.rest.L.finger, rig.rest.L.thumb, _f, _t);
      leanFrom(rig, 'L', 6);
      break;
    }
    default:
      break;
  }
}

/** Lean the trunk away from a heavy load in hand `s` (degrees), that shoulder dragged down, the other arm out. */
function leanFrom(rig: WorkerRig, s: Side, degrees: number): void {
  const P = rig.poser;
  const sign = rig.rest[s].sign;
  const other: Side = s === 'L' ? 'R' : 'L';
  P.addRot(rig.spine, -sign * degrees * DEG, 0, 0);
  P.addRot(rig.limbs[s].shoulder, -sign * 0.1, 0, 0);
  P.addRot(rig.limbs[other].upperArm, -rig.rest[other].sign * degrees * 1.5 * DEG, 0, 0);
}

/** Fist on the hip, elbow out: the knuckles just above and outside the hip joint, `fwd` forward of it. */
function handOnHip(rig: WorkerRig, s: Side, fwd: number): void {
  const P = rig.poser;
  const sign = rig.rest[s].sign;
  const hip = P.pos(rig.limbs[s].thigh, _v);
  _w.set(hip.x + fwd, hip.y + HIP_HAND_UP, hip.z + sign * HIP_HAND_OUT);
  reach(rig, s, _w, dir(-0.2, -1, -sign * 0.5, _f), dir(1, 0, 0, _t), dir(-0.6, 0.1, sign, _pole));
}

// ------------------------------------------------------------------ work

function stand(rig: WorkerRig, temp: Temperament, spread: number, back: number): void {
  for (const s of SIDES) {
    const r = rig.rest[s];
    placeFoot(rig, s, s === 'R' ? -back : back * 0.4, 0, 0, r.sign * (temp.stance + spread), false, -r.sign * 10 * DEG);
  }
}

/** The role's job, looped: `t` is seconds into the task. */
export function poseWork(rig: WorkerRig, role: string, temp: Temperament, t: number, seed: number): void {
  const P = rig.poser.reset();
  const R = rig.rest.R.sign;
  const L = rig.rest.L.sign;
  switch (role) {
    case 'driller': {
      // Bent over a drill planted in the rock, leaning his weight on it: the whole body
      // judders with it — hat and shoulders bouncing, the head a beat behind — and every
      // couple of seconds he crouches into the bite, then pulls the bit and resets.
      const j = Math.sin(t * TAU * 7.5);
      const jLag = Math.sin(t * TAU * 7.5 - 1.2);
      const sink = keyed((t / 2.4 + seed * 0.1) % 1, [[0, 0], [0.6, 1], [0.75, 1], [0.85, -0.3], [1, 0]]);
      P.shift(rig.hips, -0.06, -0.1 - 0.09 * sink + 0.012 * j, 0);
      P.rot(rig.hips, 0, -6 * DEG, 0);
      P.rot(rig.spine, 0.02 * j, 4 * DEG, -(24 + 6 * sink) * DEG);
      P.rot(rig.chest, 0.03 * jLag, 2 * DEG, -10 * DEG);
      for (const s of SIDES) P.rot(rig.limbs[s].shoulder, rig.rest[s].sign * 0.05 * j, 0, 0);
      P.rot(rig.neck, 0, 0, 10 * DEG);
      P.rot(rig.head, 0.05 * jLag, 0, (8 + 4 * jLag) * DEG);
      if (rig.hat >= 0) P.shiftRest(rig.hat, 0, 0.015 * Math.abs(jLag), 0);
      stand(rig, temp, 0.07, 0.12);
      // The bit, near vertical: the fist's fingers point down it, the drill body forward.
      const down = dir(0.25, -1, 0, _f);
      const fwd = dir(1, 0.25, 0, _t);
      // The grip sits where the bit's tip lands on the rock, and goes down with it as it bites.
      const grip = _grip.set(0.24 + 0.012 * j, 0, R * 0.05);
      grip.y = -(DRILL_BIT * down.y + DRILL_BODY * fwd.y) - 0.04 * Math.max(0, sink) + 0.018 * j;
      reach(rig, 'R', grip, down, fwd, dir(-0.2, 0, R, _pole));
      // Left hand on top of the motor, pushing down.
      const top = _v.copy(grip).addScaledVector(fwd, 0.1).addScaledVector(down, -0.13);
      top.z -= R * 0.02;
      reach(rig, 'L', top, dir(0.3, -1, 0.15 * R, _w), dir(1, 0.2, 0, _knee), dir(-0.2, 0, L, _pole));
      break;
    }
    case 'blaster': {
      // The box sits on the rock. He hauls the plunger up, coiled over it on his toes — a
      // held breath — then throws his whole weight down onto it, knees buckling, and his
      // head snaps up grinning.
      const cyc = (t / 1.9 + seed * 0.1) % 1;
      const bar = keyed(cyc, [[0, PLUNGER_IN], [0.3, PLUNGER_OUT], [0.52, PLUNGER_OUT + 0.01], [0.6, PLUNGER_IN],
        [0.85, PLUNGER_IN], [1, PLUNGER_IN]]);
      const up = smooth((bar - PLUNGER_IN) / (PLUNGER_OUT - PLUNGER_IN));
      const jolt = keyed(cyc, [[0, 0], [0.58, 0], [0.62, 1], [0.74, 0], [1, 0]]);
      P.shift(rig.hips, -0.04 - 0.03 * (1 - up), lerp(-0.27, -0.16, up) - 0.03 * jolt, 0);
      P.rot(rig.spine, 0, 0, -lerp(30, 22, up) * DEG);
      P.rot(rig.chest, 0, 0, -lerp(16, 6, up) * DEG);
      P.rot(rig.neck, 0, 0, lerp(4, 10, up) * DEG);
      P.rot(rig.head, 0.06 * Math.sin(t * 9) * jolt, 0.1 * Math.sin(t * 2), (6 + 16 * jolt) * DEG);
      if (rig.hat >= 0) P.shiftRest(rig.hat, 0, 0.05 * jolt, 0);
      for (const s of SIDES) {
        const r = rig.rest[s];
        // Up on his toes for the wind-up; one heel kicks on the slam.
        const heel = -0.45 * up - (s === 'R' ? 0.6 * jolt : 0);
        placeFoot(rig, s, s === 'R' ? -0.06 : 0.02, 0, heel, r.sign * (temp.stance + 0.1), true);
      }
      // Only the plunger moves: the box stays on the ground and the rod slides into it.
      const barPos = _grip.set(0.3, bar, 0.0);
      reach(rig, 'L', barPos, dir(0, -1, 0, _f), dir(1, 0, 0, _v), dir(-0.4, 0.3, L, _pole));
      if (rig.tool >= 0) {
        P.placeAt(rig.tool, _w.set(barPos.x, DETONATOR_FLOOR, barPos.z));
        P.orientBasis(rig.tool, rig.rest.L.finger, rig.rest.L.thumb, _f.set(0, -1, 0), _pole.set(1, 0, 0));
      }
      const other = _knee.copy(barPos).setY(barPos.y + 0.02);
      other.z += R * 0.09;
      reach(rig, 'R', other, dir(0, -1, 0.1 * R, _f), dir(1, 0, 0, _v), dir(-0.4, 0.3, R, _pole));
      break;
    }
    case 'driver': {
      // Down on one knee at a wheel hub, hauling the wrench round the nut in front of him —
      // ten o'clock round to four — shoulders turning into it, a strained hold, a reset.
      const cyc = (t / 2.0 + seed * 0.1) % 1;
      const pull = keyed(cyc, [[0, 0], [0.55, 1], [0.75, 1], [0.9, 0], [1, 0]]);
      const strain = keyed(cyc, [[0, 0], [0.5, 0.3], [0.6, 1], [0.75, 1], [0.85, 0], [1, 0]]);
      P.shift(rig.hips, -0.08 - 0.025 * strain, -0.2, 0);
      P.rot(rig.spine, 0, lerp(10, -14, pull) * DEG, -10 * DEG);
      P.rot(rig.chest, lerp(-4, 8, pull) * DEG + 0.03 * strain * Math.sin(t * 40), lerp(8, -12, pull) * DEG, -6 * DEG);
      P.rot(rig.neck, 0, 0, 6 * DEG);
      P.rot(rig.head, 0, 0, (4 - 6 * strain) * DEG);
      // Left foot forward, right knee down.
      placeFoot(rig, 'L', 0.16, 0, 0, L * (temp.stance + 0.04), false);
      placeFoot(rig, 'R', -0.3, 0.02, -0.9, R * (temp.stance + 0.04), true);
      // The nut is fixed at hub height, its axle pointing at him; the wrench turns about it
      // in his frontal plane, so the hand never rises past his chest.
      const nut = _v.set(0.45, WHEEL_HUB, R * 0.04);
      const ang = lerp(150, 330, pull) * DEG;  // round the nut: ten o'clock (left, up) to four
      const handle = dir(0, Math.sin(ang), -Math.cos(ang) * R, _w);
      const grip = _grip.copy(nut).addScaledVector(handle, WRENCH_REACH);
      reach(rig, 'R', grip, dir(1, 0, 0, _f), _t.copy(handle).negate(), dir(-0.3, -0.6, R, _pole));
      // The free hand braced on the front knee.
      const knee = P.pos(rig.limbs.L.shin, _knee).add(_f.set(0.04, 0.05, 0.02));
      reach(rig, 'L', knee, dir(0.3, -1, 0.2, _f), dir(1, 0, 0, _t), dir(-0.3, 0.1, L, _pole));
      break;
    }
    case 'surveyor': {
      // Sights along his outstretched arm at the rock, then hoists the clipboard
      // to his chin and scribbles it down from the elbow.
      const cyc = (t / 4.4 + seed * 0.13) % 1;
      const sight = keyed(cyc, [[0, 0], [0.1, 1], [0.38, 1], [0.48, 0], [1, 0]]);
      const shift = Math.sin(TAU * cyc);
      P.shift(rig.hips, 0, -0.012, 0.02 * shift);
      P.rot(rig.hips, -3 * DEG * shift, 0, 0);
      P.rot(rig.spine, 0, 0.12 * sight, -4 * DEG);
      P.rot(rig.chest, 0, 0.14 * sight, -4 * DEG);
      P.rot(rig.neck, 0, 0.08 * sight, lerp(14, -4, sight) * DEG);
      P.rot(rig.head, 0, 0.06 * sight, lerp(16, -6, sight) * DEG);
      stand(rig, temp, 0.02, 0.02);
      const board = body(rig, lerp(0.27, 0.2, sight), lerp(0.34, 0.16, sight), L * 0.08, _grip);
      reach(rig, 'L', board, dir(0.1, 0.15, -L, _f), dir(0.5, 0.86, 0, _t), dir(-0.3, -1, 0.5 * L, _pole));
      if (sight > 0.5) {
        // Arm straight out at eye level, pencil up like a sighting stick.
        const out = body(rig, 0.5, 0.44, R * 0.12, _v);
        reach(rig, 'R', out, dir(1, 0.1, 0, _f), dir(0, 1, 0, _w), dir(0, -1, R, _pole));
      } else {
        const scribble = _v.set(0.25 + 0.025 * Math.sin(t * TAU * 2.1), rig.hipHeight + 0.38 + 0.02 * Math.sin(t * TAU * 1.3), 0);
        reach(rig, 'R', scribble, dir(0.4, -0.5, -0.7 * R, _f), dir(0.7, 0.6, 0.2 * R, _w), dir(-0.2, -1, 0.8 * R, _pole));
      }
      break;
    }
    case 'manager': {
      // Supervision: jabs a finger at the pit on every beat — the whole body behind it, up
      // on one toe — then leans back for a sip with a hand on his belly.
      const cyc = (t / 4.4 + seed * 0.07) % 1;
      const sip = keyed(cyc, [[0, 0], [0.55, 0], [0.64, 1], [0.82, 1], [0.92, 0], [1, 0]]);
      const point = 1 - smooth(sip * 2);
      const beat = (t * 1.1) % 1;
      const jab = keyed(beat, [[0, 0], [0.12, 1], [0.5, 1], [0.75, 0], [1, 0]]) * point;
      P.shift(rig.hips, 0.01 + 0.03 * jab, -0.012, 0);
      P.rot(rig.hips, 0, 6 * DEG, 0);
      P.rot(rig.spine, 0, 0, (6 - 10 * jab + 6 * sip) * DEG);
      P.rot(rig.chest, 0, -8 * DEG * point, (4 - 4 * jab + 8 * sip) * DEG);
      P.rot(rig.head, 0, lerp(0.15, 0, sip), lerp(-4 - 6 * jab, 20, sip) * DEG);
      for (const s of SIDES) {
        const r = rig.rest[s];
        placeFoot(rig, s, s === 'R' ? -0.03 : 0.03, 0, s === 'R' ? -0.4 * jab : 0, r.sign * (temp.stance + 0.02), true, -r.sign * 10 * DEG);
      }
      const mug = body(rig, lerp(0.28, 0.17, sip), lerp(0.22, 0.48, sip), R * lerp(0.17, 0.03, sip), _grip);
      reach(rig, 'R', mug, dir(1, -0.1 + 0.55 * sip, -0.1 * R, _f), dir(-0.1 - 0.4 * sip, 1, 0, _t), dir(-0.3, -1, 0.6 * R, _pole));
      if (sip > 0.3) {
        // Free hand patting the belly.
        const belly = body(rig, 0.26, 0.1, L * 0.05, _v);
        reach(rig, 'L', belly, dir(0.2, -0.4, -L, _f), dir(1, 0.3, 0, _t), dir(-0.2, -1, L, _pole));
        curlFinger(rig, 1);
      } else {
        // The arm snaps from a bent elbow to full extension on each jab.
        const tip = body(rig, lerp(0.22, 0.55, jab), lerp(0.28, 0.4, jab), L * 0.12, _v);
        reach(rig, 'L', tip, dir(1, 0.1, 0.1 * L, _f), dir(0, 1, 0, _t), dir(0, -1, 0.6 * L, _pole));
        curlFinger(rig, 1 - point);
      }
      break;
    }
    default:
      break;
  }
}

/** A fist planted on the hip: above and outside the hip joint (m). */
const HIP_HAND_UP = 0.1;
const HIP_HAND_OUT = 0.13;
/** Detonator: the grip (T-bar) above the box's floor with the plunger up (worker_props DETONATOR_TOP + DETONATOR_BOX). */
const DETONATOR_FLOOR = 0.3;
/** The plunger's stroke: the T-bar's height with the rod pulled out, and pushed home just above the lid (17 cm). */
const PLUNGER_OUT = DETONATOR_FLOOR;
const PLUNGER_IN = 0.2;
/** A wheel hub's height off the ground, where the kneeling driver's nut sits. */
const WHEEL_HUB = 0.36;
/** Drill: from the fist's grip to the bit's tip, along the fingers and along the thumb (worker_props._drill). */
const DRILL_BIT = 0.243;
const DRILL_BODY = 0.095;
/** Wrench: from the fist's grip to the centre of its jaw. */
const WRENCH_REACH = 0.285;
