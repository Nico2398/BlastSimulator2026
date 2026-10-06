// BlastSimulator2026 — Left column shell region (#1423)
// Owns the `bs-left-col` element that stacks the left-side panels, and
// declares its worst-case envelope so the layout matrix can prove the
// selection bar never covers it.

import { PANEL_WIDTH_PX } from '../dom.js';
import { shellLayoutRegistry, type Viewport, type Rect } from './LayoutRegistry.js';

/** Left edge of the column. */
export const LEFT_COL_LEFT_PX = 8;
/** Top edge of the column (below the top bar). */
export const LEFT_COL_TOP_PX = 70;
/** Margin kept free below the column. */
export const LEFT_COL_BOTTOM_MARGIN_PX = 10;
/** Right edge of the column: left offset plus one panel width. */
export const LEFT_COL_RIGHT_EDGE_PX: number = LEFT_COL_LEFT_PX + PANEL_WIDTH_PX;

/** Worst-case envelope of the column for a viewport. */
export function leftColumnBounds(_viewport: Viewport): Rect {
  // TODO: implement
  return undefined as unknown as Rect;
}

export class LeftColumn {
  readonly el: HTMLElement = undefined as unknown as HTMLElement;

  constructor(_container: HTMLElement) {
    // TODO: implement — build the `bs-left-col` element and append it to the container.
    shellLayoutRegistry.register({ id: 'left-col', layer: 'hud', bounds: leftColumnBounds });
  }

  dispose(): void {
    // TODO: implement
  }
}
