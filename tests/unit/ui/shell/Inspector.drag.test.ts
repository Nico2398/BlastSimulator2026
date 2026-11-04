// @vitest-environment jsdom
// #2137 — the inspector window can be dragged by its header and keeps its place.
// jsdom has no layout, so the root's getBoundingClientRect is a fake: it reads back
// the inline left/top (or the default dock spot when none) and a fixed size.
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { Inspector } from '../../../../src/ui/shell/Inspector.js';
import { shellLayoutRegistry } from '../../../../src/ui/shell/LayoutRegistry.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { hireEmployee } from '../../../../src/core/entities/Employee.js';
import { purchaseVehicle } from '../../../../src/core/entities/Vehicle.js';
import { Random } from '../../../../src/core/math/Random.js';
import type { EntityPick } from '../../../../src/ui/scene/ScenePicking.js';
import { defaultInspectorPosition, inspectorBounds } from '../../../../src/ui/panels/inspector/inspectorLayout.js';
import { TOPBAR_HEIGHT_PX } from '../../../../src/ui/tokens.js';

const WIN = { width: 372, height: 420 };
const realInnerWidth = window.innerWidth;
const realInnerHeight = window.innerHeight;

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

function px(value: string, fallback: number): number {
  return value === '' ? fallback : parseFloat(value);
}

function makeBar(): { bar: Inspector; root: HTMLElement; header: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const bar = new Inspector(container);
  const root = container.firstElementChild as HTMLElement;
  const dock = defaultInspectorPosition();
  root.getBoundingClientRect = () => {
    const left = px(root.style.left, dock.x);
    const top = px(root.style.top, dock.y);
    return { left, top, x: left, y: top, width: WIN.width, height: WIN.height, right: left + WIN.width, bottom: top + WIN.height, toJSON: () => ({}) } as DOMRect;
  };
  return { bar, root, header: root.firstElementChild as HTMLElement };
}

