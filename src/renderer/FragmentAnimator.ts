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
import type { FragmentMesh } from './FragmentMesh.js';

export class FragmentAnimator {
  private flights: FragmentFlight[] = [];
  private elapsedS = 0;
  private endsAtS = 0;
  /** Reused across frames so a large blast does not allocate a map per frame. */
  private readonly positions = new Map<number, { x: number; y: number; z: number }>();

  constructor(private readonly fragments: FragmentMesh) {}

  /** True while there is still rock in the air. */
  get isPlaying(): boolean {
    return this.elapsedS < this.endsAtS;
  }

  /**
   * Start playing a blast back. Only fragments that actually moved are
   * animated, so a blast whose rock barely shifted costs nothing.
   */
  begin(flights: readonly FragmentFlight[]): void {
    this.flights = flights.filter(f => f.durationS > 0 && !samePlace(f));
    this.elapsedS = 0;
    this.endsAtS = totalFlightDuration(this.flights);
    // Put everything at its starting point immediately, or the first frame
    // would show the finished pile before the collapse begins.
    if (this.flights.length > 0) this.apply();
  }

  /** Stop animating and leave every fragment where the blast put it. */
  stop(): void {
    this.flights = [];
    this.elapsedS = 0;
    this.endsAtS = 0;
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
    this.positions.clear();
    for (const flight of this.flights) {
      this.positions.set(flight.fragmentId, flightPositionAt(flight, this.elapsedS));
    }
    this.fragments.updatePositions(this.positions);
  }
}

/** True when a fragment settled where it started and has nothing to animate. */
function samePlace(flight: FragmentFlight): boolean {
  const dx = flight.to.x - flight.from.x;
  const dy = flight.to.y - flight.from.y;
  const dz = flight.to.z - flight.from.z;
  return dx * dx + dy * dy + dz * dz < 1e-6;
}
