// BlastSimulator2026 — Character Meshes
// Each employee is a worker minion from the model library (one .glb per
// role, built in assets/models/blender/workers.py). The role colour tints
// the overalls and hard hat; injured workers go dark red; dead are removed.
// Workers turn to face where they walk and waddle while moving — legs and
// arms swing on the model's own pivot nodes, no skeleton needed.

import * as THREE from 'three';
import type { Employee, EmployeeRole } from '../core/entities/Employee.js';
import { tagPickable } from './Pickable.js';
import { applyEasedPosition, createTween, type MovementTween } from './MovementInterpolation.js';
import { headingFromDelta, turnToward } from './Heading.js';
import { modelLibrary, type ModelInstance, type ModelLibrary } from './models/ModelLibrary.js';
import { workerModelId } from './models/ModelIds.js';

// ---------- Role colors (bright, distinct) ----------
// Exported for the Crew panel's roster avatars (redesign P6) — same hue as
// the in-scene character mesh, so a player can match a card to its worker.
export const ROLE_COLORS: Record<EmployeeRole, number> = {
  driller:  0x2266ff, // blue
  blaster:  0xff4422, // red-orange
  driver:   0xffcc00, // yellow
  surveyor: 0x22cc88, // teal
  manager:  0xaa55dd, // purple
};

// ---------- Status overrides ----------
const INJURED_COLOR  = 0x993333; // dark red
const EVACUATING_BLINK_RATE = 3; // blinks per second when evacuating (visual hint)

/** Material every worker model exposes for its overalls and hat. */
export const ROLE_TINT = 'TintRole';
/** Stand-in box while the worker asset is not loaded: roughly a minion's envelope. */
const FALLBACK_SIZE = [0.55, 1.2, 0.55] as const;

// ---------- Walk cycle ----------
/** Below this ground speed (m/s) a worker stands still. */
const WALK_SPEED_MIN = 0.05;
/** Strides per second. */
const WALK_CYCLE_HZ = 2.4;
/** Leg / arm swing amplitude (radians) at full stride. */
const LEG_SWING = 0.6;
const ARM_SWING = 0.5;
/** Body bounce per stride (m) and head wobble (radians). */
const BOB_HEIGHT = 0.035;
const HEAD_WOBBLE = 0.08;
/** How fast the gait blends in/out (per second) and how fast a worker turns (rad/s). */
const STRIDE_BLEND_RATE = 6;
const TURN_RATE = 9;

interface WorkerNodes {
  head: THREE.Object3D | null;
  armL: THREE.Object3D | null;
  armR: THREE.Object3D | null;
  legL: THREE.Object3D | null;
  legR: THREE.Object3D | null;
}

interface CharacterEntry {
  group: THREE.Group;
  instance: ModelInstance;
  nodes: WorkerNodes;
  employee: Employee;
  evacuating: boolean;
  tween: MovementTween;
  /** Walk-cycle phase (radians) and how much of the gait is blended in (0..1). */
  phase: number;
  stride: number;
}

// ---------- Main class ----------

export class CharacterMesh {
  private readonly scene: THREE.Scene;
  private readonly library: ModelLibrary;
  private readonly characters = new Map<number, CharacterEntry>();
  private time = 0;

  constructor(scene: THREE.Scene, library: ModelLibrary = modelLibrary) {
    this.scene = scene;
    this.library = library;
  }

  addEmployee(employee: Employee, surfaceY: number = 0): void {
    const group = new THREE.Group();
    const { instance, nodes } = this.attachModel(group, employee);
    group.position.set(employee.x, surfaceY, employee.z);
    tagPickable(group, 'employee', employee.id);
    this.scene.add(group);
    this.characters.set(employee.id, {
      group, instance, nodes, employee, evacuating: false,
      tween: createTween(employee.x, employee.z),
      phase: 0, stride: 0,
    });
  }

  /**
   * Update all characters' positions and states.
   * @param employees - Current employee list from GameState
   * @param dt - Elapsed seconds since last call (for animation)
   * @param heightAt - Optional terrain height sampler, called with the same
   *   eased (x, z) the tween produces so a character's Y follows the slope
   *   under its feet every frame instead of the last synced cell (#1038).
   */
  update(employees: Employee[], dt: number, heightAt?: (x: number, z: number) => number): void {
    this.time += dt;

    for (const emp of employees) {
      const entry = this.characters.get(emp.id);
      if (!entry) continue;

      entry.employee = emp;

      // Ease toward work position (duration-aware tween, #520)
      const fromX = entry.group.position.x;
      const fromZ = entry.group.position.z;
      const eased = applyEasedPosition(entry.group.position, entry.tween, fromX, fromZ, emp.x, emp.z, dt, heightAt);
      this.animateGait(entry, eased.x - fromX, eased.z - fromZ, dt);

      // Body colour for injury state
      const roleColor = ROLE_COLORS[emp.role];
      const targetColor = emp.injured ? INJURED_COLOR : roleColor;
      entry.instance.tints.get(ROLE_TINT)?.color.setHex(targetColor);

      // Blink when evacuating (alpha toggling is expensive; use scale instead)
      if (entry.evacuating) {
        const blink = Math.sin(this.time * Math.PI * 2 * EVACUATING_BLINK_RATE) > 0;
        entry.group.visible = blink;
      } else {
        entry.group.visible = true;
      }
    }
  }

