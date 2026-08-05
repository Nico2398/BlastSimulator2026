// BlastSimulator2026 — Playing a blast's collapse back on screen
//
// The blast has already decided where every fragment ends up. This walks each
// one along the path from where it broke to where it settled, so the player
// watches the face come down instead of finding a finished muck pile the instant
// the charge goes off.
//
// Nothing here decides anything. Skip the animation — headless runs, a save
// loaded mid-collapse — and the world is already in exactly the state this
// playback would have arrived at.

import type { FragmentFlight } from '../core/mining/BlastResolve.js';
import { flightPositionAt, totalFlightDuration } from '../core/mining/BlastResolve.js';
import type { FragmentMesh, FragmentInstanceTransform } from './FragmentMesh.js';
import {
  MAX_PROJECTION_VELOCITY,
  TUMBLE_MAX_RATE_RAD_S,
  TUMBLE_DROP_FACTOR,
  SETTLE_DURATION_S,
  SETTLE_SQUASH_MAGNITUDE,
  SETTLE_BOUNCE_OSCILLATIONS,
} from '../core/config/balance.js';

/**
 * How fast a fragment tumbles while it falls, in rad/s (#485). Scales with
 * how hard it was thrown — a fragment that merely dropped barely rotates.
 */
function tumbleRate(flight: FragmentFlight): number {
  const speedFrac = Math.max(0, Math.min(1, flight.impactSpeed / MAX_PROJECTION_VELOCITY));
  const rate = TUMBLE_MAX_RATE_RAD_S * speedFrac;
  return flight.thrown ? rate : rate * TUMBLE_DROP_FACTOR;
}

/**
 * Tumble angle and settle-squash scale for a flight at time `t` (#485).
 *
 * Pure function of (flight, t) — a seek and a run of per-frame updates that
 * land on the same `t` must produce the same result, and fragments landing
 * at the same instant must not interfere with each other.
 *
 * Three phases:
 *  - airborne: tumbleAngle accumulates at tumbleRate() from the moment the
 *    fragment actually starts moving (after its delay); settleScale is rest.
 *  - settling: a short window after landing where tumbleAngle eases back down
 *    to exactly 0 (resting orientation is the untumbled spawn orientation)
 *    and settleScale does a damped squash-and-stretch bounce that starts and
 *    ends at (1,1,1).
 *  - settled: exactly the identity transform, snapped rather than asymptotic.
 */
function tumbleAndSettle(flight: FragmentFlight, t: number): { tumbleAngle: number; settleScale: { x: number; y: number; z: number } } {
  const landingT = flight.delayS + flight.durationS;
  const settleEndT = landingT + SETTLE_DURATION_S;
  const REST_SCALE = { x: 1, y: 1, z: 1 };

  if (t < landingT) {
    const airborneS = Math.max(0, t - flight.delayS);
    return { tumbleAngle: tumbleRate(flight) * airborneS, settleScale: REST_SCALE };
  }

  if (t < settleEndT) {
    const settleT = t - landingT;
    const envelope = 1 - settleT / SETTLE_DURATION_S;
    const landingAngle = tumbleRate(flight) * flight.durationS;
    const squash = SETTLE_SQUASH_MAGNITUDE * envelope
      * Math.sin((settleT / SETTLE_DURATION_S) * SETTLE_BOUNCE_OSCILLATIONS * Math.PI);
    return {
      tumbleAngle: landingAngle * envelope,
      // Squash on y, a matching stretch on x/z, so it reads as compressing
      // into the landing rather than just shrinking.
      settleScale: { x: 1 + squash * 0.5, y: 1 - squash, z: 1 + squash * 0.5 },
    };
  }

  return { tumbleAngle: 0, settleScale: REST_SCALE };
}

export class FragmentAnimator {
  /** The collapse still being advanced by the render loop; emptied when it ends. */
  private flights: FragmentFlight[] = [];
  /** The whole collapse, kept so it can be replayed to any moment. */
  private source: FragmentFlight[] = [];
  private elapsedS = 0;
  private endsAtS = 0;
  /** Reused across frames so a large blast does not allocate a map per frame. */
  private readonly transforms = new Map<number, FragmentInstanceTransform>();

