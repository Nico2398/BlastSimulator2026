// BlastSimulator2026 — Worker motion
// The crew's body language, posed procedurally every frame on the skeleton:
// a quick short-legged walk that turns into a run with a flight phase, a
// limp that lurches onto the bad leg, a contrapposto idle that shifts its
// weight from leg to leg in each role's own posture, an exhausted sag onto
// the knees, a fleeing panic — hunched, glancing back, one hand clamping the
// hat on — and the collapse when fatigue wins: tool dropped, hat knocked off,
// hands coming to rest. Every function poses the whole rig from rest into
// the poser; WorkerAnimator blends the results and adds the face.
//
// Rig space: +X the worker's front, +Y up, +Z its right (the left side is −Z).
// RigPoser sign guide: about Z (+) a hanging limb swings forward and an upright
// bone tips back; about X (+) a hanging limb swings to the right; about Y (+) yaw left.

import * as THREE from 'three';
import type { Side, WorkerRig } from './WorkerRig.js';
import { GASP_HIDE, SIDES } from './WorkerRig.js';

export const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/** Per-role temperament: how much a body type sways, bounces and swings. */
export interface Temperament {
  /** Hang angle of the arms off the body, degrees (the bind pose has them 24° out). */
  armSpread: number;
  /** Side-to-side waddle of the hips, metres, and their roll, degrees. */
  waddle: number;
  roll: number;
  /** Vertical bounce per step, metres. */
  bounce: number;
  /** Arm swing at full walk, degrees. */
  armSwing: number;
  /** Feet apart beyond the hips, metres (positive = wider stance). */
  stance: number;
  /** Habitual forward lean of the torso, degrees (negative leans back). */
  lean: number;
  /** Bounce on the toes while standing, metres (the blaster can't keep still). */
  fidget: number;
  /** Lying on his back, how far above the hips joint the front of his belly is, metres. */
  belly: number;
}

export const TEMPERAMENT: Record<string, Temperament> = {
  // Heavy and planted: wide stance, fists held off the thighs.
  driller: { armSpread: 28, waddle: 0.022, roll: 4, bounce: 0.02, armSwing: 22, stance: 0.085, lean: 5, fidget: 0, belly: 0.17 },
  // Twitchy and hunched, up on his toes.
  blaster: { armSpread: 12, waddle: 0.01, roll: 4, bounce: 0.035, armSwing: 30, stance: 0.015, lean: 14, fidget: 0.022, belly: 0.11 },
  // Swagger: lats out, rolling shoulders.
  driver: { armSpread: 30, waddle: 0.03, roll: 10, bounce: 0.012, armSwing: 20, stance: 0.06, lean: -2, fidget: 0, belly: 0.16 },
  // Stiff and narrow, knees together, peering forward.
  surveyor: { armSpread: 8, waddle: 0.008, roll: 3, bounce: 0.022, armSwing: 12, stance: -0.012, lean: 8, fidget: 0, belly: 0.11 },
  // The strut: leaning back behind his belly, hips rolling.
  manager: { armSpread: 30, waddle: 0.042, roll: 8, bounce: 0.008, armSwing: 14, stance: 0.03, lean: -14, fidget: 0, belly: 0.2 },
};
const BIND_ARM_SPREAD = 24;

/** What the gait needs to know this frame. */
export interface GaitState {
  /** Cycle phase 0..1 (left heel strikes at 0, right at 0.5). */
  phase: number;
  /** Ground covered per full cycle (two steps), metres. */
  stride: number;
  /** Fraction of the cycle each foot is on the ground: 0.6 a walk, under 0.5 a run with flight. */
  duty: number;
  /** How far the hips sink at the low point of the step, metres. */
  crouch: number;
  /** 0 walking .. 1 running (arms pump, body leans and bounces more). */
  run: number;
  /** Yaw rate, rad/s (+ turning left) — the body banks into turns. */
  turn: number;
  /** 0..1 injured: a limp on the right leg. */
  limp: number;
  /** 0..1 exhausted: a shuffle. */
  tired: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _e = new THREE.Euler();
const X = new THREE.Vector3(1, 0, 0);

export function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function frac(x: number): number {
  return x - Math.floor(x);
}

/** Interpolate (time, value) keys with an ease between each pair. */
export function keyed(t: number, keys: readonly (readonly [number, number])[]): number {
  if (t <= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i]!;
    if (t <= t1) {
      const [t0, v0] = keys[i - 1]!;
      return v0 + (v1 - v0) * smooth((t - t0) / (t1 - t0 || 1));
    }
  }
  return keys[keys.length - 1]![1];
}

