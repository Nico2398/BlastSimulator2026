// BlastSimulator2026 — Pointer-driven window drag (#2137)
// Makes a header a drag handle for a fixed-position window: grab on the
// header, clamp to the viewport and below the top bar, report the final spot.

import type { WindowPoint, WindowSize } from '../panels/inspector/inspectorLayout.js';

export interface WindowDragOptions {
  /** The element the pointer grabs (a window header). */
  readonly handle: HTMLElement;
  /** The fixed-position window that moves. */
  readonly target: HTMLElement;
  /** Viewport size; defaults to window.innerWidth/innerHeight. */
  readonly viewport?: () => WindowSize;
  /** Called once on release with the final clamped position. */
  readonly onDragEnd?: (pos: WindowPoint) => void;
}

export interface WindowDrag {
  /** True once the window has been dragged at least once. */
  readonly dragged: boolean;
  /** Re-clamp the dragged position into the viewport; null when never dragged. */
  reclamp(): WindowPoint | null;
  dispose(): void;
}

export function attachWindowDrag(_opts: WindowDragOptions): WindowDrag {
  throw new Error('not implemented');
}
