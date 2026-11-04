// @vitest-environment jsdom
// #2137 — window drag helper and the clamp it relies on.
// jsdom has no layout, so the target's getBoundingClientRect is a fake that reads
// back the inline left/top the helper writes (and a fixed size).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { attachWindowDrag, type WindowDrag } from '../../../src/ui/shell/windowDrag.js';
import {
  clampWindowPosition,
  defaultInspectorPosition,
  INSPECTOR_LEFT_PX,
  INSPECTOR_TOP_PX,
  INSPECTOR_MIN_TOP_PX,
} from '../../../src/ui/panels/inspector/inspectorLayout.js';
import { TOPBAR_HEIGHT_PX } from '../../../src/ui/tokens.js';

const VIEWPORT = { width: 1000, height: 700 };
const SIZE = { width: 300, height: 200 };

interface Fixture {
  handle: HTMLElement;
  target: HTMLElement;
  size: { width: number; height: number };
  viewport: { width: number; height: number };
  drag: WindowDrag;
  onDragEnd: ReturnType<typeof vi.fn>;
}

function px(value: string, fallback: number): number {
  return value === '' ? fallback : parseFloat(value);
}

function setup(opts: { start?: { x: number; y: number }; size?: { width: number; height: number }; viewport?: { width: number; height: number } } = {}): Fixture {
  const start = opts.start ?? { x: 100, y: 120 };
  const size = { ...(opts.size ?? SIZE) };
  const viewport = { ...(opts.viewport ?? VIEWPORT) };
  const target = document.createElement('div');
  const handle = document.createElement('div');
  target.appendChild(handle);
  document.body.appendChild(target);
  target.getBoundingClientRect = () => {
    const left = px(target.style.left, start.x);
    const top = px(target.style.top, start.y);
    return { left, top, x: left, y: top, width: size.width, height: size.height, right: left + size.width, bottom: top + size.height, toJSON: () => ({}) } as DOMRect;
  };
  const onDragEnd = vi.fn();
  const drag = attachWindowDrag({ handle, target, viewport: () => viewport, onDragEnd });
  return { handle, target, size, viewport, drag, onDragEnd };
}

function ptr(el: Element, type: string, init: { x?: number; y?: number; id?: number; button?: number } = {}): void {
  const id = init.id ?? 1;
  const base = { bubbles: true, cancelable: true, clientX: init.x ?? 0, clientY: init.y ?? 0, button: init.button ?? 0 };
  const ev: Event = typeof PointerEvent !== 'undefined'
    ? new PointerEvent(type, { ...base, pointerId: id })
    : new MouseEvent(type, base);
  if (!('pointerId' in ev) || (ev as PointerEvent).pointerId !== id) Object.defineProperty(ev, 'pointerId', { value: id });
  el.dispatchEvent(ev);
}

function pos(target: HTMLElement): { x: number; y: number } {
  return { x: parseFloat(target.style.left), y: parseFloat(target.style.top) };
}

afterEach(() => { document.body.innerHTML = ''; });