/** Cheap smooth noise in −1..1: a sum of incommensurate sines, seeded per worker. */
function wobble(t: number, seed: number): number {
  return (Math.sin(t * 1.31 + seed * 3.7) + Math.sin(t * 0.73 + seed * 1.9) * 0.6 + Math.sin(t * 2.17 + seed * 5.3) * 0.3) / 1.9;
}

/**
 * Plant (or lift) one foot: `x` and `lift` move it from its rest spot,
 * `pitch` rolls it — toes up about the heel (+) or heel up about the ball (−)
 * — `yaw` turns the toe out, and the leg is solved to reach it, knee forward.
 */
export function placeFoot(rig: WorkerRig, s: Side, x: number, lift: number, pitch: number, zOff: number, toeFlat: boolean, yaw = 0): void {
  const P = rig.poser;
  const b = rig.limbs[s];
  const r = rig.rest[s];
  const pivot = pitch >= 0 ? r.heel : r.ball;
  _a.copy(r.ankle).sub(pivot);
  const c = Math.cos(pitch);
  const sn = Math.sin(pitch);
  const rx = _a.x * c - _a.y * sn;
  const ry = _a.x * sn + _a.y * c;
  _b.set(pivot.x + x + rx, pivot.y + lift + ry, pivot.z + zOff + _a.z);
  _c.set(1, 0, r.sign * 0.15);
  P.ik2(b.thigh, b.shin, b.foot, _b, _c);
  P.orient(b.foot, _q.setFromEuler(_e.set(0, yaw, pitch, 'YXZ')));
  if (pitch < 0 && toeFlat) P.orient(b.toe, _q2.setFromEuler(_e.set(0, yaw, 0)));
}

/** Hang an arm: swing (+ forward), extra spread off the body, elbow bend — all radians. */
export function hangArm(rig: WorkerRig, s: Side, temp: Temperament, swing: number, spread: number, elbow: number): void {
  const P = rig.poser;
  const b = rig.limbs[s];
  const sign = rig.rest[s].sign;
  const out = (temp.armSpread - BIND_ARM_SPREAD) * DEG + spread;
  P.rot(b.upperArm, -sign * out, 0, swing);
  P.rot(b.forearm, 0, 0, elbow);
}

/**
 * Torso chain: hips offset and rotation, then spine and chest counter-turning
 * against them (radians). `pitch` tips the pelvis itself forward — a runner
 * leans from the hips, not by hunching his back.
 */
function torso(rig: WorkerRig, hipY: number, hipZ: number, hipX: number, roll: number, yaw: number, lean: number, pitch = 0): void {
  const P = rig.poser;
  P.shift(rig.hips, hipX, hipY, hipZ);
  P.rot(rig.hips, roll, yaw, -pitch);
  P.rot(rig.spine, -roll * 0.5, -yaw * 0.7, -lean * 0.5);
  P.rot(rig.chest, -roll * 0.45, -yaw * 0.9, -lean * 0.5);
}

// ------------------------------------------------------------- locomotion

/** Walk ↔ run, feet planted on the ground for the whole stance. */
/** Limp: how late in the cycle the bad leg lands, how much shorter it stays down, and how far the hips drop onto it. */
const LIMP_LATE = 0.08;
const LIMP_SHORT = 0.3;
const LIMP_DIP = 0.07;