  /**
   * Snap a character to an exact position (e.g. after terrain rebuild repositions surface).
   * Unlike the tween-based update(), this sets the position immediately.
   */
  snapPosition(id: number, x: number, y: number, z: number): void {
    const entry = this.characters.get(id);
    if (entry) {
      entry.group.position.set(x, y, z);
      entry.tween = createTween(x, z);
    }
  }

  /**
   * Correct a character's terrain-surface Y immediately, leaving x/z motion
   * to the eased tween (#520 — GameRenderer.syncFromContext() should no
   * longer hard-snap x/z every sync).
   */
  setSurfaceY(id: number, y: number): void {
    const entry = this.characters.get(id);
    if (entry) {
      entry.group.position.y = y;
    }
  }

  /**
   * Mark a character as evacuating (will blink to indicate urgency).
   */
  setEvacuating(employeeId: number, evacuating: boolean): void {
    const entry = this.characters.get(employeeId);
    if (entry) {
      entry.evacuating = evacuating;
      if (!evacuating) entry.group.visible = true;
    }
  }

  removeEmployee(id: number): void {
    const entry = this.characters.get(id);
    if (entry) {
      this.scene.remove(entry.group);
      entry.instance.dispose();
      this.characters.delete(id);
    }
  }

  clearAll(): void {
    for (const { group, instance } of this.characters.values()) {
      this.scene.remove(group);
      instance.dispose();
    }
    this.characters.clear();
  }

  /**
   * Swap any stand-in box for the real model once its asset has loaded —
   * a level entered before the preload finished catches up here.
   */
  refreshModels(): void {
    for (const entry of this.characters.values()) {
      if (!entry.instance.isFallback || !this.library.has(workerModelId(entry.employee.role))) continue;
      entry.group.remove(entry.instance.root);
      entry.instance.dispose();
      const { instance, nodes } = this.attachModel(entry.group, entry.employee);
      entry.instance = instance;
      entry.nodes = nodes;
    }
  }

  get count(): number {
    return this.characters.size;
  }

  /** Root objects raycastable for scene picking — one Group per employee, tagged in addEmployee(). */
  pickables(): THREE.Object3D[] {
    return Array.from(this.characters.values(), e => e.group);
  }

  /** Current world-space position of an employee's root Group, or null if it isn't rendered. */
  getPosition(id: number): THREE.Vector3 | null {
    return this.characters.get(id)?.group.position.clone() ?? null;
  }

  /** An employee's root Group, or null if it isn't rendered — anchor for billboarded overlays (#546). */
  getGroup(id: number): THREE.Group | null {
    return this.characters.get(id)?.group ?? null;
  }

  /** The model instance drawn for an employee, or null — exposes tint materials and nodes to tests and overlays. */
  getInstance(id: number): ModelInstance | null {
    return this.characters.get(id)?.instance ?? null;
  }

  dispose(): void {
    this.clearAll();
  }

  private attachModel(group: THREE.Group, employee: Employee): { instance: ModelInstance; nodes: WorkerNodes } {
    const instance = this.library.instantiate(workerModelId(employee.role), { size: FALLBACK_SIZE, tint: ROLE_TINT });
    const color = employee.injured ? INJURED_COLOR : ROLE_COLORS[employee.role];
    instance.tints.get(ROLE_TINT)?.color.setHex(color);
    group.add(instance.root);
    const nodes: WorkerNodes = {
      head: instance.node('Head'),
      armL: instance.node('ArmL'),
      armR: instance.node('ArmR'),
      legL: instance.node('LegL'),
      legR: instance.node('LegR'),
    };
    return { instance, nodes };
  }

  /** Face the direction of travel and swing limbs while moving; settle back to rest when still. */
  private animateGait(entry: CharacterEntry, dx: number, dz: number, dt: number): void {
    if (dt <= 0) return;
    const speed = Math.hypot(dx, dz) / dt;
    const moving = speed > WALK_SPEED_MIN;
    if (moving) {
      entry.group.rotation.y = turnToward(entry.group.rotation.y, headingFromDelta(dx, dz), TURN_RATE * dt);
      entry.phase += dt * WALK_CYCLE_HZ * Math.PI * 2;
    }
    const target = moving ? 1 : 0;
    entry.stride += Math.sign(target - entry.stride) * Math.min(Math.abs(target - entry.stride), STRIDE_BLEND_RATE * dt);
    if (!moving && entry.stride === 0) entry.phase = 0;

    const swing = Math.sin(entry.phase) * entry.stride;
    const { head, armL, armR, legL, legR } = entry.nodes;
    // Legs swing forward/back around Z (the model faces +X); arms counter-swing.
    if (legL) legL.rotation.z = swing * LEG_SWING;
    if (legR) legR.rotation.z = -swing * LEG_SWING;
    if (armL) armL.rotation.z = -swing * ARM_SWING;
    if (armR) armR.rotation.z = swing * ARM_SWING;
    // Bounce twice per stride cycle and wobble the head side to side once.
    entry.instance.root.position.y = Math.abs(Math.sin(entry.phase)) * BOB_HEIGHT * entry.stride;
    if (head) head.rotation.x = Math.sin(entry.phase / 2) * HEAD_WOBBLE * entry.stride;
  }
}
