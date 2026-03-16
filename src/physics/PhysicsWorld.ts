// BlastSimulator2026 — Physics world wrapper (Cannon-es)
// Physics runs ONLY during blast events. Each blast creates a fresh world,
// simulates until fragments settle, then the world is discarded.
// Architecture: src/physics/ depends on src/core/ but never the reverse.

import * as CANNON from 'cannon-es';

// ── Config ──

/** Gravity (m/s²). Real Earth gravity = 9.81. */
const GRAVITY = -9.81;

/** Physics substeps per step call — more = more accurate but slower. */
const SUBSTEPS = 3;

// ── Types ──

export interface PhysicsBodyId {
  readonly id: number;
}

// ── PhysicsWorld ──

/**
 * Thin wrapper around a Cannon-es World.
 * Usage:
 *   const world = new PhysicsWorld();
 *   world.init();
 *   const bodyId = world.addBody(...)
 *   world.step(1/60);
 *   const pos = world.getBodyPosition(bodyId);
 *   world.clear();
 */
export class PhysicsWorld {
  private world: CANNON.World | null = null;
  private bodies = new Map<number, CANNON.Body>();
  private nextId = 1;

  /** Initialize the physics world with gravity. Call before any other method. */
  init(): void {
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, GRAVITY, 0),
    });

    // Broadphase: SAP is efficient for many moving bodies
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
  }

  /** Advance the simulation by dt seconds. */
  step(dt: number): void {
    if (!this.world) throw new Error('PhysicsWorld not initialized. Call init() first.');
    this.world.step(dt, dt, SUBSTEPS);
  }

  /**
   * Add a body to the world. Returns a handle for later retrieval.
   * @param shape - 'box' or 'sphere'
   * @param halfExtents - half-size for box, or [radius] for sphere
   * @param mass - 0 = static, > 0 = dynamic
   * @param position - initial position
   * @param velocity - initial linear velocity (optional)
   */
  addBody(
    shape: 'box' | 'sphere',
    halfExtents: [number, number, number],
    mass: number,
    position: { x: number; y: number; z: number },
    velocity?: { x: number; y: number; z: number },
  ): PhysicsBodyId {
    if (!this.world) throw new Error('PhysicsWorld not initialized.');

    const cannonShape = shape === 'sphere'
      ? new CANNON.Sphere(halfExtents[0])
      : new CANNON.Box(new CANNON.Vec3(...halfExtents));

    const body = new CANNON.Body({
      mass,
      shape: cannonShape,
      position: new CANNON.Vec3(position.x, position.y, position.z),
    });

    if (velocity) {
      body.velocity.set(velocity.x, velocity.y, velocity.z);
    }

    if (mass === 0) {
      body.type = CANNON.Body.STATIC;
    }

    this.world.addBody(body);
    const id = this.nextId++;
    this.bodies.set(id, body);
    return { id };
  }

  /** Remove a body from the world by its handle. */
  removeBody(handle: PhysicsBodyId): void {
    if (!this.world) return;
    const body = this.bodies.get(handle.id);
    if (body) {
      this.world.removeBody(body);
      this.bodies.delete(handle.id);
    }
  }

  /** Get the current position of a body. */
  getBodyPosition(handle: PhysicsBodyId): { x: number; y: number; z: number } | null {
    const body = this.bodies.get(handle.id);
    if (!body) return null;
    return { x: body.position.x, y: body.position.y, z: body.position.z };
  }

  /** Get the current velocity magnitude of a body. */
  getBodySpeed(handle: PhysicsBodyId): number {
    const body = this.bodies.get(handle.id);
    if (!body) return 0;
    return body.velocity.length();
  }

  /** Check if a body is sleeping (settled). */
  isBodySleeping(handle: PhysicsBodyId): boolean {
    const body = this.bodies.get(handle.id);
    if (!body) return true;
    return body.sleepState === CANNON.Body.SLEEPING;
  }

  /** Number of active bodies. */
  get bodyCount(): number {
    return this.bodies.size;
  }

  /**
   * Remove all bodies and destroy the world.
   * Call after blast simulation is complete.
   */
  clear(): void {
    if (!this.world) return;
    for (const body of this.bodies.values()) {
      this.world.removeBody(body);
    }
    this.bodies.clear();
    this.nextId = 1;
    this.world = null;
  }
}
