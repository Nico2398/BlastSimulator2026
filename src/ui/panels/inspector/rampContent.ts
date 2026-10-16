/** Inspector content for ramp selections (#1769). */
import type { BuiltRamp, PlannedRamp } from '../../../core/state/GameState.js';
import type { KindContent } from './InspectorContent.js';

export interface WidenState {
  /** Cost of the next widening, null when the ramp is at maximum width. */
  cost: number | null;
  /** Why Widen is disabled, null when it is available. */
  disabledReason: string | null;
}

export function widenState(_ramp: BuiltRamp, _plannedRamps: readonly PlannedRamp[], _cash: number): WidenState {
  // TODO: implement
  return { cost: null, disabledReason: null };
}

export const rampContent: KindContent = {
  view() {
    // TODO: implement
    return null;
  },
};