export function poseGait(rig: WorkerRig, temp: Temperament, g: GaitState): void {
  const P = rig.poser.reset();
  const run = g.run;
  const duty = g.duty;
  const S = g.stride;
  const reach = Math.min(1, S / 0.5);
  const shuffle = g.tired;
  const phi = g.phase;
  const L = rig.rest.L.legLength;

  // Walking, the hips vault over a near-straight standing leg: lowest just
  // after each heel strike, highest at mid-stance. Running inverts it: the
  // legs compress at mid-stance and the body flies between steps.
  const vault = 0.5 + 0.5 * Math.cos(2 * TAU * (phi - 0.04));
  const walkY = -0.006 - (g.crouch - 0.006) * vault;
  const press = 0.5 + 0.5 * Math.cos(2 * TAU * (phi - duty / 2));
  const runY = 0.025 * reach - (g.crouch * 0.5 + 0.025 * reach) * press;
  // A limp: the bad leg lands late and leaves early, and the body lurches down and over
  // it each time it takes the weight.
  const bad = rig.limpSide;
  const badSign = rig.rest[bad].sign;
  const offOf = (s: Side): number => (s === 'L' ? 0 : 0.5) + (s === bad ? LIMP_LATE * g.limp : 0);
  const dutyOf = (s: Side): number => duty * (1 - (s === bad ? LIMP_SHORT * g.limp : 0));
  const ub = frac(phi + offOf(bad));
  const onBad = g.limp * (ub < dutyOf(bad) ? Math.sin(Math.PI * ub / dutyOf(bad)) : 0);
  const hipY = lerp(walkY, runY, run) - LIMP_DIP * onBad - shuffle * 0.03;
  const sway = (temp.waddle * (1 - run * 0.6) + shuffle * 0.012) * Math.min(1, reach * 1.5);
  const hipZ = -sway * Math.cos(TAU * (phi - duty / 2)) + badSign * 0.03 * onBad;
  const yaw = -lerp(7, 11, run) * DEG * reach * Math.cos(TAU * phi);
  const bank = Math.max(-0.22, Math.min(0.22, -g.turn * 0.05 * (0.5 + run)));
  const roll = lerp(temp.roll, 3, run) * DEG * reach * Math.cos(TAU * (phi - duty / 2)) + bank + badSign * 10 * DEG * onBad;
  const lean = (temp.lean + lerp(4, 20, run) * reach + shuffle * 16) * DEG;
  torso(rig, hipY, hipZ, 0, roll, yaw, lean, 14 * DEG * run * reach);
  // Head stays level and steady: undo most of the sway, nod a little on each step.
  P.rot(rig.neck, -roll * 0.4, yaw * 0.4, lean * 0.4);
  P.rot(rig.head, -roll * 0.2, g.turn * 0.12, lean * 0.3 + 0.03 * Math.cos(2 * TAU * (phi - 0.12)) * reach - shuffle * 0.2 - 0.14 * onBad);

  // Legs.
  const lift = lerp(0.05, 0.38 * L, run) * Math.min(1, reach * 1.4) * (1 - shuffle * 0.6);
  for (const s of SIDES) {
    const u = frac(phi + offOf(s));
    const duty = dutyOf(s);
    const limping = s === bad ? g.limp : 0;
    const zOff = rig.rest[s].sign * temp.stance * 0.5;
    let x: number;
    let y = 0;
    let pitch = 0;
    let toeFlat = false;
    const heelUp = lerp(18, 8, run) * DEG * reach;
    const toeOff = -lerp(30, 40, run) * DEG * reach * (1 - shuffle * 0.7);
    if (u < duty) {
      const k = u / duty;
      x = S * (duty / 2 - u);
      // Heel strike rolls onto the flat foot, then the heel peels off toward toe-off.
      pitch = heelUp * (1 - smooth(k / 0.22));
      if (k > 0.55) pitch = toeOff * smooth((k - 0.55) / 0.45);
      toeFlat = true;
    } else {
      const w = (u - duty) / (1 - duty);
      // Running, the foot tucks briefly, then the knee drives up and the foot reaches out ahead.
      const kick = run * 0.07 * L * Math.sin(Math.PI * Math.min(1, w * 2.2)) * (1 - w);
      x = -S * duty / 2 + S * duty * smooth(Math.pow(w, lerp(1, 0.7, run))) - kick;
      // The bad leg swings stiff and low, the toe nearly dragging.
      y = lift * Math.pow(Math.sin(Math.PI * w), lerp(0.85, 0.55, run)) * (1 - limping * 0.7);
      pitch = lerp(toeOff - run * 0.4, heelUp, smooth((w - 0.2) / 0.7));
    }
    placeFoot(rig, s, x, y, pitch, zOff, toeFlat);
  }

  // Arms counter-swing the legs, a beat late; elbows bend more as the pace rises.
  const swingAmp = lerp(temp.armSwing, 50, run) * DEG * reach * (1 - shuffle * 0.6);
  for (const s of SIDES) {
    const off = s === 'L' ? 0.5 : 0;
    const a = Math.cos(TAU * (phi + off - 0.06));
    // Walking, the arm swings from the shoulder, further forward than back, hand below the belt;
    // running it pumps. Never further back than 35°; swung back, it opens out past the hip.
    const swing = Math.max(-35 * DEG, a * swingAmp * (a < 0 ? lerp(0.75, 1, run) : 1) + lerp(2, 10, run) * DEG);
    const spread = (lerp(2, 8, run) + Math.max(0, -a) * lerp(6, 14, run)) * DEG;
    const elbow = lerp(14, 80, run) * DEG + Math.max(0, a) * lerp(4, 14, run) * DEG;
    hangArm(rig, s, temp, swing, spread, elbow);
    P.rot(rig.limbs[s].shoulder, 0, 0, 0.12 * a * reach);
    P.rot(rig.limbs[s].hand, 0, 0, -0.15 * a * reach);
  }
}

