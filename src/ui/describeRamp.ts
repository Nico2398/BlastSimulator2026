// BlastSimulator2026 — Title and subline shared by the ramp inspector and hover tag (#1298)

import { t } from '../core/i18n/I18n.js';
import type { BuiltRamp } from '../core/state/GameState.js';
import type { VehicleTier } from '../core/entities/Vehicle.js';

/** The one-line title and detail line naming a built ramp. */
export function describeRamp(
  ramp: BuiltRamp,
  _opts?: { gradeDeg: number; tiers: VehicleTier[]; progression: boolean },
): { title: string; sub: string } {
  return {
    title: t('shell.selection.ramp_title', { width: ramp.width }),
    sub: t('shell.selection.ramp_sub', { id: ramp.id, width: ramp.width, length: ramp.def.length }),
  };
}