  constructor(private readonly fragments: FragmentMesh) {}

  /** True while there is still rock in the air. */
  get isPlaying(): boolean {
    return this.elapsedS < this.endsAtS;
  }

  /** How long the collapse being played takes, in seconds. */
  get durationS(): number {
    return this.endsAtS;
  }

  /**
   * Start playing a blast back. Only fragments that actually moved are
   * animated, so a blast whose rock barely shifted costs nothing.
   */
  begin(flights: readonly FragmentFlight[]): void {
    this.source = flights.filter(f => f.durationS > 0 && !samePlace(f));
    this.flights = this.source.slice();
    this.elapsedS = 0;
    // Playback holds through the landing squash-and-bounce, not just to
    // impact, so idle-detection (isPlaying / update()'s final write) waits
    // for every fragment to have fully settled.
    this.endsAtS = this.flights.length > 0 ? totalFlightDuration(this.flights) + SETTLE_DURATION_S : 0;
    // Put everything at its starting point immediately, or the first frame
    // would show the finished pile before the collapse begins.
    if (this.flights.length > 0) this.apply();
  }

  /**
   * Show the collapse exactly `t` seconds in, and hold it there.
   *
   * Seeking takes the playback out of the render loop's hands — a sequence of
   * seeks has to land on the moments it asked for, not on the moments the frame
   * rate happened to allow. That matters most where frames are slowest: without
   * a GPU the clock advances a tenth of a second per frame that costs seconds,
   * so stepping through a collapse in real time is not something a harness can
   * do. This replays it instead, at whatever spacing the pictures need.
   */
  seek(t: number): void {
    if (this.source.length === 0) return;
    this.flights = [];
    this.elapsedS = Math.max(0, Math.min(t, this.endsAtS));
    this.applyTo(this.source);
  }

  /** Stop animating and leave every fragment where the blast put it. */
  stop(): void {
    this.flights = [];
    this.source = [];
    this.elapsedS = 0;
    this.endsAtS = 0;
  }

  /**
   * Run the collapse to its end at once, putting every fragment on the resting
   * place the blast chose for it.
   *
   * Same end state as letting it play out, reached in one write. A harness that
   * wants a picture of the settled muck rather than of rock in mid-air uses
   * this, because the animation clock advances at most a tenth of a second per
   * frame and a frame without a GPU costs seconds.
   */
  finish(): void {
    if (this.source.length === 0) return;
    this.elapsedS = this.endsAtS;
    this.applyTo(this.source);
    this.flights = [];
  }

  /** Advance the collapse by `dt` seconds. */
  update(dt: number): void {
    if (this.flights.length === 0) return;
    if (!Number.isFinite(dt) || dt <= 0) return;

    this.elapsedS += dt;
    this.apply();

    if (this.elapsedS >= this.endsAtS) {
      // Everything has landed: one last write puts each fragment exactly on its
      // resting place, then the animator goes quiet and costs nothing per frame.
      this.flights = [];
    }
  }

  private apply(): void {
    this.applyTo(this.flights);
  }

  private applyTo(flights: readonly FragmentFlight[]): void {
    this.transforms.clear();
    for (const flight of flights) {
      const pos = flightPositionAt(flight, this.elapsedS);
      const { tumbleAngle, settleScale } = tumbleAndSettle(flight, this.elapsedS);
      this.transforms.set(flight.fragmentId, { x: pos.x, y: pos.y, z: pos.z, tumbleAngle, settleScale });
    }
    this.fragments.updateTransforms(this.transforms);
  }
}

/** True when a fragment settled where it started and has nothing to animate. */
function samePlace(flight: FragmentFlight): boolean {
  const dx = flight.to.x - flight.from.x;
  const dy = flight.to.y - flight.from.y;
  const dz = flight.to.z - flight.from.z;
  return dx * dx + dy * dy + dz * dz < 1e-6;
}