/**
 * Panic overlay: fleeing hunched forward, the face turned up and glancing back
 * over a shoulder at what he is running from, one hand clamping the bouncing
 * hat on, the other flailing high and out of step (tool and all). The arms
 * stay wide of the hat, so they read from above.
 */
export function panicBody(rig: WorkerRig, t: number, seed: number): void {
  const P = rig.poser;
  P.addRot(rig.chest, 0, 0.12 * Math.sin(t * 9 + seed), -8 * DEG);
  const back = keyed(frac(t / 1.3 + seed * 0.37), [[0, 0], [0.12, 1], [0.45, 1], [0.6, 0], [1, 0]]);
  const look = (Math.sin(seed * 7.1) >= 0 ? 1 : -1) * back;
  P.addRot(rig.neck, 0, 0.55 * look, 6 * DEG);
  P.addRot(rig.head, 0.1 * Math.sin(t * 7 + seed), 0.6 * look + 0.12 * Math.sin(t * 3.1 + seed), 22 * DEG);
  const hop = Math.max(0, Math.sin(t * TAU * 2.6 + seed));
  if (rig.hat >= 0) {
    P.shiftRest(rig.hat, 0, 0.035 * hop, 0);
    P.rot(rig.hat, 0.1 * hop * Math.sin(t * 5 + seed), 0, -0.08 * hop);
  }
  const hatHand: Side = rig.toolSide === 'L' ? 'R' : 'L';
  for (const s of SIDES) {
    const b = rig.limbs[s];
    const r = rig.rest[s];
    const sign = r.sign;
    if (s === hatHand && rig.hat >= 0) {
      // Fingers hooked over the brim at the side, the elbow up and out.
      const brim = P.pos(rig.hat, _a).add(_b.set(0.02, 0.0, sign * HAT_GRAB));
      basis(r.finger, r.thumb, _c.set(0.15, 1, -sign * 0.35), X, _q);
      P.ik2(b.upperArm, b.forearm, b.hand, brim.addScaledVector(_c.normalize(), -0.07), _d.set(0, 0.25, sign));
      P.orient(b.hand, _q);
      continue;
    }
    // Aimed in the world, up and out at an uneven beat, so however far he hunches into
    // the run the arm still flails above his shoulder and wide of the hat.
    const w = Math.sin(t * TAU * 3.1 + seed) + 0.4 * Math.sin(t * TAU * 5.3 + seed * 2);
    _c.set(0.08 + 0.12 * Math.sin(t * 7 + seed), 0.8 + 0.18 * w, sign * (0.55 + 0.12 * Math.sin(t * 5.3 + seed))).normalize();
    const hand = P.pos(b.upperArm, _a).addScaledVector(_c, r.armLength * 0.9);
    P.ik2(b.upperArm, b.forearm, b.hand, hand, _d.set(-0.3, -0.2, sign));
    P.rot(b.hand, -sign * 0.5 * w, 0, 0);
  }
}