function entity(kind: EntityPick['kind'], id: number): EntityPick {
  return { kind, id, point: new THREE.Vector3(), distance: 1 };
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

/** Press on the header at (0,0), move by (dx,dy), release. */
function dragBy(header: HTMLElement, dx: number, dy: number): void {
  ptr(header, 'pointerdown', { x: 0, y: 0 });
  ptr(header, 'pointermove', { x: dx, y: dy });
  ptr(header, 'pointerup', { x: dx, y: dy });
}

function pos(root: HTMLElement): { x: number; y: number } {
  return { x: parseFloat(root.style.left), y: parseFloat(root.style.top) };
}

function twoEmployees() {
  const state = createGame({ seed: 1, mineType: 'desert' });
  const a = hireEmployee(state.employees, 'driller', new Random(1)).employee;
  const b = hireEmployee(state.employees, 'driller', new Random(2)).employee;
  return { state, a, b };
}

afterEach(() => {
  setViewport(realInnerWidth, realInnerHeight);
  document.body.innerHTML = '';
});

describe('Inspector — dragging the header (#2137)', () => {
  it('has no inline left/top until dragged (default dock untouched)', () => {
    const { bar, root } = makeBar();
    const { state, a } = twoEmployees();
    bar.show(entity('employee', a.id), state);
    bar.update(state);
    expect(root.style.left).toBe('');
    expect(root.style.top).toBe('');
  });

  it('moves the window by the pointer delta from its docked position', () => {
    const { bar, root, header } = makeBar();
    const { state, a } = twoEmployees();
    bar.show(entity('employee', a.id), state);
    const dock = defaultInspectorPosition();
    dragBy(header, 60, 40);
    expect(root.style.left).toBe(`${dock.x + 60}px`);
    expect(root.style.top).toBe(`${dock.y + 40}px`);
  });

  it('follows the pointer during the drag, before release', () => {
    const { bar, root, header } = makeBar();
    const { state, a } = twoEmployees();
    bar.show(entity('employee', a.id), state);
    const dock = defaultInspectorPosition();
    ptr(header, 'pointerdown', { x: 5, y: 5 });
    ptr(header, 'pointermove', { x: 25, y: 35 });
    expect(pos(root)).toEqual({ x: dock.x + 20, y: dock.y + 30 });
    ptr(header, 'pointerup', { x: 25, y: 35 });
  });

  it('clamps inside the viewport and below the top bar', () => {
    setViewport(1000, 700);
    const { bar, root, header } = makeBar();
    const { state, a } = twoEmployees();
    bar.show(entity('employee', a.id), state);
    dragBy(header, -5000, -5000);
    expect(pos(root)).toEqual({ x: 0, y: TOPBAR_HEIGHT_PX });
    dragBy(header, 5000, 5000);
    expect(pos(root)).toEqual({ x: 1000 - WIN.width, y: 700 - WIN.height });
  });

  it('pins to x 0 and the top-bar line when the window is bigger than the viewport', () => {
    setViewport(300, 300);
    const { bar, root, header } = makeBar();
    const { state, a } = twoEmployees();
    bar.show(entity('employee', a.id), state);
    dragBy(header, 50, 50);
    expect(pos(root)).toEqual({ x: 0, y: TOPBAR_HEIGHT_PX });
  });

  it('does not drag from a pointerdown elsewhere than the header', () => {
    const { bar, root } = makeBar();
    const { state, a } = twoEmployees();
    bar.show(entity('employee', a.id), state);
    const body = root.children[2] as HTMLElement;
    ptr(body, 'pointerdown', { x: 0, y: 0 });
    ptr(body, 'pointermove', { x: 80, y: 80 });
    ptr(body, 'pointerup', { x: 80, y: 80 });
    expect(root.style.left).toBe('');
    expect(root.style.top).toBe('');
  });
});

describe('Inspector — header buttons still work', () => {
  it('a pointerdown on the close button starts no drag and the click still closes', () => {
    const { bar, root, header } = makeBar();
    const { state, a } = twoEmployees();
    const onClose = vi.fn();
    bar.setCloseHandler(onClose);
    bar.show(entity('employee', a.id), state);
    const close = header.querySelector<HTMLButtonElement>('[data-panel-close]')!;
    ptr(close, 'pointerdown', { x: 0, y: 0 });
    ptr(header, 'pointermove', { x: 90, y: 90 });
    ptr(close, 'pointerup', { x: 90, y: 90 });
    expect(root.style.left).toBe('');
    close.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(bar.open).toBe(false);
  });

  it('a pointerdown on the locate button starts no drag and the click still fires locate', () => {
    const { bar, root, header } = makeBar();
    const { state, a } = twoEmployees();
    const onAction = vi.fn();
    bar.setActionHandler(onAction);
    bar.show(entity('employee', a.id), state);
    const locate = header.querySelector<HTMLButtonElement>('[data-action="locate"]')!;
    ptr(locate, 'pointerdown', { x: 0, y: 0 });
    ptr(header, 'pointermove', { x: 90, y: 90 });
    ptr(locate, 'pointerup', { x: 90, y: 90 });
    expect(root.style.left).toBe('');
    locate.click();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]![0]).toBe('locate');
  });
});