describe('clampWindowPosition', () => {
  it('leaves a position that already fits untouched', () => {
    expect(clampWindowPosition({ x: 100, y: 120 }, SIZE, VIEWPORT)).toEqual({ x: 100, y: 120 });
  });

  it('pulls a negative x to 0', () => {
    expect(clampWindowPosition({ x: -50, y: 120 }, SIZE, VIEWPORT).x).toBe(0);
  });

  it('pulls an x past the right edge back to viewport width minus window width', () => {
    expect(clampWindowPosition({ x: 900, y: 120 }, SIZE, VIEWPORT).x).toBe(VIEWPORT.width - SIZE.width);
  });

  it('keeps y below the top bar', () => {
    expect(clampWindowPosition({ x: 100, y: 0 }, SIZE, VIEWPORT).y).toBe(TOPBAR_HEIGHT_PX);
    expect(clampWindowPosition({ x: 100, y: -300 }, SIZE, VIEWPORT).y).toBe(INSPECTOR_MIN_TOP_PX);
  });

  it('pulls a y past the bottom edge back to viewport height minus window height', () => {
    expect(clampWindowPosition({ x: 100, y: 690 }, SIZE, VIEWPORT).y).toBe(VIEWPORT.height - SIZE.height);
  });

  it('accepts the exact boundary positions', () => {
    const corner = { x: VIEWPORT.width - SIZE.width, y: VIEWPORT.height - SIZE.height };
    expect(clampWindowPosition(corner, SIZE, VIEWPORT)).toEqual(corner);
    expect(clampWindowPosition({ x: 0, y: TOPBAR_HEIGHT_PX }, SIZE, VIEWPORT)).toEqual({ x: 0, y: TOPBAR_HEIGHT_PX });
  });

  it('pins x to 0 when the window is wider than the viewport', () => {
    expect(clampWindowPosition({ x: 40, y: 120 }, { width: 1200, height: 200 }, VIEWPORT).x).toBe(0);
    expect(clampWindowPosition({ x: -40, y: 120 }, { width: 1200, height: 200 }, VIEWPORT).x).toBe(0);
  });

  it('pins y to the top-bar line when the window is taller than the room below it', () => {
    expect(clampWindowPosition({ x: 100, y: 300 }, { width: 300, height: 900 }, VIEWPORT).y).toBe(TOPBAR_HEIGHT_PX);
    expect(clampWindowPosition({ x: 100, y: 0 }, { width: 300, height: VIEWPORT.height }, VIEWPORT).y).toBe(TOPBAR_HEIGHT_PX);
  });
});

describe('inspector placement numbers', () => {
  it('INSPECTOR_MIN_TOP_PX is the top bar height', () => {
    expect(INSPECTOR_MIN_TOP_PX).toBe(TOPBAR_HEIGHT_PX);
  });

  it('defaultInspectorPosition is the docked left/top', () => {
    expect(defaultInspectorPosition()).toEqual({ x: INSPECTOR_LEFT_PX, y: INSPECTOR_TOP_PX });
  });
});

describe('attachWindowDrag — moving', () => {
  it('moves the target by the pointer delta (inline left/top in px)', () => {
    const f = setup({ start: { x: 100, y: 120 } });
    ptr(f.handle, 'pointerdown', { x: 50, y: 60 });
    ptr(f.handle, 'pointermove', { x: 80, y: 95 });
    expect(f.target.style.left).toBe('130px');
    expect(f.target.style.top).toBe('155px');
    ptr(f.handle, 'pointerup', { x: 80, y: 95 });
    expect(pos(f.target)).toEqual({ x: 130, y: 155 });
  });

  it('follows the pointer through several moves, always from the grab point', () => {
    const f = setup({ start: { x: 100, y: 120 } });
    ptr(f.handle, 'pointerdown', { x: 10, y: 10 });
    ptr(f.handle, 'pointermove', { x: 20, y: 10 });
    ptr(f.handle, 'pointermove', { x: 40, y: 30 });
    ptr(f.handle, 'pointermove', { x: 15, y: 5 });
    expect(pos(f.target)).toEqual({ x: 105, y: 115 });
  });

  it('starts a second drag from where the first one ended', () => {
    const f = setup({ start: { x: 100, y: 120 } });
    ptr(f.handle, 'pointerdown', { x: 0, y: 0 });
    ptr(f.handle, 'pointermove', { x: 50, y: 50 });
    ptr(f.handle, 'pointerup', { x: 50, y: 50 });
    ptr(f.handle, 'pointerdown', { x: 200, y: 200 });
    ptr(f.handle, 'pointermove', { x: 210, y: 190 });
    expect(pos(f.target)).toEqual({ x: 160, y: 160 });
  });

  it('does not touch the target before any drag', () => {
    const f = setup();
    expect(f.target.style.left).toBe('');
    expect(f.target.style.top).toBe('');
    expect(f.drag.dragged).toBe(false);
  });

  it('ignores pointermove without a preceding pointerdown', () => {
    const f = setup();
    ptr(f.handle, 'pointermove', { x: 500, y: 500 });
    expect(f.target.style.left).toBe('');
    expect(f.drag.dragged).toBe(false);
  });

  it('stops following after pointerup', () => {
    const f = setup({ start: { x: 100, y: 120 } });
    ptr(f.handle, 'pointerdown', { x: 0, y: 0 });
    ptr(f.handle, 'pointermove', { x: 10, y: 10 });
    ptr(f.handle, 'pointerup', { x: 10, y: 10 });
    ptr(f.handle, 'pointermove', { x: 300, y: 300 });
    expect(pos(f.target)).toEqual({ x: 110, y: 130 });
  });

  it('reports dragged once a drag moved the window', () => {
    const f = setup();
    ptr(f.handle, 'pointerdown', { x: 0, y: 0 });
    ptr(f.handle, 'pointermove', { x: 10, y: 10 });
    ptr(f.handle, 'pointerup', { x: 10, y: 10 });
    expect(f.drag.dragged).toBe(true);
  });
});

