// BlastSimulator2026 — Central window stage (#2242)
// The management windows (Crew, Fleet, Build, Contracts, Operations,
// Finances, Shady, Permits) open here: a large area in the middle of the
// screen instead of the narrow left column. The stage keeps clear of every
// piece of HUD chrome a player still needs while a window is up — the top
// bar and modifier chips above it, the toast column, tool rail, event notices
// and minimap on its right — so nothing the harness or a player clicks ever
// sits underneath it.
//
// Three body classes reshape it, all in STAGE_CSS below:
//   bs-placement-armed   a placement tool owns the canvas: the window docks back
//                        into the left column's slot, exactly where the old
//                        lateral panel stood, so every tile it used to leave
//                        clear stays clear.
//   bs-tutorial-card     the coach card is up: the bottom edge lifts above it.
//   bs-inspector-open    the entity inspector docks on the stage's right edge
//                        and the window narrows to make room for it.

import { shellLayoutRegistry, type Rect, type Viewport } from './LayoutRegistry.js';
import { TOASTS_RIGHT_OFFSET_PX, TOASTS_WIDTH_PX } from './Toasts.js';
import { INSPECTOR_TOP_PX } from '../panels/inspector/inspectorLayout.js';
import { PANEL_WIDTH_PX } from '../dom.js';

/** Top edge: below the top bar and the modifier chip strip, level with the inspector. */
const CENTER_STAGE_TOP_PX = INSPECTOR_TOP_PX;
const CENTER_STAGE_LEFT_PX = 16;
const CENTER_STAGE_BOTTOM_PX = 12;
/** Gap kept between the stage and the toast column on its right. */
const TOAST_GAP_PX = 12;
/** Right edge reserve: the toast column and its offset, which also clears the rail, notices and minimap. */
const CENTER_STAGE_RIGHT_PX = TOASTS_RIGHT_OFFSET_PX + TOASTS_WIDTH_PX + TOAST_GAP_PX;
/** Widest a window grows on a large screen; it centres in the stage beyond that. */
export const CENTER_WINDOW_MAX_WIDTH_PX = 1240;
/** Gap between a window and the inspector docked beside it. */
const INSPECTOR_DOCK_GAP_PX = 8;

/** The stage's envelope at a viewport: the most any window may cover. */
export function centerStageBounds(viewport: Viewport): Rect {
  return {
    x: CENTER_STAGE_LEFT_PX,
    y: CENTER_STAGE_TOP_PX,
    width: viewport.width - CENTER_STAGE_LEFT_PX - CENTER_STAGE_RIGHT_PX,
    height: viewport.height - CENTER_STAGE_TOP_PX - CENTER_STAGE_BOTTOM_PX,
  };
}

/** Where the inspector docks while a window is open: the stage's right edge, full stage height. */
export function dockedInspectorBounds(viewport: Viewport): Rect {
  const stage = centerStageBounds(viewport);
  return { x: stage.x + stage.width - PANEL_WIDTH_PX, y: stage.y, width: PANEL_WIDTH_PX, height: stage.height };
}

/** The window's box: the stage (narrowed by the docked inspector when open), capped and centred. */
export function centerWindowBounds(viewport: Viewport, inspectorOpen: boolean): Rect {
  const stage = centerStageBounds(viewport);
  const room = inspectorOpen ? stage.width - PANEL_WIDTH_PX - INSPECTOR_DOCK_GAP_PX : stage.width;
  const width = Math.min(room, CENTER_WINDOW_MAX_WIDTH_PX);
  return { x: stage.x + (room - width) / 2, y: stage.y, width, height: stage.height };
}

/** Left-column slot the window docks into while a placement tool is armed (LeftColumn.ts). */
const DOCKED_LEFT_PX = 8;
const DOCKED_TOP_PX = 70;
const DOCKED_BOTTOM_PX = 10;

export const STAGE_CSS = `
#bs-center-stage {
  position: fixed; z-index: var(--bsx-z-panel);
  left: ${CENTER_STAGE_LEFT_PX}px; top: ${CENTER_STAGE_TOP_PX}px;
  right: ${CENTER_STAGE_RIGHT_PX}px; bottom: ${CENTER_STAGE_BOTTOM_PX}px;
  display: flex; justify-content: center; align-items: stretch;
  pointer-events: none;
}
#bs-center-stage > .bsx-window { width: 100%; max-width: ${CENTER_WINDOW_MAX_WIDTH_PX}px; height: 100%; }
body.bs-inspector-open #bs-center-stage { right: ${CENTER_STAGE_RIGHT_PX + PANEL_WIDTH_PX + INSPECTOR_DOCK_GAP_PX}px; }
body.bs-tutorial-card #bs-center-stage { bottom: var(--bsx-tutorial-card-clearance, 210px); }
body.bs-placement-armed #bs-center-stage {
  left: ${DOCKED_LEFT_PX}px; top: ${DOCKED_TOP_PX}px; bottom: ${DOCKED_BOTTOM_PX}px; right: auto;
  width: ${PANEL_WIDTH_PX}px;
}
body.bs-window-open:not(.bs-placement-armed) #bs-inspector:not(.bs-inspector-moved) {
  left: auto; right: ${CENTER_STAGE_RIGHT_PX}px; top: ${CENTER_STAGE_TOP_PX}px;
  max-height: calc(100vh - ${CENTER_STAGE_TOP_PX}px - var(--bs-inspector-bottom));
}
`;

export class CenterStage {
  readonly el: HTMLElement;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'bs-center-stage';
    this.el.className = 'bsx-root';
    container.appendChild(this.el);
    // An overlay by design: it is drawn over the left column's slot (never at the same time — one panel
    // opens at a time) and over the scene. What it must never cover is checked pairwise in layoutRegions.test.ts.
    shellLayoutRegistry.register({ id: 'center-stage', layer: 'overlay', bounds: centerStageBounds });
  }

  /** Mark the page while a central window is up: the inspector docks beside it (STAGE_CSS). */
  setWindowOpen(open: boolean): void {
    document.body.classList.toggle('bs-window-open', open);
  }

  dispose(): void {
    this.setWindowOpen(false);
    this.el.remove();
    shellLayoutRegistry.unregister('center-stage');
  }
}
