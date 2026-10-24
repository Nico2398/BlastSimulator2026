// BlastSimulator2026 — Ramp tool strip line: the ramp's foot lands on a dug end floor (#1852, #2045)

import { t } from '../core/i18n/I18n.js';
import { rampEndFloorDrop } from '../core/mining/Ramp.js';

/**
 * One line for the ramp strip when the end tile is a dug floor, else ''. A ramp ending on
 * a dug floor always lands on it (`landRampOnEndFloor`), so the line names the depth it
 * lands at; one that cannot reach it is refused by validation, never built with a step.
 */
export function rampFootLine(startGround: number, endGround: number): string {
  const drop = rampEndFloorDrop(startGround, endGround);
  return drop === null ? '' : t('ui.build.ramp_foot_snapped', { depth: drop.toFixed(1) });
}