describe('attachWindowDrag — clamping', () => {
  it('stops at the left and top limits (x 0, y below the top bar)', () => {
    const f = setup({ start: { x: 100, y: 120 } });
    ptr(f.handle, 'pointerdown', { x: 500, y: 500 });
    ptr(f.handle, 'pointermove', { x: 0, y: 0 });
    expect(pos(f.target)).toEqual({ x: 0, y: TOPBAR_HEIGHT_PX });
  });

  it('stops at the right and bottom limits', () => {
    const f = setup({ start: { x: 100, y: 120 } });
    ptr(f.handle, 'pointerdown', { x: 0, y: 0 });
    ptr(f.handle, 'pointermove', { x: 5000, y: 5000 });
    expect(pos(f.target)).toEqual({ x: VIEWPORT.width - SIZE.width, y: VIEWPORT.height - SIZE.height });
  });

  it('pins an oversized window to x 0 and the top-bar line', () => {
    const f = setup({ size: { width: 1400, height: 900 }, start: { x: 0, y: TOPBAR_HEIGHT_PX } });
    ptr(f.handle, 'pointerdown', { x: 10, y: 10 });
    ptr(f.handle, 'pointermove', { x: 200, y: 200 });
    expect(pos(f.target)).toEqual({ x: 0, y: TOPBAR_HEIGHT_PX });
  });

  it('reads the window size at drag start, not on each move', () => {
    const f = setup({ start: { x: 100, y: 120 } });
    ptr(f.handle, 'pointerdown', { x: 0, y: 0 });
    f.size.width = 600;
    f.size.height = 600;
    ptr(f.handle, 'pointermove', { x: 5000, y: 5000 });
    expect(pos(f.target)).toEqual({ x: VIEWPORT.width - SIZE.width, y: VIEWPORT.height - SIZE.height });
  });

  it('defaults the viewport to window.innerWidth/innerHeight', () => {
    const target = document.createElement('div');
    const handle = document.createElement('div');
    target.appendChild(handle);
    document.body.appendChild(target);
    target.getBoundingClientRect = () => {
      const left = px(target.style.left, 10);
      const top = px(target.style.top, 100);
      return { left, top, x: left, y: top, width: 200, height: 100, right: left + 200, bottom: top + 100, toJSON: () => ({}) } as DOMRect;
    };
    const drag = attachWindowDrag({ handle, target });
    ptr(handle, 'pointerdown', { x: 0, y: 0 });
    ptr(handle, 'pointermove', { x: 99999, y: 99999 });
    expect(pos(target)).toEqual({ x: window.innerWidth - 200, y: window.innerHeight - 100 });
    drag.dispose();
  });
});

