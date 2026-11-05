// BlastSimulator2026 — Worker animator
// Decides what a worker's body is doing from what the simulation says about
// him — moving or standing, on a task, exhausted, collapsed, evacuating —
// and crossfades between those motions so nothing ever pops. Speed comes
// from how far the mesh actually travelled this frame, smoothed: the walk's
// cadence and stride follow it so feet stay planted. An errand is a brisk
// walk at any game speed; fleeing slows the cadence into a run with a flight
// phase, and so does fast-forward past what the legs can hurry. Each worker gets his own seed, so a crew never
// breathes, blinks or glances in lockstep.

import type { PoseBuffer } from './RigPoser.js';
import { blendPose } from './RigPoser.js';
import { SIDES, type WorkerRig } from './WorkerRig.js';
import {
  clutchThigh, curlFinger, curlHand, type GaitState, lerp, panicBody, poseCollapse, poseFace, poseGait, poseIdle, smooth, TEMPERAMENT, type Temperament,
  tiredTilt,
} from './WorkerMotion.js';
import { carryTool, poseWork } from './WorkerWork.js';

/** What the simulation and the mesh's own motion say this frame. */
export interface WorkerSignals {
  /** Ground speed the mesh moved at this frame, m/s. */
  speed: number;
  /** Game-speed multiplier the mesh moves under (default 1): legs hurry with it rather than switch to a run. */
  timeScale?: number;
  /** Yaw rate of the mesh, rad/s (+ turning left). */
  turn: number;
  /** A task is ticking down. */
  working: boolean;
  collapsing: boolean;
  evacuating: boolean;
  injured: boolean;
  /** 0..100, 100 fresh. */
  fatigue: number;
}

type Motion = 'move' | 'idle' | 'work' | 'collapse';
const MOTIONS: readonly Motion[] = ['move', 'idle', 'work', 'collapse'];

/** Speed smoothing time constant, s — tween speed pulses between ticks. */
const SPEED_SMOOTHING_S = 0.18;
/** Hysteresis on "moving", m/s, and how long a stop must last to count. */
const MOVE_ON = 0.3;
const MOVE_OFF = 0.12;
const STOP_HOLD_S = 0.22;
/** Crossfade rate between motions, 1/s. */
const BLEND_RATE = 5;
/**
 * Cadence: full gait cycles (two steps) per second, as a function of the pace at 1× game speed.
 * An errand is a quick scurry on short legs, fast enough that each foot stays down over half
 * the cycle; fleeing takes longer, slower strides with a flight phase between them.
 */
const CADENCE_BASE = 1.6;
const CADENCE_PER_MPS = 0.9;
const CADENCE_MAX = 4.2;
const CADENCE_FLEE = 0.74;
/** Leg length the cadence constants are tuned for; shorter legs swing faster, like shorter pendulums. */
const CADENCE_LEG = 0.34;
/** Fast-forward hurries the legs up to this many times their 1× cadence; past it the stride stretches. */
const HURRY_MAX = 2;
/** Without an evacuation, a gait never takes more than this much of the run's arm pump and lean. */
const ERRAND_RUN_LOOK = 0.6;
/** Hip sink at rest pace and at a full-speed stride, metres. */
const CROUCH_SLOW = 0.02;
const CROUCH_FAST = 0.05;
/** Duty factor range: a stroll keeps each foot down 62% of the cycle; under ~0.5 there is a flight phase. */
const DUTY_WALK = 0.62;
const DUTY_MIN = 0.3;
const DUTY_RUN_FROM = 0.5;
const DUTY_RUN_FULL = 0.34;
/** Longest stride per cycle, in leg lengths, before the feet are allowed to slide. */
const STRIDE_MAX_LEGS = 3.4;
const COLLAPSE_S = 1.7;
const BLINK_S = 0.16;
/** Below this fatigue a worker starts to droop; at FATIGUE_SPENT he is spent. */
const FATIGUE_TIRED = 32;
const FATIGUE_SPENT = 8;

