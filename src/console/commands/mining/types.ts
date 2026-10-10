// BlastSimulator2026 — Shared types for mining console commands

import type { GameContext } from '../world.js';
import type { FragmentData } from '../../../core/mining/BlastExecution.js';
import type { Steps } from '../../../core/engine/Steps.js';
import type { CommandResult } from '../../ConsoleRunner.js';

// ── Extended context for mining ──

export interface MiningContext extends GameContext {
  /** Positions of fragments from the last blast — used by renderer for localized re-mesh. */
  lastBlastFragments?: { x: number; y: number; z: number }[];
  /** Full fragment data from last blast — used by renderer to spawn fragment meshes. */
  lastBlastFragmentData?: FragmentData[];
  /** Drill holes from before the last blast — used by renderer for per-hole detonation timing. */
  lastBlastHoles?: import('../../../core/mining/DrillPlan.js').DrillHole[];
  /** Each fragment's journey from where it broke to where it settled — the renderer animates these. */
  lastBlastFlights?: import('../../../core/mining/BlastResolve.js').FragmentFlight[];
  /**
   * Fire an armed detonation as a job resolved a few slices per frame
   * (`blastJob`) instead of all at once (#1603). Only the browser's frame loop
   * sets it; the console and every harness fire synchronously.
   */
  sliceBlasts?: boolean;
  /**
   * A blast being resolved in slices. The game is frozen in time until it
   * finishes: the frame loop holds ticks back, and every command finishes it
   * before running (`runCommand`).
   */
  blastJob?: Steps<CommandResult> | null;
}
