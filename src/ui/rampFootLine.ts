// BlastSimulator2026 — Ramp tool strip line: does the ramp's foot meet a dug end floor? (#1852)

import { t } from '../core/i18n/I18n.js';
import { rampEndFloorDrop, rampFootOffset, snapRampDepthToEndFloor } from '../core/mining/Ramp.js';
import { NAV_MAX_SLOPE_RATIO } from '../core/config/balance.js';

/**
 * One line for the ramp strip when the end tile is a dug floor, else ''. Reports the
 * snapped foot, or a foot that misses the floor by more than a step can climb.
 * Display only — the order still carries the player's depth.
 */
export function rampFootLine(startGround: number, endGround: number, depth: number, length: number): string {
  const drop = rampEndFloorDrop(startGround, endGround);
  if (drop === null || length < 1) return '';
  const snapped = snapRampDepthToEndFloor(startGround, endGround, depth, length);
  if (snapped === drop) return t('ui.build.ramp_foot_snapped', { depth: drop.toFixed(1) });
  const offset = rampFootOffset(startGround, endGround, depth, length);
  if (Math.abs(offset) <= NAV_MAX_SLOPE_RATIO) return '';
  return t('ui.build.ramp_foot_miss', {
    offset: Math.abs(offset).toFixed(1),
    side: t(offset > 0 ? 'ui.build.ramp_foot_above' : 'ui.build.ramp_foot_below'),
    depth: Math.round(drop),
  });
}