describe('Inspector — a dragged position stays', () => {
  it('survives show() of another entity', () => {
    const { bar, root, header } = makeBar();
    const { state, a, b } = twoEmployees();
    bar.show(entity('employee', a.id), state);
    dragBy(header, 70, 30);
    const placed = pos(root);
    bar.show(entity('employee', b.id), state);
    expect(pos(root)).toEqual(placed);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');
    bar.show(entity('vehicle', vehicle.id), state);
    expect(pos(root)).toEqual(placed);
  });

  it('survives update() refreshes', () => {
    const { bar, root, header } = makeBar();
    const { state, a } = twoEmployees();
    bar.show(entity('employee', a.id), state);
    dragBy(header, 70, 30);
    const placed = pos(root);
    bar.update(state);
    bar.update(state);
    expect(pos(root)).toEqual(placed);
  });

  it('survives hide() then show() (close and reopen)', () => {
    const { bar, root, header } = makeBar();
    const { state, a } = twoEmployees();
    bar.show(entity('employee', a.id), state);
    dragBy(header, 70, 30);
    const placed = pos(root);
    bar.hide();
    expect(bar.open).toBe(false);
    bar.show(entity('employee', a.id), state);
    expect(bar.open).toBe(true);
    expect(pos(root)).toEqual(placed);
  });

  it('survives a close-button close and a reopen', () => {
    const { bar, root, header } = makeBar();
    const { state, a } = twoEmployees();
    bar.show(entity('employee', a.id), state);
    dragBy(header, 70, 30);
    const placed = pos(root);
    header.querySelector<HTMLButtonElement>('[data-panel-close]')!.click();
    bar.show(entity('employee', a.id), state);
    expect(pos(root)).toEqual(placed);
  });

  it('a second drag continues from the dragged position', () => {
    const { bar, root, header } = makeBar();
    const { state, a } = twoEmployees();
    bar.show(entity('employee', a.id), state);
    const dock = defaultInspectorPosition();
    dragBy(header, 20, 10);
    dragBy(header, 15, 25);
    expect(pos(root)).toEqual({ x: dock.x + 35, y: dock.y + 35 });
  });
});

describe('Inspector — keeps the dragged window on screen', () => {
  it('re-clamps on window resize', () => {
    setViewport(1200, 800);
    const { bar, root, header } = makeBar();
    const { state, a } = twoEmployees();
    bar.show(entity('employee', a.id), state);
    dragBy(header, 5000, 5000);
    expect(pos(root)).toEqual({ x: 1200 - WIN.width, y: 800 - WIN.height });
    setViewport(900, 600);
    window.dispatchEvent(new Event('resize'));
    expect(pos(root)).toEqual({ x: 900 - WIN.width, y: 600 - WIN.height });
  });

  it('re-clamps on show() when the viewport shrank without a resize event', () => {
    setViewport(1200, 800);
    const { bar, root, header } = makeBar();
    const { state, a, b } = twoEmployees();
    bar.show(entity('employee', a.id), state);
    dragBy(header, 5000, 5000);
    setViewport(800, 600);
    bar.show(entity('employee', b.id), state);
    expect(pos(root)).toEqual({ x: 800 - WIN.width, y: 600 - WIN.height });
  });

  it('a resize never gives a never-dragged window an inline position', () => {
    setViewport(1200, 800);
    const { bar, root } = makeBar();
    const { state, a } = twoEmployees();
    bar.show(entity('employee', a.id), state);
    setViewport(500, 400);
    window.dispatchEvent(new Event('resize'));
    bar.show(entity('employee', a.id), state);
    expect(root.style.left).toBe('');
    expect(root.style.top).toBe('');
  });

  it('stops reacting to resize after dispose', () => {
    setViewport(1200, 800);
    const { bar, root, header } = makeBar();
    const { state, a } = twoEmployees();
    bar.show(entity('employee', a.id), state);
    dragBy(header, 5000, 5000);
    const placed = pos(root);
    bar.dispose();
    setViewport(500, 400);
    window.dispatchEvent(new Event('resize'));
    expect(pos(root)).toEqual(placed);
  });
});

describe('Inspector — layout registry (C7)', () => {
  it('stays registered with the default docked envelope, also after a drag', () => {
    const { bar, header } = makeBar();
    const { state, a } = twoEmployees();
    bar.show(entity('employee', a.id), state);
    dragBy(header, 100, 100);
    const region = shellLayoutRegistry.list().find(r => r.id === 'inspector');
    expect(region).toBeDefined();
    expect(region!.layer).toBe('hud');
    const vp = { width: 1280, height: 720 };
    expect(region!.bounds(vp)).toEqual(inspectorBounds(vp));
    bar.dispose();
    expect(shellLayoutRegistry.has('inspector')).toBe(false);
  });
});