/** Small deterministic PRNG so blinks and glances vary per worker, reproducibly. */
function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export class WorkerAnimator {
  private readonly temp: Temperament;
  private readonly bufs: Record<Motion, PoseBuffer>;
  private readonly out: PoseBuffer;
  private readonly weight: Record<Motion, number> = { move: 0, idle: 1, work: 0, collapse: 0 };
  private readonly random: () => number;
  private readonly seed: number;
  private readonly legLength: number;
  private time = 0;
  private speed = 0;
  private moving = false;
  private stillFor = 0;
  private phase = 0;
  private stride = 0;
  private duty = DUTY_WALK;
  private crouch = CROUCH_SLOW;
  private workTime = 0;
  private collapseTime = 0;
  private panic = 0;
  private tired = 0;
  private limp = 0;
  private blinkAt: number;
  private blinkT = -1;

  constructor(private readonly rig: WorkerRig, private readonly role: string, seed: number) {
    this.temp = TEMPERAMENT[role] ?? TEMPERAMENT['driller']!;
    this.seed = (seed % 97) * 0.37 + 0.5;
    this.random = rng(seed + 11);
    const P = rig.poser;
    this.bufs = { move: P.createBuffer(), idle: P.createBuffer(), work: P.createBuffer(), collapse: P.createBuffer() };
    this.out = P.createBuffer();
    this.legLength = (rig.rest.L.legLength + rig.rest.R.legLength) / 2;
    this.blinkAt = 0.5 + this.random() * 3;
    this.time = this.random() * 10;
  }

  /** Current crossfade weight of a motion — for tests and debugging. */
  weightOf(motion: Motion): number {
    return this.weight[motion];
  }

  /** Cycle phase of the gait, 0..1. */
  get gaitPhase(): number {
    return this.phase % 1;
  }

  update(dt: number, s: WorkerSignals): void {
    if (dt <= 0) return;
    this.time += dt;
    const k = 1 - Math.exp(-dt / SPEED_SMOOTHING_S);
    this.speed += (s.speed - this.speed) * k;
    if (this.moving) {
      this.stillFor = this.speed < MOVE_OFF ? this.stillFor + dt : 0;
      if (this.stillFor > STOP_HOLD_S) this.moving = false;
    } else if (this.speed > MOVE_ON) {
      this.moving = true;
      this.stillFor = 0;
    }

    const target: Record<Motion, number> = { move: 0, idle: 0, work: 0, collapse: 0 };
    if (s.collapsing) target.collapse = 1;
    else if (this.moving) target.move = 1;
    else if (s.working) target.work = 1;
    else target.idle = 1;
    for (const m of MOTIONS) {
      const w = this.weight[m];
      this.weight[m] = w + Math.sign(target[m] - w) * Math.min(Math.abs(target[m] - w), BLEND_RATE * dt);
    }
    this.collapseTime = s.collapsing ? this.collapseTime + dt : Math.max(0, this.collapseTime - dt * 2);
    this.workTime = s.working ? this.workTime + dt : 0;
    this.panic += ((s.evacuating ? 1 : 0) - this.panic) * Math.min(1, dt * 6);
    const tiredTarget = smooth((FATIGUE_TIRED - s.fatigue) / (FATIGUE_TIRED - FATIGUE_SPENT));
    this.tired += (tiredTarget - this.tired) * Math.min(1, dt * 1.5);
    this.limp += ((s.injured ? 1 : 0) - this.limp) * Math.min(1, dt * 3);

    // Gait: cadence follows the pace the worker would walk at 1× game speed,
    // hurried (up to a cap) by fast-forward; the stride covers the rest.
    const v = Math.max(this.speed, 0.0);
    const scale = Math.max(1, s.timeScale ?? 1);
    const pace = v / scale;
    const legs = Math.sqrt(CADENCE_LEG / this.legLength);
    const cadence = Math.min(CADENCE_MAX, (CADENCE_BASE + CADENCE_PER_MPS * pace) * legs) * Math.min(scale, HURRY_MAX)
      * lerp(1, 0.8, this.tired) * lerp(1, CADENCE_FLEE, this.panic);
    const strideTarget = Math.min(STRIDE_MAX_LEGS * this.legLength, v / cadence);
    this.stride += (strideTarget - this.stride) * Math.min(1, dt * 8);
    // A foot can only be on the ground as far as the leg reaches from the sunk hips;
    // a stride longer than that must spend part of the cycle in the air — a run.
    this.crouch = lerp(CROUCH_SLOW, CROUCH_FAST, smooth(this.stride / (2.2 * this.legLength)));
    const L = this.legLength;
    const reachX = Math.sqrt(Math.max(0, L * L - (L - this.crouch) ** 2)) * 0.95;
    this.duty = Math.min(DUTY_WALK, Math.max(DUTY_MIN, this.stride > 1e-3 ? (2 * reachX) / this.stride : DUTY_WALK));
    if (this.weight.move > 0) this.phase += cadence * dt;
    else this.phase = 0;

    this.updateBlink(dt);
    this.compose(s);
  }

  /**
   * How open each hand is: a tool hand stays a fist, a free hand hangs relaxed,
   * clenches on a hip, opens on the knees, splays when he flings it up in a
   * panic, and both fall open once he is out cold.
   */
  private poseHands(m: Motion, carry: boolean): void {
    const { rig, role } = this;
    for (const s of SIDES) {
      const holding = rig.toolSide === s;
      let amount = holding ? 1 : 0.55;
      if (m === 'collapse') amount = lerp(amount, 0.15, smooth((this.collapseTime / COLLAPSE_S - 0.4) / 0.35));
      else if (m === 'work') amount = 1;
      else if (this.panic > 0.5) amount = holding ? 1 : rig.freeSide === s && rig.hat >= 0 ? 0.45 : -0.2;
      else if (this.limp > 0.3 && s === rig.freeSide) amount = 0.35;
      else if (m === 'idle' && this.tired > 0.5) amount = holding ? 1 : 0.3;
      else if (m === 'idle' && carry && !holding && (role === 'manager' || role === 'driver')) amount = 1;
      curlHand(rig, s, amount);
    }
  }

  private updateBlink(dt: number): void {
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      if (this.blinkT > BLINK_S) this.blinkT = -1;
    } else if (this.time >= this.blinkAt) {
      this.blinkT = 0;
      // Now and then a double blink.
      const double = this.random() < 0.18;
      this.blinkAt = this.time + (double ? 0.28 : 1.8 + this.random() * 3.6);
    }
  }

  private blink(): number {
    return this.blinkT < 0 ? 0 : Math.sin(Math.PI * Math.min(1, this.blinkT / BLINK_S));
  }

  private compose(s: WorkerSignals): void {
    const { rig, role, temp, seed, time } = this;
    const P = rig.poser;
    const blink = this.blink();
    const droop = this.tired * 0.8 + this.limp * 0.15;
    const alarm = this.panic;
    // An exhausted man lets his tool hang rather than carry it just so.
    const carry = this.tired < 0.35;
    let total = 0;
    let first = true;
    for (const m of MOTIONS) {
      const w = this.weight[m];
      if (w <= 1e-3) continue;
      switch (m) {
        case 'move': {
          // The legs fly when the stride needs it; the arms and lean only sprint when he is fleeing.
          const run = Math.max(smooth((DUTY_RUN_FROM - this.duty) / (DUTY_RUN_FROM - DUTY_RUN_FULL)) * ERRAND_RUN_LOOK, this.panic);
          const g: GaitState = {
            phase: this.phase, stride: this.stride, duty: this.duty, crouch: this.crouch, run,
            turn: s.turn, limp: this.limp, tired: this.tired,
          };
          poseGait(rig, temp, g);
          if (carry) carryTool(rig, role, temp, time, this.phase, 1, seed);
          if (this.panic > 0.5) panicBody(rig, time, seed);
          else clutchThigh(rig, this.limp);
          break;
        }
        case 'idle':
          poseIdle(rig, temp, time, seed, this.tired, this.limp);
          if (carry) carryTool(rig, role, temp, time, 0, 0, seed);
          if (this.panic > 0.5) panicBody(rig, time, seed);
          else clutchThigh(rig, this.limp);
          break;
        case 'work':
          poseWork(rig, role, temp, this.workTime, seed);
          break;
        case 'collapse':
          poseCollapse(rig, temp, Math.min(1, this.collapseTime / COLLAPSE_S), seed, time);
          break;
      }
      // The manager's pointing finger stays curled into the fist unless he is pointing on the job.
      if (!(m === 'work' && role === 'manager')) curlFinger(rig, 1);
      this.poseHands(m, carry);
      if (m !== 'collapse' && m !== 'work') tiredTilt(rig, this.tired, time, seed);
      const out = m === 'collapse';
      poseFace(rig, out ? 1 : blink, droop, out ? 0 : alarm, out ? 0.7 : smooth((alarm - 0.3) / 0.4));
      const buf = P.capture(this.bufs[m]);
      total += w;
      if (first) {
        this.out.q.set(buf.q);
        this.out.p.set(buf.p);
        first = false;
      } else {
        blendPose(this.out, buf, w / total);
      }
    }
    if (!first) P.apply(this.out);
  }
}
