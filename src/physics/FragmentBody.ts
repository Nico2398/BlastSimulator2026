// BlastSimulator2026 — Fragment physics bodies
// Creates Cannon-es rigid bodies for blast fragments and simulates until they settle.
// Fragments inherit initial velocity from BlastCalc, then physics takes over.
// After simulation, final positions are written back to the FragmentData objects.
//
// Real physics: a 100kg rock fragment at 10 m/s has KE = 0.5*100*100 = 5000 J.
// Fragment sizes are box-approximated from their volume (cube root → half-extent).

import type { FragmentData } from '../core/mining/BlastExecution.js';
import type { PhysicsWorld, PhysicsBodyId } from './PhysicsWorld.js';

// ── Config ──

/**
 * Max simulation steps before forcing a stop (prevents infinite loop for unstable sims).
 * At 1/60s per step: 600 steps = 10 seconds of game physics.
 */
const MAX_SIM_STEPS = 600;

/** Step size in seconds. */
const STEP_DT = 1 / 60;

/**
 * Speed threshold below which a fragment is considered "settled" (m/s).
 * Real settling: <0.1 m/s is practically stopped.
 */
const SETTLE_SPEED = 0.1;

/** Fraction of fragments that must be settled before we stop simulation. */
const SETTLE_FRACTION = 0.95;

// ── Types ──

export interface FragmentSimResult {
  /** Fragment ID. */
  fragmentId: number;
  /** Final world position after simulation. */
  finalPosition: { x: number; y: number; z: number };
  /** Whether the fragment settled (vs hit max steps). */
  settled: boolean;
  /**
   * Speed at the moment of settling (m/s).
   * Approximates impact speed: last recorded speed before body stopped moving.
   * Used by CollisionHandler to compute kinetic energy at impact.
   */
  impactSpeed: number;
}

// ── FragmentBody ──

/**
 * Manages physics bodies for a set of blast fragments.
 * Usage:
 *   const fb = new FragmentBody(world);
 *   fb.addFragments(fragments);
 *   fb.simulate();
 *   const results = fb.getResults();
 *   fb.dispose();
 */
export class FragmentBody {
  private world: PhysicsWorld;
  private handles = new Map<number, PhysicsBodyId>(); // fragmentId → body handle
  /** Speed recorded just before each fragment settled (m/s). Populated by simulate(). */
  private impactSpeeds = new Map<number, number>(); // fragmentId → speed

  constructor(world: PhysicsWorld) {
    this.world = world;
  }

  /**
   * Add physics bodies for each fragment.
   * Fragment volume → box half-extent (cube root of volume / 2).
   * Fragment mass and initial velocity are from BlastCalc output.
   */
  addFragments(fragments: FragmentData[]): void {
    for (const f of fragments) {
      // Box half-extent from volume: v = (2h)^3, so h = cbrt(v)/2
      // Minimum half-extent 0.1m to avoid degenerate bodies
      const halfExtent = Math.max(0.1, Math.cbrt(f.volume) / 2);

      const handle = this.world.addBody(
        'box',
        [halfExtent, halfExtent, halfExtent],
        f.mass,
        { x: f.position.x, y: f.position.y, z: f.position.z },
        { x: f.initialVelocity.x, y: f.initialVelocity.y, z: f.initialVelocity.z },
      );

      this.handles.set(f.id, handle);
    }
  }

  /**
   * Run the simulation until fragments settle or max steps reached.
   * Tracks impact speed — the peak speed observed during simulation.
   * Peak speed approximates the speed at first terrain contact, which is
   * the maximum KE the fragment carries before energy dissipation via bouncing.
   * Returns number of steps simulated.
   */
  simulate(): number {
    const total = this.handles.size;
    if (total === 0) return 0;

    // Track peak speed per fragment (impact speed = max speed during flight)
    const peakSpeeds = new Map<number, number>();
    for (const [fragmentId] of this.handles) {
      peakSpeeds.set(fragmentId, 0);
    }

    let steps = 0;
    while (steps < MAX_SIM_STEPS) {
      this.world.step(STEP_DT);
      steps++;

      // Check if enough fragments have settled; record peak speeds
      let settledCount = 0;
      for (const [fragmentId, handle] of this.handles) {
        const speed = this.world.getBodySpeed(handle);
        // Track maximum speed — this is the impact speed when fragment first hits terrain
        if (speed > (peakSpeeds.get(fragmentId) ?? 0)) {
          peakSpeeds.set(fragmentId, speed);
        }
        if (speed < SETTLE_SPEED) {
          settledCount++;
        }
      }
      if (settledCount >= Math.ceil(total * SETTLE_FRACTION)) break;
    }

    // Store peak speeds as impact speeds
    for (const [fragmentId] of this.handles) {
      this.impactSpeeds.set(fragmentId, peakSpeeds.get(fragmentId) ?? 0);
    }

    return steps;
  }

  /**
   * Get final positions for all fragments.
   * Call after simulate().
   */
  getResults(): FragmentSimResult[] {
    const results: FragmentSimResult[] = [];
    for (const [fragmentId, handle] of this.handles) {
      const pos = this.world.getBodyPosition(handle);
      if (!pos) continue;
      results.push({
        fragmentId,
        finalPosition: pos,
        settled: this.world.getBodySpeed(handle) < SETTLE_SPEED,
        impactSpeed: this.impactSpeeds.get(fragmentId) ?? 0,
      });
    }
    return results;
  }

  /**
   * Write final positions back to the original FragmentData array.
   * Call after getResults() to update GameState fragment positions.
   */
  applyResults(fragments: FragmentData[]): void {
    const results = this.getResults();
    const resultMap = new Map(results.map(r => [r.fragmentId, r.finalPosition]));

    for (const f of fragments) {
      const pos = resultMap.get(f.id);
      if (pos) {
        f.position = { x: pos.x, y: pos.y, z: pos.z };
      }
    }
  }

  /** Remove all fragment bodies from the physics world. */
  dispose(): void {
    for (const handle of this.handles.values()) {
      this.world.removeBody(handle);
    }
    this.handles.clear();
    this.impactSpeeds.clear();
  }

  /** Number of fragment bodies. */
  get bodyCount(): number {
    return this.handles.size;
  }
}
