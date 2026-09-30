// BlastSimulator2026 — Widening a built ramp (#1298)
// A built ramp is a terrain feature that can be selected and ordered wider.
// Reusable core operation: #1208's traffic-jam event issues the same order.

import type { RampDef } from './Ramp.js';
import type { RampWidth } from '../config/balance.js';
import type { GameState } from '../state/GameState.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';

export interface RampFootprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** A finished ramp, recorded when its last segment is dug. */
export interface BuiltRamp {
  id: number;
  def: RampDef;
  width: RampWidth;
  footprint: RampFootprint;
}

export type WidenResult<T> = { success: true; data: T } | { success: false; error: string };

/** Tile rectangle a ramp of `def`'s placement covers at `width`. */
export function rampFootprint(_def: RampDef, _width: RampWidth): RampFootprint {
  throw new Error('not implemented');
}

/** The built ramp whose footprint contains tile (x, z), if any. */
export function findRampAtTile(_ramps: readonly BuiltRamp[], _x: number, _z: number): BuiltRamp | undefined {
  throw new Error('not implemented');
}

/** The next wider option after `current`, or null when already at the widest. */
export function nextRampWidth(_current: RampWidth): RampWidth | null {
  throw new Error('not implemented');
}

/** Checks a widen order (wider than current, known option, affordable) without mutating anything. */
export function validateWidenRamp(_ramp: BuiltRamp, _toWidth: RampWidth, _cash: number): WidenResult<{ cost: number }> {
  throw new Error('not implemented');
}

/** Orders `rampId` widened to `toWidth`: charges the cost and queues the extra excavation as a planned ramp. */
export function orderRampWiden(
  _state: GameState, _grid: VoxelGrid, _rampId: number, _toWidth: RampWidth,
): WidenResult<{ plannedRampId: number; cost: number }> {
  throw new Error('not implemented');
}