/** An injured worker presses his free hand onto the thigh of the leg he is favouring. */
export function clutchThigh(rig: WorkerRig, amount: number): void {
  if (amount <= 0.3) return;
  const P = rig.poser;
  const s = rig.limpSide;
  const b = rig.limbs[s];
  const sign = rig.rest[s].sign;
  const hip = P.pos(b.thigh, _a);
  const knee = P.pos(b.shin, _b);
  const target = hip.lerp(knee, 0.45).add(_c.set(0.07, 0.04, sign * 0.02));
  P.ik2(b.upperArm, b.forearm, b.hand, target, _d.set(-0.3, 0, sign));
}

/** The manager's pointing finger, curled back into his fist (`amount` 1) or out (0). */
export function curlFinger(rig: WorkerRig, amount: number): void {
  if (rig.finger < 0 || amount <= 0) return;
  rig.poser.rot(rig.finger, -rig.rest.L.sign * 1.6 * amount, 0, 0);
}

/** A spent worker's hat slips askew. */
export function tiredTilt(rig: WorkerRig, tired: number, t: number, seed: number): void {
  if (rig.hat < 0 || tired <= 0.01) return;
  rig.poser.rot(rig.hat, (Math.sin(seed) >= 0 ? 1 : -1) * 0.22 * tired, 0, 0.06 * tired * Math.sin(t * 0.9 + seed));
}

// ------------------------------------------------------------------ idle

/**
 * Standing about: weight on one leg, the other knee soft and its heel up,
 * hips and shoulders tilted against each other; breathing, looking around,
 * shifting to the other leg every few seconds. `tired` slumps it all.
 */
