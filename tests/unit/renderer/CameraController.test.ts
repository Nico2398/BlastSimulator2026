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

  it('keeps the orbit distance within its limits however far you scroll (#458 T6.1/D13)', () => {
    // Simulate wheel events using plain objects (Node.js has no WheelEvent)
    const makeWheel = (deltaY: number) =>
      Object.assign(Object.create({ preventDefault: () => {} }), { deltaY });

    for (let i = 0; i < 500; i++) {
      canvas._listeners['wheel']?.forEach((fn) => fn(makeWheel(-1) as unknown as Event));
    }
    const distIn = camera.position.distanceTo(target);
    expect(distIn).toBeGreaterThanOrEqual(5);
    expect(distIn).toBeLessThanOrEqual(1200);

    for (let i = 0; i < 1000; i++) {
      canvas._listeners['wheel']?.forEach((fn) => fn(makeWheel(1) as unknown as Event));
    }
    const distOut = camera.position.distanceTo(target);
    expect(distOut).toBeGreaterThanOrEqual(5);
    expect(distOut).toBeLessThanOrEqual(1200);
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

  describe('orbit model — orientation and zoom are independent', () => {
    const wheel = (deltaY: number) =>
      Object.assign(Object.create({ preventDefault: () => {} }), { deltaY });
    const scroll = (rig: ReturnType<typeof makeMockCanvas>, deltaY: number, times = 1) => {
      for (let i = 0; i < times; i++) {
        rig._listeners['wheel']?.forEach((fn) => fn(wheel(deltaY) as unknown as Event));
      }
    };
    /** Drag with a button held. Button 0 orbits, button 2 pans. */
    const drag = (
      rig: ReturnType<typeof makeMockCanvas>,
      button: number, steps: number, stepX: number, stepY: number,
    ) => {
      const ev = (x: number, y: number) =>
        Object.assign(Object.create({ preventDefault: () => {} }), { button, clientX: x, clientY: y });
      rig._listeners['mousedown']?.forEach((fn) => fn(ev(0, 0) as unknown as Event));
      for (let i = 1; i <= steps; i++) {
        rig._listeners['mousemove']?.forEach((fn) => fn(ev(i * stepX, i * stepY) as unknown as Event));
      }
      rig._listeners['mouseup']?.forEach((fn) => fn(ev(0, 0) as unknown as Event));
    };
    /** Pitch above the horizon, in degrees, derived from the camera's placement. */
    const pitchDeg = (cam: THREE.PerspectiveCamera, tgt: THREE.Vector3) => {
      const o = cam.position.clone().sub(tgt);
      return THREE.MathUtils.radToDeg(Math.atan2(o.y, Math.hypot(o.x, o.z)));
    };
    /** Yaw around the vertical axis, in degrees. */
    const yawDeg = (cam: THREE.PerspectiveCamera, tgt: THREE.Vector3) => {
      const o = cam.position.clone().sub(tgt);
      return THREE.MathUtils.radToDeg(Math.atan2(o.x, o.z));
    };

    it('left-drag sideways swings the camera around the target', () => {
      const before = yawDeg(camera, target);
      const radiusBefore = controller.distance;
      drag(canvas, 0, 10, 12, 0);
      expect(yawDeg(camera, target)).not.toBeCloseTo(before, 2);
      expect(controller.distance).toBeCloseTo(radiusBefore, 5); // orbit, not dolly
    });

    it('left-drag vertically tilts the camera — pitch is dragged, not derived', () => {
      const before = pitchDeg(camera, target);
      drag(canvas, 0, 10, 0, 8);
      const after = pitchDeg(camera, target);
      expect(after).not.toBeCloseTo(before, 2);
      // Dragging down raises the camera toward top-down.
      expect(after).toBeGreaterThan(before);
    });

    it('holds its pitch across a full zoom in and out', () => {
      drag(canvas, 0, 8, 0, 6); // pick a deliberate angle
      const chosen = pitchDeg(camera, target);

      scroll(canvas, -1, 12);
      expect(pitchDeg(camera, target)).toBeCloseTo(chosen, 4);
      scroll(canvas, 1, 20);
      expect(pitchDeg(camera, target)).toBeCloseTo(chosen, 4);
    });

    it('holds its yaw across a full zoom in and out', () => {
      drag(canvas, 0, 8, 15, 0);
      const chosen = yawDeg(camera, target);

      scroll(canvas, -1, 12);
      expect(yawDeg(camera, target)).toBeCloseTo(chosen, 4);
      scroll(canvas, 1, 20);
      expect(yawDeg(camera, target)).toBeCloseTo(chosen, 4);
    });

    it('zooming moves along the line to the target and leaves the target where it is', () => {
      const before = controller.distance;
      // Where the view meets the ground plane — the point being orbited.
      const groundPoint = () => {
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        return new THREE.Vector3().copy(camera.position).addScaledVector(dir, -camera.position.y / dir.y);
      };
      const aimBefore = groundPoint();

      scroll(canvas, -1, 5);
      expect(controller.distance).toBeLessThan(before);
      const aimAfter = groundPoint();
      // No forward creep: zoom closes on the same point, it does not fly past it.
      expect(aimAfter.distanceTo(aimBefore)).toBeLessThan(0.01);
    });

    it('scrolling out then back in returns to the same distance', () => {
      const before = controller.distance;
      scroll(canvas, 1, 6);
      expect(controller.distance).toBeGreaterThan(before);
      scroll(canvas, -1, 6);
      expect(controller.distance).toBeCloseTo(before, 6);
    });

    it('clamps pitch short of straight down and of the horizon', () => {
      drag(canvas, 0, 60, 0, 40); // hard toward top-down
      expect(pitchDeg(camera, target)).toBeLessThanOrEqual(90);
      expect(camera.position.y).toBeGreaterThan(target.y);

      drag(canvas, 0, 60, 0, -40); // hard toward the horizon
      expect(pitchDeg(camera, target)).toBeGreaterThan(0); // never dips under the target
    });

    it('panning never lifts the view off its horizontal plane', () => {
      // The regression this pan model was built for: panning used to walk the
      // look-at point up the camera's tilted local up vector, a little on
      // every drag, with only X and Z leashed. The camera ended up stranded
      // in the sky with the ground unreachable.
      const groundPoint = () => {
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        return new THREE.Vector3().copy(camera.position).addScaledVector(dir, -camera.position.y / dir.y);
      };
      const yBefore = camera.position.y;
      const aimYBefore = groundPoint().y;

      drag(canvas, 2, 40, 12, 9);   // drag down-right, hard
      drag(canvas, 2, 40, -9, -12); // and back up-left

      expect(camera.position.y).toBeCloseTo(yBefore, 6);
      expect(groundPoint().y).toBeCloseTo(aimYBefore, 6);
    });

    it('setOrbit places an exact angle for scripted shots and zoom leaves it alone', () => {
      controller.setOrbit(45, 30);
      expect(yawDeg(camera, target)).toBeCloseTo(45, 3);
      expect(pitchDeg(camera, target)).toBeCloseTo(30, 3);

      scroll(canvas, -1, 4);
      expect(yawDeg(camera, target)).toBeCloseTo(45, 3);
      expect(pitchDeg(camera, target)).toBeCloseTo(30, 3);
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
