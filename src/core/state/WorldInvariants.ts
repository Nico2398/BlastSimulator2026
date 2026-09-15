// BlastSimulator2026 — World-state invariant checks (#1084)
//
// Pure inspection of a GameState for internal-consistency violations —
// dangling references, mismatched positions, conflicting assignments — that
// should never occur if the mount/itinerary/task machinery is correct.
// Returns a list rather than throwing so callers (tick pipeline, tests) can
// decide how to react.

import type { GameState } from './GameState.js';

export type ViolationKind =
  | 'I1_dangling_driver_reference'
  | 'I2_driver_position_mismatch'
  | 'I3_employee_drives_two_vehicles'
  | 'I4_moving_vehicle_without_driver'
  | 'I5_reservation_without_valid_holder'
  | 'I6_destination_partially_set'
  | 'I7_in_progress_vehicle_action_driver_mismatch'
  | 'I8_payload_not_in_transit'
  | 'I9_executing_task_still_travelling';

export interface Violation {
  kind: ViolationKind;
  employeeId?: number;
  vehicleId?: number;
  actionId?: number;
  fragmentId?: number;
}

export function assertWorldInvariants(_state: GameState): Violation[] {
  // TODO: implement
  throw new Error('not implemented');
}
