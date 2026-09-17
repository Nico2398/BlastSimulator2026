// BlastSimulator2026 — Placement kit (redesign P3)
// The three placement objects (controller/overlay/strip) are constructed once
// in main.ts, alongside scenePicking/entityHighlight, and handed down through
// UIManager to whichever panel needs to arm the tool. Only one panel arms it
// at a time — PlacementController's single confirm/cancel/change slots are
// simply overwritten by whichever panel armed most recently, which is
// correct since arming always supersedes whatever was armed before.
//
// Also holds what every panel arming the kit shares: how a dead Confirm is
// explained (placementRefusalReason) and the whole single-tile pick flow
// (armPointPick).

import type { PlacementController, PlacementSelection } from './PlacementController.js';
import type { SelectionOverlay, OverlayPointUpdate } from '../../renderer/SelectionOverlay.js';
import type { ParamStrip } from './ParamStrip.js';
import type { IconName } from '../icons.js';
import { t } from '../../core/i18n/I18n.js';
import type { ClaimRefusalReason } from '../../core/world/PlayableArea.js';
import { BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD } from '../../core/config/balance.js';

/** Site-claim refusal (#558) → the specific i18n key explaining it. `not_adjacent` shares `too_far`'s copy — bridging makes it effectively unreachable. */
const CLAIM_REFUSAL_KEY: Record<ClaimRefusalReason, string> = {
  protected_structure: 'shell.placement.refused_protected_ground',
  expansion_disabled: 'shell.placement.refused_expansion_disabled',
  too_far: 'shell.placement.refused_too_far',
  not_adjacent: 'shell.placement.refused_too_far',
};

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
  if (controller.refusalReason) return t(CLAIM_REFUSAL_KEY[controller.refusalReason]);
  if (controller.footprintInvalid) {
    return t('shell.placement.refused_uneven_ground', { max: BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD });
  }
  if (controller.refusedTile) return t('shell.placement.outside_region');
  if (!controller.selection) return t('shell.placement.pick_first');
  return t('shell.placement.outside_region');
}

/** What a single-tile pick differs by, panel to panel — everything else about the flow is identical. Deliberately not exported: callers pass an object literal to `armPointPick` and never name the type. */
interface PointPickSpec {
  /** Strip header icon. */
  icon: IconName;
  /** Strip title, e.g. "Pick a survey target". */
  title: string;
  /** Strip subtitle naming the subject of the pick (the survey method, the vehicle). */
  subtitle: string;
  /** Chip text above the strip while armed. */
  instruction: string;
  /** RESULT line for the tile currently picked; the strip shows an em dash while nothing is. */
  result: (sel: PlacementSelection) => string;
  /** Overlay styling for the picked point — survey's teal tone and coverage radius; omitted for a plain tile marker. */
  marker?: Pick<OverlayPointUpdate, 'tone' | 'radius'>;
  /** Tile pre-filled as the selection so Confirm is reachable at once. */
  initialSelection?: { x: number; z: number };
  /** Runs on Confirm, before the overlay's confirm flash. */
  onConfirm: (sel: PlacementSelection) => void;
}

/**
 * Arm the shared tool for a single-tile pick: overlay marker, param strip,
 * confirm/change wiring, then an immediate refresh so the strip is on screen
 * before the player moves the mouse. Clicking again while armed cancels,
 * which is what makes each panel's button a toggle.
 *
 * Shared by every panel whose flow is "pick one tile, then run a command"
 * (survey targeting, vehicle repositioning) — the parts that genuinely differ
 * are `PointPickSpec`, and nothing else about the sequence varies.
 */
export function armPointPick(kit: PlacementKit, spec: PointPickSpec): void {
  const { controller, overlay, strip } = kit;
  if (controller.isArmed) { controller.cancel(); return; }

  const refresh = (): void => {
    if (controller.currentPhase === 'idle') { overlay.clear(); strip.hide(); return; }
    const sel = controller.selection;
    overlay.update(sel ? { shape: 'point', x: sel.x1, z: sel.z1, ...spec.marker } : null);
    strip.show({
      icon: spec.icon,
      title: spec.title,
      subtitle: spec.subtitle,
      fields: [],
      result: sel ? spec.result(sel) : '—',
      confirmEnabled: controller.canConfirm,
      confirmDisabledReason: placementRefusalReason(controller),
      instruction: spec.instruction,
    });
  };

  controller.setConfirmHandler((sel) => {
    spec.onConfirm(sel);
    overlay.flashConfirm();
  });
  controller.setChangeHandler(refresh);
  controller.arm({
    shape: 'point',
    ...(spec.initialSelection ? { initialSelection: spec.initialSelection } : {}),
  });
  refresh();
}
