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
import { CameraController, pitchForHeight } from '../../../src/renderer/CameraController.js';

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

  it('keeps the view a sane distance away however far you scroll (#458 T6.1/D13)', () => {
    // Distance is now a consequence of height and its derived pitch rather
    // than the thing being scrolled, so this pins the resulting range.
    const makeWheel = (deltaY: number) =>
      Object.assign(Object.create({ preventDefault: () => {} }), { deltaY });

    for (let i = 0; i < 500; i++) {
      canvas._listeners['wheel']?.forEach((fn) => fn(makeWheel(-1) as unknown as Event));
    }
    const distIn = camera.position.distanceTo(new THREE.Vector3(camera.position.x, 0, camera.position.z));
    expect(distIn).toBeGreaterThanOrEqual(5);

    for (let i = 0; i < 1000; i++) {
      canvas._listeners['wheel']?.forEach((fn) => fn(makeWheel(1) as unknown as Event));
    }
    expect(controller.distance).toBeLessThanOrEqual(1200);
    expect(controller.distance).toBeGreaterThanOrEqual(5);
  });

  describe('frameSite', () => {
    it('centres on the site and pulls back proportionally to its span', () => {
      controller.frameSite(12, 4, 12, 24);
      const dist = camera.position.distanceTo(new THREE.Vector3(12, 4, 12));
      // 24-unit site: close enough to fill the frame, far enough to see it all.
      expect(dist).toBeGreaterThan(24);
      expect(dist).toBeLessThan(24 * 2);
    });

    it('frames a bigger site from further away', () => {
      controller.frameSite(12, 0, 12, 24);
      const near = camera.position.distanceTo(new THREE.Vector3(12, 0, 12));
      controller.frameSite(32, 0, 32, 64);
      const far = camera.position.distanceTo(new THREE.Vector3(32, 0, 32));
      expect(far).toBeGreaterThan(near);
    });

    it('looks at the new centre, not the previous one', () => {
      controller.frameSite(12, 4, 12, 24);
      // Camera sits above and away from the target on the XZ plane it orbits.
      expect(camera.position.y).toBeGreaterThan(4);
      const horizontal = Math.hypot(camera.position.x - 12, camera.position.z - 12);
      expect(horizontal).toBeGreaterThan(0);
    });

    it('becomes the new default so reset() returns to the framed site', () => {
      controller.frameSite(12, 4, 12, 24);
      const framed = camera.position.clone();
      controller.setTarget(0, 0, 0);
      controller.reset();
      expect(camera.position.distanceTo(framed)).toBeLessThan(0.001);
    });

    it('clamps the distance for a degenerate span', () => {
      controller.frameSite(0, 0, 0, 0);
      const dist = camera.position.length();
      expect(dist).toBeGreaterThan(0);
      expect(Number.isFinite(dist)).toBe(true);
    });
  });

  describe('height model', () => {
    const wheel = (deltaY: number) =>
      Object.assign(Object.create({ preventDefault: () => {} }), { deltaY });
    const scroll = (rig: ReturnType<typeof makeMockCanvas>, deltaY: number, times = 1) => {
      for (let i = 0; i < times; i++) {
        rig._listeners['wheel']?.forEach((fn) => fn(wheel(deltaY) as unknown as Event));
      }
    };
    /** Drag with the right button held — pan. Supports both axes. */
    const dragPan2D = (rig: ReturnType<typeof makeMockCanvas>, steps: number, stepX: number, stepY: number) => {
      const ev = (x: number, y: number, button = 2) =>
        Object.assign(Object.create({ preventDefault: () => {} }), { button, clientX: x, clientY: y });
      rig._listeners['mousedown']?.forEach((fn) => fn(ev(0, 0) as unknown as Event));
      for (let i = 1; i <= steps; i++) {
        rig._listeners['mousemove']?.forEach((fn) => fn(ev(i * stepX, i * stepY) as unknown as Event));
      }
      rig._listeners['mouseup']?.forEach((fn) => fn(ev(0, 0) as unknown as Event));
    };
    /** Where the camera's view axis meets the y=0 ground plane — i.e. what it is looking at. */
    const groundPointOf = (cam: THREE.PerspectiveCamera) => {
      const dir = new THREE.Vector3();
      cam.getWorldDirection(dir);
      return new THREE.Vector3().copy(cam.position).addScaledVector(dir, -cam.position.y / dir.y);
    };

    it('panning never lifts the view off its horizontal plane', () => {
      // The regression this model was built for: panning used to walk the
      // look-at point up the camera's tilted local up vector, a little on
      // every drag, with only X and Z leashed. The camera ended up stranded
      // in the sky with the ground unreachable.
      const yBefore = camera.position.y;
      const groundBefore = groundPointOf(camera).y;

      dragPan2D(canvas, 40, 12, 9);   // drag down-right, hard
      dragPan2D(canvas, 40, -9, -12); // and back up-left

      expect(camera.position.y).toBeCloseTo(yBefore, 6);
      expect(groundPointOf(camera).y).toBeCloseTo(groundBefore, 6);
    });

    it('scrolling changes camera height rather than orbit radius', () => {
      const before = controller.cameraHeight;
      scroll(canvas, -1, 5);
      expect(controller.cameraHeight).toBeLessThan(before);
      scroll(canvas, 1, 10);
      expect(controller.cameraHeight).toBeGreaterThan(before);
    });

    it('holds height between HEIGHT_MIN and HEIGHT_MAX however far you scroll', () => {
      scroll(canvas, -1, 500);
      expect(controller.cameraHeight).toBeGreaterThanOrEqual(6);
      expect(camera.position.y).toBeGreaterThan(0);

      scroll(canvas, 1, 1000);
      expect(controller.cameraHeight).toBeLessThanOrEqual(900);
      expect(Number.isFinite(camera.position.y)).toBe(true);
    });

    it('tilts toward top-down when high and toward the horizon when low', () => {
      scroll(canvas, 1, 400); // climb to the ceiling
      const high = pitchForHeight(controller.cameraHeight);
      scroll(canvas, -1, 400); // drop to the floor
      const low = pitchForHeight(controller.cameraHeight);

      expect(high).toBeGreaterThan(low);
      expect(THREE.MathUtils.radToDeg(high)).toBeGreaterThan(60); // reads as overhead
      expect(THREE.MathUtils.radToDeg(low)).toBeLessThan(30);     // reads as a ground-level view
    });

    it('zooming in flies forward along the view axis, not straight down', () => {
      const groundBefore = groundPointOf(camera);
      const heading = new THREE.Vector3();
      camera.getWorldDirection(heading);
      heading.y = 0;
      heading.normalize();

      scroll(canvas, -1, 6); // zoom in

      const groundAfter = groundPointOf(camera);
      const travel = groundAfter.clone().sub(groundBefore);
      expect(travel.length()).toBeGreaterThan(0.5);          // it really moved
      expect(travel.clone().normalize().dot(heading)).toBeGreaterThan(0.9); // and moved forward
    });

    it('zooming out retreats back along the same axis', () => {
      const heading = new THREE.Vector3();
      camera.getWorldDirection(heading);
      heading.y = 0;
      heading.normalize();

      const groundBefore = groundPointOf(camera);
      scroll(canvas, 1, 6); // zoom out
      const travel = groundPointOf(camera).clone().sub(groundBefore);

      expect(travel.length()).toBeGreaterThan(0.5);
      expect(travel.clone().normalize().dot(heading)).toBeLessThan(-0.9);
    });

    it('left-drag rotates around the target without changing height', () => {
      const heightBefore = controller.cameraHeight;
      const yBefore = camera.position.y;
      const ev = (x: number, button = 0) =>
        Object.assign(Object.create({ preventDefault: () => {} }), { button, clientX: x, clientY: 0 });
      canvas._listeners['mousedown']?.forEach((fn) => fn(ev(0) as unknown as Event));
      canvas._listeners['mousemove']?.forEach((fn) => fn(ev(120) as unknown as Event));
      canvas._listeners['mouseup']?.forEach((fn) => fn(ev(120) as unknown as Event));

      expect(controller.cameraHeight).toBeCloseTo(heightBefore, 6);
      expect(camera.position.y).toBeCloseTo(yBefore, 6);
    });

    it('a scripted setOrbit pitch survives until the player touches the camera', () => {
      controller.setOrbit(45, 80);
      const scripted = camera.position.clone();
      expect(scripted.y).toBeGreaterThan(0);

      scroll(canvas, -1, 1); // player input hands control back to the height model
      const pitchNow = Math.atan2(
        camera.position.y - 0,
        Math.hypot(camera.position.x - groundPointOf(camera).x, camera.position.z - groundPointOf(camera).z),
      );
      expect(pitchNow).toBeCloseTo(pitchForHeight(controller.cameraHeight), 4);
    });
  });

  describe('setPanLeash (#458 T6.1/D13)', () => {
    // A camera with zero X offset from its target (directly "north" of it,
    // not straight overhead — straight-down lookAt is a gimbal-lock edge
    // case) makes camera.position.x track target.x 1:1, so leash bounds can
    // be asserted directly against the camera position.
    function makeZeroXOffsetRig() {
      const localTarget = new THREE.Vector3(50, 0, 50);
      const localCamera = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 4000);
      localCamera.position.set(50, 150, 170);
      localCamera.lookAt(localTarget);
      const localCanvas = makeMockCanvas();
      const localController = new CameraController(localCamera, localTarget.clone(), localCanvas as unknown as HTMLElement);
      return { localCamera, localCanvas, localController };
    }

    function dragPan(canvasRig: ReturnType<typeof makeMockCanvas>, steps: number, stepPx: number) {
      const ev = (x: number, y: number, button = 2) =>
        Object.assign(Object.create({ preventDefault: () => {} }), { button, clientX: x, clientY: y });
      canvasRig._listeners['mousedown']?.forEach((fn) => fn(ev(0, 0) as unknown as Event));
      for (let i = 1; i <= steps; i++) {
        canvasRig._listeners['mousemove']?.forEach((fn) => fn(ev(i * stepPx, 0) as unknown as Event));
      }
      canvasRig._listeners['mouseup']?.forEach((fn) => fn(ev(0, 0) as unknown as Event));
    }

    it('clamps manual panning to the playable rect plus margin', () => {
      const { localCamera, localCanvas, localController } = makeZeroXOffsetRig();
      localController.setPanLeash({ minX: 0, minZ: 0, maxX: 100, maxZ: 100 }, 20);

      // Sign convention verified empirically: positive dx pans toward -X.
      dragPan(localCanvas, 50, 500); // drag hard toward -X, far past the leash
      expect(localCamera.position.x).toBeGreaterThanOrEqual(-20);

      dragPan(localCanvas, 50, -500); // drag hard toward +X, far past the leash
      expect(localCamera.position.x).toBeLessThanOrEqual(120);
    });

    it('clearing the leash (null) removes the bound', () => {
      const { localCamera, localCanvas, localController } = makeZeroXOffsetRig();
      localController.setPanLeash({ minX: 0, minZ: 0, maxX: 100, maxZ: 100 }, 20);
      localController.setPanLeash(null, 20);

      dragPan(localCanvas, 50, 500); // pans toward -X, unbounded without the leash
      expect(localCamera.position.x).toBeLessThan(-20);
    });

    it('does not constrain focus() or frameSite() — only manual panning', () => {
      const { localCamera, localController } = makeZeroXOffsetRig();
      localController.setPanLeash({ minX: 0, minZ: 0, maxX: 100, maxZ: 100 }, 20);

      localController.frameSite(500, 0, 500, 50);
      expect(localCamera.position.x).toBeGreaterThan(120);

      localController.focus(800, 0, 800, 30);
      expect(localCamera.position.x).toBeGreaterThan(120);
    });
  });
});
