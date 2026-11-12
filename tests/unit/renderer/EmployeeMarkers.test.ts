// EmployeeMarkers — unit tests
// A hired worker is a ~10 x 24 px speck at the default framing (camera distance =
// site span x 1.15), and on a big level a sub-pixel one: the crew has to stay
// findable at any zoom. Each worker carries a role-coloured pin whose on-screen
// size is a fixed fraction of the viewport height, fading out once the worker
// himself fills enough of the screen to be seen. The fixtures mirror
// EmployeePictograms.test.ts: a plain anchor group per employee, a perspective
// camera, no DOM (Node has no canvas, so the pin falls back to a flat colour).

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EmployeeMarkers, MARKER_VIEWPORT_FRACTION } from '../../../src/renderer/EmployeeMarkers.js';
import { ROLE_COLORS } from '../../../src/renderer/CharacterMesh.js';
import { OVERLAY_Y_KEY, overlayHeight } from '../../../src/renderer/TaskProgressBar.js';
import type { EmployeeRole } from '../../../src/core/entities/Employee.js';

/** The crew's own envelope: a worker's overlay height, as CharacterMesh stamps it on the anchor. */
const OVERLAY_Y = 1.8;
const FOV = 55;

function makeCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(FOV, 16 / 9, 0.5, 4000);
}

/** An employee anchor at the origin, stamped the way CharacterMesh stamps its groups. */
function makeAnchor(scene: THREE.Scene): THREE.Group {
  const anchor = new THREE.Group();
  anchor.userData[OVERLAY_Y_KEY] = OVERLAY_Y;
  scene.add(anchor);
  return anchor;
}

/** Put the camera `distance` metres from the origin and look at it. */
function aim(camera: THREE.PerspectiveCamera, distance: number): void {
  camera.position.set(0, distance * 0.7071, distance * 0.7071);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
}

/** What the pin's quad covers on screen, as a fraction of the viewport's height. */
function onScreenFraction(pin: THREE.Sprite, camera: THREE.Camera): number {
  // A sprite with sizeAttenuation off is scaled by its view depth in the shader, so its projected
  // height is scale.y * P[1][1] in NDC (the viewport spans 2 NDC units).
  expect((pin.material as THREE.SpriteMaterial).sizeAttenuation).toBe(false);
  return (pin.scale.y * camera.projectionMatrix.elements[5]!) / 2;
}

function crew(...roles: EmployeeRole[]): { id: number; role: EmployeeRole }[] {
  return roles.map((role, i) => ({ id: i + 1, role }));
}

