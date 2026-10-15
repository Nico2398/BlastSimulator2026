// BlastSimulator2026 — Inspector window placement (#1756, spec 6.18)
// Numbers shared by the stylesheet (which positions #bs-inspector) and the
// layout registry envelope (which proves it collides with nothing).

import { PANEL_WIDTH_PX } from '../../dom.js';
import { TOPBAR_HEIGHT_PX, SPACING_3_PX } from '../../tokens.js';
import { LEFT_COL_RIGHT_EDGE_PX } from '../../shell/LeftColumn.js';
import type { Rect, Viewport } from '../../shell/LayoutRegistry.js';

/** Gap between the left panel column's right edge and the inspector. */
export const INSPECTOR_LEFT_GAP_PX = 8;
/** Left edge: just right of the left column. */
export const INSPECTOR_LEFT_PX = LEFT_COL_RIGHT_EDGE_PX + INSPECTOR_LEFT_GAP_PX;
/** Height of the modifier chip strip (ModifierChips.ts), which the inspector sits below. */
const MODIFIER_CHIPS_HEIGHT_PX = 30;
/** Top edge: below the top bar and the modifier chips, with a small gap. */
export const INSPECTOR_TOP_PX = TOPBAR_HEIGHT_PX + SPACING_3_PX + MODIFIER_CHIPS_HEIGHT_PX + 6;
/** Bottom clearance above the bottom-centre dock, same as `#bs-param-strip` (styles.ts). */
export const INSPECTOR_BOTTOM_PX = 18;

/** Worst-case envelope: full height of the band between the chips and the dock. */
export function inspectorBounds(viewport: Viewport): Rect {
  return {
    x: INSPECTOR_LEFT_PX,
    y: INSPECTOR_TOP_PX,
    width: PANEL_WIDTH_PX,
    height: viewport.height - INSPECTOR_TOP_PX - INSPECTOR_BOTTOM_PX,
  };
}
