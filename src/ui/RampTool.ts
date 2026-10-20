// BlastSimulator2026 — Ramp placement tool (multi-leg path, grade, readout, spiral)

import type { PlacementKit } from './scene/PlacementKit.js';
import type { GameState } from '../core/state/GameState.js';
import type { GameConsoleFn } from './gameConsole.js';
import type { SpiralSurface } from '../core/mining/RampSpiral.js';

export interface RampToolDeps {
  kit: PlacementKit;
  getState: () => GameState | null;
  console: GameConsoleFn | undefined;
  setStatus: (text: string) => void;
  /** Ground-truth height sampler; null when unavailable. */
  sampler: ((x: number, z: number) => number) | null;
  /** Terrain seam for the spiral order; null when no grid is available. */
  spiralSurface: () => SpiralSurface | null;
}

export class RampTool {
  constructor(private readonly deps: RampToolDeps) {}

  /** Arms the ramp tool, or cancels it when already armed. */
  arm(): void {
    void this.deps;
    throw new Error('not implemented');
  }
}
