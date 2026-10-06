// BlastSimulator2026 — Left column shell region (#1423)
// Owns the `bs-left-col` element that stacks the left-side panels, and
// declares its worst-case envelope so the layout matrix can prove the
// selection bar never covers it.

import { PANEL_WIDTH_PX } from '../dom.js';
import { shellLayoutRegistry, type Viewport, type Rect } from './LayoutRegistry.js';

/** Left edge of the column. */
const LEFT_COL_LEFT_PX = 8;
/** Top edge of the column (below the top bar). */
const LEFT_COL_TOP_PX = 70;
/** Margin kept free below the column. */
const LEFT_COL_BOTTOM_MARGIN_PX = 10;
/** Right edge of the column: left offset plus one panel width. */
export const LEFT_COL_RIGHT_EDGE_PX: number = LEFT_COL_LEFT_PX + PANEL_WIDTH_PX;

/** Worst-case envelope of the column for a viewport. */
export function leftColumnBounds(viewport: Viewport): Rect {
  return {
    x: LEFT_COL_LEFT_PX,
    y: LEFT_COL_TOP_PX,
    width: PANEL_WIDTH_PX,
    height: viewport.height - LEFT_COL_TOP_PX - LEFT_COL_BOTTOM_MARGIN_PX,
  };
}

export class LeftColumn {
  readonly el: HTMLElement;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'bs-left-col';
    // max-height, not height: when the column's content overflows, max-height
    // clamps its used height to a definite value, which is what each panel's
    // own `max-height:100%` (BuildMenu.ts and its 8 siblings) resolves
    // against — so the panels are bounded and their bodies scroll without
    // this needing to be a fixed height. Verified against
    // crew-panel-short-viewport.json: reverting this line alone keeps that
    // scenario green, while reverting CrewPanel's roster-row `flex-shrink:0`
    // fails it.
    this.el.style.cssText = `position:fixed;top:${LEFT_COL_TOP_PX}px;left:${LEFT_COL_LEFT_PX}px;z-index:100;display:flex;flex-direction:column;gap:6px;max-height:calc(100vh - ${LEFT_COL_TOP_PX + LEFT_COL_BOTTOM_MARGIN_PX}px);overflow-y:auto;pointer-events:none`;
    container.appendChild(this.el);
    shellLayoutRegistry.register({ id: 'left-col', layer: 'hud', bounds: leftColumnBounds });
  }

  dispose(): void {
    this.el.remove();
    shellLayoutRegistry.unregister('left-col');
  }
}