describe('attachWindowDrag — what does not start a drag', () => {
  const interactive: Array<[string, () => HTMLElement]> = [
    ['button', () => document.createElement('button')],
    ['a', () => document.createElement('a')],
    ['input', () => document.createElement('input')],
    ['select', () => document.createElement('select')],
    ['[data-no-drag]', () => { const d = document.createElement('div'); d.setAttribute('data-no-drag', ''); return d; }],
  ];

  for (const [name, make] of interactive) {
    it(`a pointerdown on ${name} inside the header does not start a drag`, () => {
      const f = setup();
      const ctl = make();
      f.handle.appendChild(ctl);
      ptr(ctl, 'pointerdown', { x: 10, y: 10 });
      ptr(f.handle, 'pointermove', { x: 200, y: 200 });
      ptr(f.handle, 'pointerup', { x: 200, y: 200 });
      expect(f.target.style.left).toBe('');
      expect(f.target.style.top).toBe('');
      expect(f.drag.dragged).toBe(false);
      expect(f.onDragEnd).not.toHaveBeenCalled();
    });
  }

  it('a pointerdown on a child of a button does not start a drag', () => {
    const f = setup();
    const btn = document.createElement('button');
    const icon = document.createElement('span');
    btn.appendChild(icon);
    f.handle.appendChild(btn);
    ptr(icon, 'pointerdown', { x: 10, y: 10 });
    ptr(f.handle, 'pointermove', { x: 200, y: 200 });
    expect(f.target.style.left).toBe('');
    expect(f.drag.dragged).toBe(false);
  });

  it('a pointerdown on plain header content still starts a drag', () => {
    const f = setup({ start: { x: 100, y: 120 } });
    const title = document.createElement('div');
    f.handle.appendChild(title);
    ptr(title, 'pointerdown', { x: 0, y: 0 });
    ptr(f.handle, 'pointermove', { x: 20, y: 20 });
    expect(pos(f.target)).toEqual({ x: 120, y: 140 });
  });

  it('a non-primary button does not start a drag', () => {
    const f = setup();
    ptr(f.handle, 'pointerdown', { x: 0, y: 0, button: 2 });
    ptr(f.handle, 'pointermove', { x: 200, y: 200 });
    expect(f.target.style.left).toBe('');
    expect(f.drag.dragged).toBe(false);
    ptr(f.handle, 'pointerdown', { x: 0, y: 0, button: 1 });
    ptr(f.handle, 'pointermove', { x: 200, y: 200 });
    expect(f.target.style.left).toBe('');
  });

  it('pointermove of another pointer id is ignored', () => {
    const f = setup({ start: { x: 100, y: 120 } });
    ptr(f.handle, 'pointerdown', { x: 0, y: 0, id: 1 });
    ptr(f.handle, 'pointermove', { x: 400, y: 400, id: 2 });
    expect(f.target.style.left).toBe('');
    ptr(f.handle, 'pointermove', { x: 10, y: 10, id: 1 });
    expect(pos(f.target)).toEqual({ x: 110, y: 130 });
  });

  it('pointerup of another pointer id does not end the drag', () => {
    const f = setup({ start: { x: 100, y: 120 } });
    ptr(f.handle, 'pointerdown', { x: 0, y: 0, id: 1 });
    ptr(f.handle, 'pointerup', { x: 0, y: 0, id: 2 });
    expect(f.onDragEnd).not.toHaveBeenCalled();
    ptr(f.handle, 'pointermove', { x: 30, y: 30, id: 1 });
    expect(pos(f.target)).toEqual({ x: 130, y: 150 });
  });

  it('pointercancel ends the drag like pointerup', () => {
    const f = setup({ start: { x: 100, y: 120 } });
    ptr(f.handle, 'pointerdown', { x: 0, y: 0 });
    ptr(f.handle, 'pointermove', { x: 10, y: 10 });
    ptr(f.handle, 'pointercancel', { x: 10, y: 10 });
    ptr(f.handle, 'pointermove', { x: 300, y: 300 });
    expect(pos(f.target)).toEqual({ x: 110, y: 130 });
  });
});