export function poseIdle(rig: WorkerRig, temp: Temperament, t: number, seed: number, tired: number, limp = 0): void {
  const P = rig.poser.reset();
  const breath = Math.sin(TAU * t / lerp(3.4, 2.4, tired));
  // A big sigh now and then when spent: the chest heaves up, then drops.
  const sigh = tired * keyed(frac(t / 5.5 + seed * 0.1), [[0, 0], [0.08, 1], [0.2, -0.4], [0.32, 0]]);
  // Weight: a soft square wave, so he stands on one leg for a while, then shifts.
  // An injured man stands off his bad leg.
  const w = lerp(Math.max(-1, Math.min(1, Math.sin(TAU * t / lerp(9, 14, frac(seed)) + seed * 2.3) * 2.4)) * (1 - tired * 0.5),
    -rig.rest[rig.limpSide].sign, Math.min(1, limp * 1.5));
  const sway = tired * Math.sin(TAU * t * 0.3 + seed) * 6 * DEG;
  const fidget = temp.fidget * Math.abs(Math.sin(t * TAU * 1.6 + seed));
  const stagger = tired * 0.06 * Math.sin(TAU * t * 0.3 + seed * 1.3);
  const hipZ = 0.034 * w + stagger;
  // Spent, he sinks into his knees and props himself on them rather than bowing from the waist.
  const hipY = -0.012 - 0.004 * breath - tired * TIRED_SINK - Math.abs(w) * 0.006 + fidget;
  const lean = (temp.lean + tired * 30) * DEG;
  const roll = -6 * DEG * w + sway;
  torso(rig, hipY, hipZ, -tired * 0.05, roll, 0.05 * wobble(t * 0.4, seed), lean);
  P.addRot(rig.chest, 3 * DEG * w, 0, -(breath * lerp(1.6, 4, tired) + sigh * 6) * DEG - tired * 10 * DEG);
  // Shoulders rise on the in-breath, sag forward when tired.
  for (const s of SIDES) {
    const sign = rig.rest[s].sign;
    P.rot(rig.limbs[s].shoulder, sign * ((breath * 0.025 + sigh * 0.05) * (1 + tired) - tired * 0.12), 0, -tired * 0.15);
  }
  // Head: drifting glances with holds, now and then a look up at the camera; droops (not too far) when tired.
  const look = wobble(t * 0.35, seed + 1.7);
  const lookUp = smooth((Math.sin(t * 0.21 + seed * 4.1) - 0.82) * 6) * (1 - tired);
  // The neck takes back most of the slump, so a spent worker's half-shut eyes still face the camera.
  P.rot(rig.neck, -roll * 0.4, look * 0.18, lean * (0.2 + 0.45 * tired));
  // Held a little up, so the face shows under the brim from the game camera.
  P.rot(rig.head, -roll * 0.4 + sway * 0.5, look * 0.28 * (1 - tired * 0.6),
    HEAD_UP + 0.05 * wobble(t * 0.5, seed + 3.1) + lookUp * 0.32 - tired * 0.04);
  // The standing leg straight under the weight, the other knee bent with the heel up and the toe out.
  for (const s of SIDES) {
    const sign = rig.rest[s].sign;
    const free = smooth(-w * sign);
    const z = sign * temp.stance;
    const heel = fidget > 0 ? -fidget * 6 : 0;
    placeFoot(rig, s, 0.03 * free, 0, -0.32 * free + heel - tired * 0.05, z, true, -sign * 15 * DEG * free);
  }
  // Arms relaxed in front of the thighs, elbows soft; dangling when tired.
  for (const s of SIDES) {
    const side = rig.rest[s].sign;
    hangArm(rig, s, temp, (6 + breath * 1.5) * DEG + side * w * 2 * DEG + tired * 20 * DEG,
      tired * 10 * DEG, (14 + breath * 2 - tired * 6) * DEG);
  }
  // Spent: both hands come down onto the knees, elbows out, and he hangs off his arms.
  const prop = smooth((tired - 0.3) / 0.35);
  if (prop > 0) {
    for (const s of SIDES) {
      const b = rig.limbs[s];
      const sign = rig.rest[s].sign;
      const knee = P.pos(b.shin, _a).add(_b.set(0.06, 0.05, sign * 0.015));
      const hand = P.pos(b.hand, _c).lerp(knee, prop);
      P.ik2(b.upperArm, b.forearm, b.hand, hand, _d.set(-0.2, 0.2, sign));
    }
  }
}

// -------------------------------------------------------------- collapse

/** Idle: how far a spent worker's hips sink into his knees (m), and the head's habitual tilt up toward the camera (rad). */
const TIRED_SINK = 0.1;
const HEAD_UP = 0.06;

/** Where a collapsed worker's hat lands: behind and beside his head, upside down. */
const HAT_REST = new THREE.Vector3(-0.95, 0.2, 0.3);
/** How far out from the hat bone a hand holding the hat on grips its brim (m). */
const HAT_GRAB = 0.15;
/** Lying down: a resting hand's height off the ground (m); on the belly it rests at the build's `belly`. */
const COLLAPSE_HAND_Y = 0.04;

/**
 * Fatigue wins: knees buckle, he sits down hard, flops onto his back with his
 * arms flung out, lets go of the tool and loses the hat. `c` runs 0..1, then holds.
 */
