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

export interface PlacementKit {
  readonly controller: PlacementController;
  readonly overlay: SelectionOverlay;
  readonly strip: ParamStrip;
}
