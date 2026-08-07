// BlastSimulator2026 — Placement kit (redesign P3)
// The three placement objects (controller/overlay/strip) are constructed once
// in main.ts, alongside scenePicking/entityHighlight, and handed down through
// UIManager to whichever panel needs to arm the tool. Only one panel arms it
// at a time — PlacementController's single confirm/cancel/change slots are
// simply overwritten by whichever panel armed most recently, which is
// correct since arming always supersedes whatever was armed before.

import type { PlacementController } from './PlacementController.js';
import type { SelectionOverlay } from '../../renderer/SelectionOverlay.js';
import type { ParamStrip } from './ParamStrip.js';
import { t } from '../../core/i18n/I18n.js';

export interface PlacementKit {
  readonly controller: PlacementController;
  readonly overlay: SelectionOverlay;
  readonly strip: ParamStrip;
}

/**
 * Why Confirm is dead, in words the player can act on — or undefined when it
 * is not dead.
 *
 * Shared by every panel that arms the tool so a refusal reads the same
 * wherever it comes from. Each panel used to pass nothing at all, which left
 * "a Confirm that never enables" as the only symptom of an out-of-bounds pick
 * (#489).
 */
export function placementRefusalReason(controller: PlacementController): string | undefined {
  if (controller.canConfirm) return undefined;
  if (controller.refusedTile) return t('shell.placement.outside_region');
  if (!controller.selection) return t('shell.placement.pick_first');
  return t('shell.placement.outside_region');
}