describe('EmployeeMarkers — one pin per rendered worker', () => {
  it('gives every employee that has a mesh one pin, parented to its anchor above its overlay height', () => {
    const scene = new THREE.Scene();
    const markers = new EmployeeMarkers(makeCamera());
    const a = makeAnchor(scene);
    const b = makeAnchor(scene);

    markers.sync(crew('surveyor', 'driller'), id => (id === 1 ? a : b));

    expect(markers.count).toBe(2);
    const pin = markers.pinOf(1)!;
    expect(pin.parent).toBe(a);
    expect(markers.pinOf(2)!.parent).toBe(b);
    expect(pin.position.y).toBeGreaterThan(overlayHeight(a));
    markers.dispose();
  });

  it('syncing again adds nothing: the same pin keeps serving the same employee', () => {
    const scene = new THREE.Scene();
    const markers = new EmployeeMarkers(makeCamera());
    const anchor = makeAnchor(scene);

    markers.sync(crew('surveyor'), () => anchor);
    const first = markers.pinOf(1);
    markers.sync(crew('surveyor'), () => anchor);

    expect(markers.count).toBe(1);
    expect(markers.pinOf(1)).toBe(first);
    expect(anchor.children).toHaveLength(1);
    markers.dispose();
  });

  it('an employee without a mesh (riding a vehicle, inside a building) has no pin', () => {
    const scene = new THREE.Scene();
    const markers = new EmployeeMarkers(makeCamera());
    const anchor = makeAnchor(scene);
    markers.sync(crew('driver'), () => anchor);
    expect(markers.count).toBe(1);

    markers.sync(crew('driver'), () => null);

    expect(markers.count).toBe(0);
    expect(anchor.children).toHaveLength(0);
    markers.dispose();
  });

  it('an employee who left the roster loses the pin; the others keep theirs', () => {
    const scene = new THREE.Scene();
    const markers = new EmployeeMarkers(makeCamera());
    const anchor = makeAnchor(scene);
    markers.sync(crew('surveyor', 'blaster'), () => anchor);

    markers.sync([{ id: 2, role: 'blaster' }], () => anchor);

    expect(markers.count).toBe(1);
    expect(markers.pinOf(1)).toBeNull();
    expect(markers.pinOf(2)).not.toBeNull();
    markers.dispose();
  });

  it('follows the employee onto a new mesh (the old group was removed, a new one added)', () => {
    const scene = new THREE.Scene();
    const markers = new EmployeeMarkers(makeCamera());
    const oldAnchor = makeAnchor(scene);
    const newAnchor = makeAnchor(scene);
    markers.sync(crew('surveyor'), () => oldAnchor);

    markers.sync(crew('surveyor'), () => newAnchor);

    expect(markers.pinOf(1)!.parent).toBe(newAnchor);
    expect(oldAnchor.children).toHaveLength(0);
    markers.dispose();
  });

  it('colours each pin by role, the same hue as the worker and the Crew panel avatar', () => {
    const scene = new THREE.Scene();
    const markers = new EmployeeMarkers(makeCamera());
    const roles: EmployeeRole[] = ['driller', 'blaster', 'driver', 'surveyor', 'manager'];
    markers.sync(crew(...roles), () => makeAnchor(scene));

    roles.forEach((role, i) => {
      const material = markers.pinOf(i + 1)!.material as THREE.SpriteMaterial;
      // No canvas in this environment: the flat-colour fallback carries the role colour itself.
      expect(material.map).toBeNull();
      expect(material.color.getHex()).toBe(ROLE_COLORS[role]);
    });
    markers.dispose();
  });

  it('a pin is a pure marker: it never intercepts a pick and never needs the raycaster camera', () => {
    const scene = new THREE.Scene();
    const markers = new EmployeeMarkers(makeCamera());
    markers.sync(crew('surveyor'), () => makeAnchor(scene));
    const hits: THREE.Intersection[] = [];

    expect(() => markers.pinOf(1)!.raycast(new THREE.Raycaster(), hits)).not.toThrow();
    expect(hits).toEqual([]);
    markers.dispose();
  });

  it('drops every pin and releases the materials on clearAll', () => {
    const scene = new THREE.Scene();
    const markers = new EmployeeMarkers(makeCamera());
    const anchor = makeAnchor(scene);
    markers.sync(crew('surveyor', 'driller'), () => anchor);

    markers.clearAll();

    expect(markers.count).toBe(0);
    expect(anchor.children).toHaveLength(0);
    expect(() => markers.dispose()).not.toThrow();
  });
});