describe('attachWindowDrag — onDragEnd and reclamp', () => {
  it('calls onDragEnd once on pointerup with the final clamped position', () => {
    const f = setup({ start: { x: 100, y: 120 } });
    ptr(f.handle, 'pointerdown', { x: 0, y: 0 });
    ptr(f.handle, 'pointermove', { x: 20, y: 30 });
    expect(f.onDragEnd).not.toHaveBeenCalled();
    ptr(f.handle, 'pointermove', { x: 9999, y: 9999 });
    ptr(f.handle, 'pointerup', { x: 9999, y: 9999 });
    expect(f.onDragEnd).toHaveBeenCalledTimes(1);
    expect(f.onDragEnd).toHaveBeenCalledWith({ x: VIEWPORT.width - SIZE.width, y: VIEWPORT.height - SIZE.height });
  });

  it('does not call onDragEnd again for a stray second pointerup', () => {
    const f = setup();
    ptr(f.handle, 'pointerdown', { x: 0, y: 0 });
    ptr(f.handle, 'pointermove', { x: 10, y: 10 });
    ptr(f.handle, 'pointerup', { x: 10, y: 10 });
    ptr(f.handle, 'pointerup', { x: 10, y: 10 });
    expect(f.onDragEnd).toHaveBeenCalledTimes(1);
  });

  it('reclamp returns null and leaves the target alone if never dragged', () => {
    const f = setup();
    f.viewport.width = 100;
    expect(f.drag.reclamp()).toBeNull();
    expect(f.target.style.left).toBe('');
    expect(f.target.style.top).toBe('');
  });

  it('reclamp pulls a dragged window back into a shrunken viewport', () => {
    const f = setup({ start: { x: 100, y: 120 } });
    ptr(f.handle, 'pointerdown', { x: 0, y: 0 });
    ptr(f.handle, 'pointermove', { x: 600, y: 400 });
    ptr(f.handle, 'pointerup', { x: 600, y: 400 });
    expect(pos(f.target)).toEqual({ x: 700, y: 520 });
    f.viewport.width = 800;
    f.viewport.height = 600;
    const result = f.drag.reclamp();
    expect(result).toEqual({ x: 500, y: 400 });
    expect(pos(f.target)).toEqual({ x: 500, y: 400 });
  });

  it('reclamp leaves a window that still fits where it is', () => {
    const f = setup({ start: { x: 100, y: 120 } });
    ptr(f.handle, 'pointerdown', { x: 0, y: 0 });
    ptr(f.handle, 'pointermove', { x: 40, y: 40 });
    ptr(f.handle, 'pointerup', { x: 40, y: 40 });
    expect(f.drag.reclamp()).toEqual({ x: 140, y: 160 });
    expect(pos(f.target)).toEqual({ x: 140, y: 160 });
  });
});

describe('attachWindowDrag — dispose', () => {
  it('events do nothing after dispose', () => {
    const f = setup();
    f.drag.dispose();
    ptr(f.handle, 'pointerdown', { x: 0, y: 0 });
    ptr(f.handle, 'pointermove', { x: 100, y: 100 });
    ptr(f.handle, 'pointerup', { x: 100, y: 100 });
    expect(f.target.style.left).toBe('');
    expect(f.drag.dragged).toBe(false);
    expect(f.onDragEnd).not.toHaveBeenCalled();
  });

  it('a drag in flight stops following once disposed', () => {
    const f = setup({ start: { x: 100, y: 120 } });
    ptr(f.handle, 'pointerdown', { x: 0, y: 0 });
    ptr(f.handle, 'pointermove', { x: 10, y: 10 });
    f.drag.dispose();
    ptr(f.handle, 'pointermove', { x: 300, y: 300 });
    ptr(f.handle, 'pointerup', { x: 300, y: 300 });
    expect(pos(f.target)).toEqual({ x: 110, y: 130 });
    expect(f.onDragEnd).not.toHaveBeenCalled();
  });
});
