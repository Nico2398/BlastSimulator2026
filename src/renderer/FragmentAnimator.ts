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

/** How fast a fragment tumbles while it falls, in rad/s (#485). */
function tumbleRate(_flight: FragmentFlight): number {
  return undefined as unknown as number;
}

/** Tumble angle and settle-squash scale for a flight at time `t` (#485). */
function tumbleAndSettle(_flight: FragmentFlight, _t: number): { tumbleAngle: number; settleScale: { x: number; y: number; z: number } } {
  // TODO(impl): derive tumbleAngle from tumbleRate(_flight) integrated over
  // airborne time, and settleScale from the post-landing squash-and-bounce.
  tumbleRate(_flight);
  return undefined as unknown as { tumbleAngle: number; settleScale: { x: number; y: number; z: number } };
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
    // TODO(impl): endsAtS must include SETTLE_DURATION_S so playback holds
    // through the landing squash-and-bounce instead of ending on impact.
    this.endsAtS = totalFlightDuration(this.flights);
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