describe('EmployeeMarkers — the same size on screen at every zoom', () => {
  it('covers the same fraction of the viewport whatever the camera distance', () => {
    const scene = new THREE.Scene();
    const camera = makeCamera();
    const markers = new EmployeeMarkers(camera);
    markers.sync(crew('surveyor'), () => makeAnchor(scene));
    const pin = markers.pinOf(1)!;

    for (const distance of [20, 37, 184, 1200]) {
      aim(camera, distance);
      markers.update();
      expect(onScreenFraction(pin, camera)).toBeCloseTo(MARKER_VIEWPORT_FRACTION, 6);
    }
    markers.dispose();
  });

  it('keeps that fraction when the field of view changes', () => {
    const scene = new THREE.Scene();
    const camera = makeCamera();
    const markers = new EmployeeMarkers(camera);
    markers.sync(crew('surveyor'), () => makeAnchor(scene));
    aim(camera, 40);

    camera.fov = 90;
    camera.updateProjectionMatrix();
    markers.update();

    expect(onScreenFraction(markers.pinOf(1)!, camera)).toBeCloseTo(MARKER_VIEWPORT_FRACTION, 6);
    markers.dispose();
  });

  it('is visible and opaque at the default framing of a small site, where the worker is a speck', () => {
    const scene = new THREE.Scene();
    const camera = makeCamera();
    const markers = new EmployeeMarkers(camera);
    markers.sync(crew('surveyor'), () => makeAnchor(scene));
    aim(camera, 36.8); // a 32-tile site: span x 1.15

    markers.update();

    const pin = markers.pinOf(1)!;
    expect(pin.visible).toBe(true);
    expect((pin.material as THREE.SpriteMaterial).opacity).toBe(1);
    markers.dispose();
  });

  it('is visible on the largest level too, where the worker is under a pixel', () => {
    const scene = new THREE.Scene();
    const camera = makeCamera();
    const markers = new EmployeeMarkers(camera);
    markers.sync(crew('surveyor'), () => makeAnchor(scene));
    aim(camera, 184); // a 160-tile site

    markers.update();

    expect(markers.pinOf(1)!.visible).toBe(true);
    expect((markers.pinOf(1)!.material as THREE.SpriteMaterial).opacity).toBe(1);
    markers.dispose();
  });

  it('fades out as the worker fills the screen, and is gone in a close-up', () => {
    const scene = new THREE.Scene();
    const camera = makeCamera();
    const markers = new EmployeeMarkers(camera);
    markers.sync(crew('surveyor'), () => makeAnchor(scene));
    const pin = markers.pinOf(1)!;
    const opacityAt = (distance: number): number => {
      aim(camera, distance);
      markers.update();
      return (pin.material as THREE.SpriteMaterial).opacity;
    };

    const far = opacityAt(40);
    const mid = opacityAt(10);
    const closer = opacityAt(8.5);
    const close = opacityAt(4);

    expect(far).toBe(1);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(closer).toBeLessThan(mid);
    expect(close).toBe(0);
    expect(pin.visible).toBe(false);
  });

  it('comes back when the camera pulls out again', () => {
    const scene = new THREE.Scene();
    const camera = makeCamera();
    const markers = new EmployeeMarkers(camera);
    markers.sync(crew('surveyor'), () => makeAnchor(scene));
    aim(camera, 4);
    markers.update();
    expect(markers.pinOf(1)!.visible).toBe(false);

    aim(camera, 40);
    markers.update();

    expect(markers.pinOf(1)!.visible).toBe(true);
    markers.dispose();
  });

  it('draws over the terrain and the other overlays, like the task bars', () => {
    const scene = new THREE.Scene();
    const markers = new EmployeeMarkers(makeCamera());
    markers.sync(crew('surveyor'), () => makeAnchor(scene));
    const pin = markers.pinOf(1)!;
    const material = pin.material as THREE.SpriteMaterial;

    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
    expect(pin.renderOrder).toBeGreaterThanOrEqual(999);
    markers.dispose();
  });

  // The game loop runs update() first and then the tick, whose sync adds the meshes of workers stepping
  // out of a vehicle or building; the frame is drawn right after. A pin left at the default sprite scale
  // (1) would cover ~96% of the viewport for that frame under sizeAttenuation false.
  it('sizes a pin the moment it is synced, before any update() has run', () => {
    const scene = new THREE.Scene();
    const camera = makeCamera();
    const markers = new EmployeeMarkers(camera);
    aim(camera, 36.8);

    markers.sync(crew('surveyor'), () => makeAnchor(scene));

    const pin = markers.pinOf(1)!;
    expect(onScreenFraction(pin, camera)).toBeCloseTo(MARKER_VIEWPORT_FRACTION, 6);
    expect(pin.visible).toBe(true);
    expect((pin.material as THREE.SpriteMaterial).opacity).toBe(1);
    markers.dispose();
  });

  it('a pin synced into a close-up is already faded out, not shown for a frame', () => {
    const scene = new THREE.Scene();
    const camera = makeCamera();
    const markers = new EmployeeMarkers(camera);
    aim(camera, 4);

    markers.sync(crew('surveyor'), () => makeAnchor(scene));

    const pin = markers.pinOf(1)!;
    expect(pin.visible).toBe(false);
    expect((pin.material as THREE.SpriteMaterial).opacity).toBe(0);
    markers.dispose();
  });

  it('keeps a pin it cannot size hidden, rather than drawing it at the default sprite scale', () => {
    const scene = new THREE.Scene();
    const camera = makeCamera();
    camera.projectionMatrix.elements[5] = 0; // a degenerate projection: no usable field of view
    const markers = new EmployeeMarkers(camera);

    markers.sync(crew('surveyor'), () => makeAnchor(scene));

    expect(markers.pinOf(1)!.visible).toBe(false);
    markers.dispose();
  });

  it('a pin that follows its worker onto a new mesh is fitted again on arrival', () => {
    const scene = new THREE.Scene();
    const camera = makeCamera();
    const markers = new EmployeeMarkers(camera);
    const oldAnchor = makeAnchor(scene);
    const newAnchor = makeAnchor(scene);
    aim(camera, 36.8);
    markers.sync(crew('surveyor'), () => oldAnchor);
    aim(camera, 4); // the camera moved in between: the worker is now seen in a close-up

    markers.sync(crew('surveyor'), () => newAnchor);

    expect(markers.pinOf(1)!.visible).toBe(false);
    markers.dispose();
  });

  it('update() before any sync is a no-op', () => {
    const markers = new EmployeeMarkers(makeCamera());
    expect(() => markers.update()).not.toThrow();
  });
});
