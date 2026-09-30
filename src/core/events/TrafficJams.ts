// BlastSimulator2026 — Traffic jam detection at chokepoints (#1208)

import type { BuiltRamp } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';

export type ChokepointKind = 'ramp_head' | 'pit_exit' | 'passage';

/** A cluster of stuck agents at one chokepoint. */
export interface TrafficJam {
  /** Stable chokepoint identity, used to silence a jam after the player answers it. */
  key: string;
  kind: ChokepointKind;
  /** The ramp the jam sits on; null for a passage jam away from any ramp. */
  rampId: number | null;
  x: number;
  z: number;
  agentIds: number[];
  vehicleCount: number;
}

/** Finds every chokepoint with enough stuck agents, skipping keys silenced until a later tick. */
export function findTrafficJams(
  _ramps: readonly Pick<BuiltRamp, 'id' | 'def' | 'footprint'>[],
  _employees: readonly Employee[],
  _silencedUntil?: Readonly<Record<string, number>>,
  _tick?: number,
): TrafficJam[] {
  // TODO: implement
  return [];
}
