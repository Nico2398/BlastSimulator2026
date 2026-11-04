// BlastSimulator2026 — Pointer-driven window drag (#2137)
// Makes a header a drag handle for a fixed-position window: grab on the
// header, clamp to the viewport and below the top bar, report the final spot.

import { clampWindowPosition } from '../panels/inspector/inspectorLayout.js';
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

/** Header controls that keep their own click and never start a drag. */
const NO_DRAG_SELECTOR = 'button, a, input, select, [data-no-drag]';

interface ActiveDrag {
  readonly pointerId: number;
  readonly originX: number;
  readonly originY: number;
  readonly start: WindowPoint;
  readonly size: WindowSize;
}

export function attachWindowDrag(opts: WindowDragOptions): WindowDrag {
  const { handle, target } = opts;
  const viewport = opts.viewport ?? ((): WindowSize => ({ width: window.innerWidth, height: window.innerHeight }));
  let active: ActiveDrag | null = null;
  let position: WindowPoint | null = null;
  let disposed = false;

  const place = (pos: WindowPoint): void => {
    position = pos;
    target.style.left = `${pos.x}px`;
    target.style.top = `${pos.y}px`;
  };

  const onDown = (e: PointerEvent): void => {
    if (disposed || active || e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest(NO_DRAG_SELECTOR) && handle.contains(e.target)) return;
    const rect = target.getBoundingClientRect();
    active = {
      pointerId: e.pointerId, originX: e.clientX, originY: e.clientY,
      start: { x: rect.left, y: rect.top }, size: { width: rect.width, height: rect.height },
    };
    handle.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };

  const onMove = (e: PointerEvent): void => {
    if (!active || e.pointerId !== active.pointerId) return;
    place(clampWindowPosition(
      { x: active.start.x + e.clientX - active.originX, y: active.start.y + e.clientY - active.originY },
      active.size, viewport(),
    ));
  };

  const onEnd = (e: PointerEvent): void => {
    if (!active || e.pointerId !== active.pointerId) return;
    const id = active.pointerId;
    active = null;
    if (handle.hasPointerCapture?.(id)) handle.releasePointerCapture?.(id);
    if (e.type === 'pointerup' && position) opts.onDragEnd?.(position);
  };

  handle.addEventListener('pointerdown', onDown);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onEnd);
  document.addEventListener('pointercancel', onEnd);

  return {
    get dragged(): boolean { return position !== null; },
    reclamp(): WindowPoint | null {
      if (!position) return null;
      const rect = target.getBoundingClientRect();
      place(clampWindowPosition(position, { width: rect.width, height: rect.height }, viewport()));
      return position;
    },
    dispose(): void {
      disposed = true;
      active = null;
      handle.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
      document.removeEventListener('pointercancel', onEnd);
    },
  };
}
