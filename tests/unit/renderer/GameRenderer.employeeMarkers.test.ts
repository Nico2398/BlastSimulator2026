// BlastSimulator2026 — GameRenderer: every worker on the site carries a crew pin
//
// A hire is a ~10 x 24 px speck at the default framing, so the renderer pins a
// role-coloured marker above each worker mesh (EmployeeMarkers). The pin lives
// exactly as long as the mesh does: a mounted worker, drawn as his vehicle, has
// none, and the pin goes with the group when a level is rebuilt.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GameRenderer } from '../../../src/renderer/GameRenderer.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { makeMockSceneManager, makeCtx } from '../../helpers/rendererFixtures.js';

/** Sprites hanging under any employee group in the scene. */
function pinsUnderEmployees(scene: THREE.Scene): THREE.Sprite[] {
  const found: THREE.Sprite[] = [];
  scene.traverse(obj => {
    if (obj.userData['entityKind'] !== 'employee') return;
    obj.traverse(child => { if ((child as THREE.Sprite).isSprite) found.push(child as THREE.Sprite); });
  });
  return found;
}

describe('GameRenderer — crew pins', () => {
  it('pins one marker to every employee mesh after the first sync', () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = makeCtx();
    hireEmployee(ctx.state!.employees, 'surveyor', new Random(1), 16, 17);
    hireEmployee(ctx.state!.employees, 'driller', new Random(2), 18, 17);

    renderer.syncFromContext(ctx);

    expect(renderer.employeeMarkerCount).toBe(2);
    expect(pinsUnderEmployees(sm.scene)).toHaveLength(2);
  });

  it('a surveyor hired mid-game gets his pin on the next sync, not only at level load', () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = makeCtx();
    renderer.syncFromContext(ctx);
    expect(renderer.employeeMarkerCount).toBe(0);

    hireEmployee(ctx.state!.employees, 'surveyor', new Random(1), 16, 17);
    renderer.syncFromContext(ctx);

    expect(renderer.employeeMarkerCount).toBe(1);
    expect(pinsUnderEmployees(sm.scene)).toHaveLength(1);
  });

  it('keeps its size honest frame to frame: update() resizes the pin for the camera', () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = makeCtx();
    hireEmployee(ctx.state!.employees, 'surveyor', new Random(1), 16, 17);
    renderer.syncFromContext(ctx);
    const [pin] = pinsUnderEmployees(sm.scene);
    expect(pin!.scale.y).toBe(1); // a fresh sprite, never sized

    renderer.update(0.016);

    expect(pin!.scale.y).toBeGreaterThan(0);
    expect(pin!.scale.y).toBeLessThan(1);
  });

  it('rebuilding the level drops the old pins with the old meshes', () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = makeCtx();
    hireEmployee(ctx.state!.employees, 'surveyor', new Random(1), 16, 17);
    renderer.syncFromContext(ctx);
    expect(renderer.employeeMarkerCount).toBe(1);

    ctx.state!.employees.employees.length = 0;
    renderer.buildPlayableMesh(ctx);
    renderer.syncFromContext(ctx);

    expect(renderer.employeeMarkerCount).toBe(0);
    expect(pinsUnderEmployees(sm.scene)).toHaveLength(0);
  });
});