export function poseCollapse(rig: WorkerRig, temp: Temperament, c: number, seed: number, t: number): void {
  const P = rig.poser.reset();
  const odd = Math.sin(seed) >= 0 ? 1 : -1;
  const H = rig.hipHeight;
  const hipY = keyed(c, [[0, -0.01], [0.26, -0.14], [0.48, -0.66 * H], [0.74, -0.78 * H], [0.84, -0.72 * H],
    [0.92, -0.77 * H], [1, -0.76 * H]]);
  const hipX = keyed(c, [[0, 0], [0.26, 0.02], [0.48, -0.1], [1, -0.16]]);
  const tip = keyed(c, [[0, 0], [0.26, -0.12], [0.48, 0.15], [0.74, 1.52], [0.84, 1.44], [0.92, 1.5], [1, 1.48]]);
  P.shift(rig.hips, hipX, hipY, 0);
  P.rot(rig.hips, 0.06 * odd * smooth((c - 0.6) * 3), 0.08 * odd, tip);
  P.rot(rig.spine, 0, 0, keyed(c, [[0, 0], [0.26, -0.25], [0.48, -0.05], [1, 0.04]]));
  // Still breathing, once he is down.
  P.rot(rig.chest, 0, 0, keyed(c, [[0, 0], [0.26, -0.2], [0.48, 0], [1, 0.02]]) + smooth((c - 0.9) * 10) * 0.035 * Math.sin(t * 1.4));
  P.rot(rig.neck, 0, 0, keyed(c, [[0, 0], [0.26, -0.2], [0.74, -0.15], [1, -0.12]]));
  // Head lolls to one side and rests on the ground.
  P.rot(rig.head, keyed(c, [[0, 0], [0.7, 0], [1, 0.25 * odd]]), keyed(c, [[0, 0], [0.7, 0], [1, 0.55 * odd]]),
    keyed(c, [[0, 0], [0.26, -0.25], [1, -0.1]]));
  for (const s of SIDES) {
    const b = rig.limbs[s];
    const sign = rig.rest[s].sign;
    // One knee bent and fallen out to the side, the other leg lying straight.
    const bent = sign === odd ? 1 : 0;
    P.rot(b.thigh, -sign * keyed(c, [[0, 0], [0.48, 0.12], [1, 0.1 + 0.55 * bent]]), 0,
      keyed(c, [[0, 0], [0.26, 0.85], [0.48, 1.45], [0.74, 0.25], [1, 0.08 + 0.6 * bent]]));
    P.rot(b.shin, 0, 0, -keyed(c, [[0, 0], [0.26, 1.55], [0.48, 1.3], [0.74, 0.35], [1, 0.12 + 1.0 * bent]]));
    P.rot(b.foot, 0, 0, keyed(c, [[0, 0], [0.26, 0.6], [0.48, 0.2], [1, -0.35]]));
    // Out cold, and not symmetric: one arm flung out on the ground with the elbow
    // bent, the other dropped across his belly. Lying on his back, "forward" is up.
    const across = sign !== odd;
    const out = keyed(c, [[0, 0], [0.48, 0.45], [0.74, across ? 0.1 : 1.3], [0.84, across ? 0.05 : 1.22], [1, across ? -0.35 : 1.25]]);
    P.rot(b.upperArm, -sign * ((temp.armSpread - BIND_ARM_SPREAD) * DEG + out), 0,
      keyed(c, [[0, 0.05], [0.26, 0.3], [0.48, -0.35], [0.74, across ? 0.6 : -0.05], [1, across ? 0.75 : -0.12]]));
    P.rot(b.forearm, 0, 0, keyed(c, [[0, 0.25], [0.48, 0.5], [1, across ? 1.5 : 0.8]]));
  }
  // Once he is down, the hands come to rest: the flung one palm-up on the ground past the
  // shoulder, the other on his belly. The fall's FK carries them most of the way there.
  const settle = smooth((c - 0.55) / 0.3);
  if (settle > 0) {
    const hips = P.pos(rig.hips, _a);
    for (const s of SIDES) {
      const b = rig.limbs[s];
      const sign = rig.rest[s].sign;
      const across = sign !== odd;
      const shoulder = P.pos(b.upperArm, _b);
      if (across) _c.set(lerp(hips.x, shoulder.x, 0.35), hips.y + temp.belly, -sign * 0.02);
      else _c.set(shoulder.x - 0.14, COLLAPSE_HAND_Y, shoulder.z + sign * 0.2);
      P.pos(b.hand, _d).lerp(_c, settle);
      // The belly arm's elbow drops out to the side; the flung arm lies flat, its hand up
      // by his head and the elbow pointing down the body.
      if (across) _c.set(0, -0.6, sign);
      else _c.set(1, -0.15, sign * 0.4);
      P.ik2(b.upperArm, b.forearm, b.hand, _d, _c);
    }
  }
  // He lets go of the tool as he goes down: it drops beside his hand and lies there.
  if (rig.tool >= 0 && rig.toolSide) {
    const drop = smooth((c - 0.4) / 0.25);
    if (drop > 0) {
      const r = rig.rest[rig.toolSide];
      const held = P.pos(rig.tool, _a);
      const heldQ = P.absRotation(rig.tool, _q2);
      _b.set(-0.15 + 0.1 * odd, 0.05, r.sign * 0.62);
      _d.copy(held).lerp(_b, drop);
      _d.y += Math.sin(Math.PI * drop) * 0.12;
      P.placeAt(rig.tool, _d);
      // Lying flat: the fingers' axis along the ground, the thumb's across it.
      basis(r.finger, r.thumb, _c.set(0.2, 0, r.sign), X, _q3);
      P.orient(rig.tool, heldQ.slerp(_q3, drop));
    }
  }
  // And the hat flies off and lands upside down by his head.
  if (rig.hat >= 0) {
    const off = smooth((c - 0.5) / 0.3);
    if (off > 0) {
      const worn = P.pos(rig.hat, _a);
      const wornQ = P.absRotation(rig.hat, _q2);
      _b.set(HAT_REST.x, HAT_REST.y, HAT_REST.z * odd);
      _d.copy(worn).lerp(_b, off);
      _d.y += Math.sin(Math.PI * off) * 0.35;
      P.placeAt(rig.hat, _d);
      P.orient(rig.hat, wornQ.slerp(_q3.setFromAxisAngle(X, Math.PI), off));
    }
  }
}

