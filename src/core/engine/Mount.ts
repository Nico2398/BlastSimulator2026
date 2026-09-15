// BlastSimulator2026 — Board/alight: the only entry points that change an
// employee's Locomotion and a vehicle's occupantIds together.

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';

export type MountResult = { success: true } | { success: false; error: string };

/** Board an employee onto a vehicle. */
export function board(_state: GameState, _vehicleId: number, _employeeId: number, _emitter?: EventEmitter): MountResult {
  throw new Error('not implemented');
}

/** Alight the driving/riding employee(s) from a vehicle. */
export function alight(_state: GameState, _vehicleId: number, _emitter?: EventEmitter): MountResult {
  throw new Error('not implemented');
}
