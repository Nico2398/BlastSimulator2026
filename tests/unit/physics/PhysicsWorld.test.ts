import { describe, it, expect } from 'vitest';
import { PhysicsWorld } from '../../../src/physics/PhysicsWorld.js';

describe('PhysicsWorld (8.1)', () => {
  it('creating a physics world and stepping it does not crash', () => {
    const world = new PhysicsWorld();
    world.init();
    expect(() => world.step(1 / 60)).not.toThrow();
    world.clear();
  });

  it('adding a body and stepping — body falls due to gravity', () => {
    const world = new PhysicsWorld();
    world.init();

    const handle = world.addBody('sphere', [0.5, 0.5, 0.5], 1.0, { x: 0, y: 10, z: 0 });

    const before = world.getBodyPosition(handle)!;
    expect(before.y).toBeCloseTo(10, 1);

    // Step for 0.5 seconds — body should have fallen
    for (let i = 0; i < 30; i++) world.step(1 / 60);

    const after = world.getBodyPosition(handle)!;
    expect(after.y).toBeLessThan(before.y);

    world.clear();
  });

  it('clear() removes all bodies', () => {
    const world = new PhysicsWorld();
    world.init();

    world.addBody('box', [0.5, 0.5, 0.5], 1.0, { x: 0, y: 5, z: 0 });
    world.addBody('box', [0.5, 0.5, 0.5], 1.0, { x: 2, y: 5, z: 0 });
    expect(world.bodyCount).toBe(2);

    world.clear();
    expect(world.bodyCount).toBe(0);
  });

  it('static body (mass=0) does not fall', () => {
    const world = new PhysicsWorld();
    world.init();

    const handle = world.addBody('box', [2, 0.1, 2], 0, { x: 0, y: 0, z: 0 });

    for (let i = 0; i < 60; i++) world.step(1 / 60);

    const pos = world.getBodyPosition(handle)!;
    expect(pos.y).toBeCloseTo(0, 3); // Static — doesn't move

    world.clear();
  });

  it('body with initial upward velocity rises before falling', () => {
    const world = new PhysicsWorld();
    world.init();

    const handle = world.addBody(
      'sphere', [0.3, 0.3, 0.3], 1.0,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 10, z: 0 }, // Upward velocity
    );

    // After one step, y should have increased
    world.step(1 / 60);
    const pos1 = world.getBodyPosition(handle)!;
    expect(pos1.y).toBeGreaterThan(0);

    world.clear();
  });

  it('getBodyPosition returns null for unknown handle', () => {
    const world = new PhysicsWorld();
    world.init();
    expect(world.getBodyPosition({ id: 999 })).toBeNull();
    world.clear();
  });
});