const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

/** Rotation taking (restA, restB) onto (wantA, wantB), B orthogonalised against A. */
export function basis(restA: THREE.Vector3, restB: THREE.Vector3, wantA: THREE.Vector3, wantB: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  _x.copy(restA).normalize();
  _y.copy(restB).addScaledVector(_x, -restB.dot(_x)).normalize();
  _z.crossVectors(_x, _y);
  _m1.makeBasis(_x, _y, _z);
  _x.copy(wantA).normalize();
  _y.copy(wantB).addScaledVector(_x, -wantB.dot(_x)).normalize();
  _z.crossVectors(_x, _y);
  _m2.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m2.multiply(_m1.transpose()));
}

// ------------------------------------------------------------------ face

/**
 * Lids, brows and mouth: `blink` 0 open .. 1 shut, `droop` lowers the lids
 * (tired), `alarm` throws the eyes wide and the brows up, `gasp` swaps the
 * everyday mouth for the open O.
 */
export function poseFace(rig: WorkerRig, blink: number, droop: number, alarm: number, gasp: number): void {
  const P = rig.poser;
  for (const s of SIDES) {
    const b = rig.limbs[s];
    const open = rig.rest[s].lidOpen;
    // Shut is the lid's edge turned down from its resting elevation to well under the eye.
    const shut = Math.max(blink, droop * 0.55) * (open + 0.85);
    const wide = alarm * Math.max(0, 1.25 - open) * (1 - blink);
    P.rot(b.lid, 0, 0, -shut + wide);
    // Alarm lifts the brows and tips their inner ends up — worried, whatever the role's resting scowl.
    P.shiftRest(b.brow, 0, alarm * 0.016 - droop * 0.006, 0);
    P.rot(b.brow, rig.rest[s].sign * 0.45 * alarm, 0, 0);
  }
  if (rig.gasp >= 0 && rig.mouth >= 0) {
    P.shiftRest(rig.gasp, GASP_HIDE * gasp, 0, 0);
    P.shiftRest(rig.mouth, -GASP_HIDE * gasp, 0, 0);
  }
}
