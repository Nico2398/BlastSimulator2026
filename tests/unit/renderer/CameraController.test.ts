// CameraController — pure-logic tests (no DOM, no Three.js renderer)
// We verify the math/constraints without needing a real canvas.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';

// Mock canvas element for CameraController
function makeMockCanvas() {
  const listeners: Record<string, EventListener[]> = {};
  return {
    addEventListener: (type: string, fn: EventListener) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type]!.push(fn);
    },
    removeEventListener: (type: string, fn: EventListener) => {
      if (listeners[type]) {
        listeners[type] = listeners[type]!.filter((l) => l !== fn);
      }
    },
    dispatchEvent: (_e: Event) => {},
    _listeners: listeners,
  };
}

// Import after mock setup
import { CameraController } from '../../../src/renderer/CameraController.js';

describe('CameraController', () => {
  let camera: THREE.PerspectiveCamera;
  let canvas: ReturnType<typeof makeMockCanvas>;
  let controller: CameraController;
  const target = new THREE.Vector3(50, 0, 50);

  beforeEach(() => {
    camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 4000);
    camera.position.set(50, 120, 180);
    camera.lookAt(target);
    canvas = makeMockCanvas();
    controller = new CameraController(camera, target.clone(), canvas as unknown as HTMLElement);
  });

  it('initialises camera position from existing camera state', () => {
    // Camera position should remain near original after construction
    expect(camera.position.y).toBeGreaterThan(0);
  });

  it('setTarget moves the orbit center', () => {
    controller.setTarget(10, 0, 10);
    // Camera should now look at new target
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    // The camera direction should point towards (10,0,10) from its position
    const toTarget = new THREE.Vector3(10, 0, 10).sub(camera.position).normalize();
    expect(dir.dot(toTarget)).toBeGreaterThan(0.9);
  });

  it('setMinHeight clamps camera above terrain', () => {
    controller.setMinHeight(50);
    // Camera y should be above 50
    expect(camera.position.y).toBeGreaterThan(50);
  });

  it('dispose removes all event listeners', () => {
    const countBefore = Object.values(canvas._listeners).reduce((acc, arr) => acc + arr.length, 0);
    expect(countBefore).toBeGreaterThan(0);
    controller.dispose();
    const countAfter = Object.values(canvas._listeners).reduce((acc, arr) => acc + arr.length, 0);
    expect(countAfter).toBe(0);
  });

  it('zoom limits are respected (ZOOM_MIN=5, ZOOM_MAX=600)', () => {
    // Simulate wheel events using plain objects (Node.js has no WheelEvent)
    const makeWheel = (deltaY: number) =>
      Object.assign(Object.create({ preventDefault: () => {} }), { deltaY });

    // Simulate many scroll-in events
    for (let i = 0; i < 500; i++) {
      canvas._listeners['wheel']?.forEach((fn) => fn(makeWheel(-1) as unknown as Event));
    }
    const distIn = camera.position.distanceTo(target);
    expect(distIn).toBeGreaterThanOrEqual(5);
    expect(distIn).toBeLessThanOrEqual(600);

    // Simulate many scroll-out events
    for (let i = 0; i < 500; i++) {
      canvas._listeners['wheel']?.forEach((fn) => fn(makeWheel(1) as unknown as Event));
    }
    const distOut = camera.position.distanceTo(target);
    expect(distOut).toBeGreaterThanOrEqual(5);
    expect(distOut).toBeLessThanOrEqual(600);
  });
});
