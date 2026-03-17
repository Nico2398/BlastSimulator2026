// BlastSimulator2026 — Character Meshes (Placeholders)
// Minion-style placeholder: capsule body (cylinder + sphere top), sphere head.
// Role-based colors for visual distinction at a glance.
// Injured employees show in dark red; dead are removed.
// During zone clearing, characters move toward the safe zone exit.

import * as THREE from 'three';
import type { Employee, EmployeeRole } from '../core/entities/Employee.js';

// ---------- Role colors (bright, distinct) ----------
const ROLE_COLORS: Record<EmployeeRole, number> = {
  driller:  0x2266ff, // blue
  blaster:  0xff4422, // red-orange
  driver:   0xffcc00, // yellow
  surveyor: 0x22cc88, // teal
  manager:  0xaa55dd, // purple
};

// ---------- Status overrides ----------
const INJURED_COLOR  = 0x993333; // dark red
const EVACUATING_BLINK_RATE = 3; // blinks per second when evacuating (visual hint)

// ---------- Sizes ----------
const BODY_RADIUS   = 0.22;
const BODY_HEIGHT   = 0.55;
const HEAD_RADIUS   = 0.20;

// ---------- Movement ----------
const MOVE_LERP = 0.10;

// ---------- Main class ----------

export class CharacterMesh {
  private readonly scene: THREE.Scene;
  private readonly characters = new Map<number, {
    group: THREE.Group;
    bodyMat: THREE.MeshPhongMaterial;
    headMat: THREE.MeshPhongMaterial;
    employee: Employee;
    evacuating: boolean;
  }>();
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  addEmployee(employee: Employee): void {
    const roleColor = ROLE_COLORS[employee.role];
    const color = employee.injured ? INJURED_COLOR : roleColor;

    const group = new THREE.Group();

    // Legs / body (cylinder)
    const bodyGeo = new THREE.CylinderGeometry(BODY_RADIUS, BODY_RADIUS * 0.8, BODY_HEIGHT, 8);
    const bodyMat = new THREE.MeshPhongMaterial({ color, shininess: 15 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = BODY_HEIGHT / 2;
    group.add(body);

    // Head (sphere)
    const headGeo = new THREE.SphereGeometry(HEAD_RADIUS, 8, 6);
    const headMat = new THREE.MeshPhongMaterial({ color: 0xffe0b0, shininess: 30 }); // skin tone
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = BODY_HEIGHT + HEAD_RADIUS + 0.05;
    group.add(head);

    // Hard hat (tiny flat cylinder)
    const hatColor = employee.injured ? 0xaa0000 : roleColor;
    const hatGeo = new THREE.CylinderGeometry(HEAD_RADIUS * 1.3, HEAD_RADIUS * 1.1, 0.08, 8);
    const hatMat = new THREE.MeshPhongMaterial({ color: hatColor, shininess: 40 });
    const hat = new THREE.Mesh(hatGeo, hatMat);
    hat.position.y = BODY_HEIGHT + HEAD_RADIUS * 1.8 + 0.05;
    group.add(hat);

    group.position.set(employee.x, 0, employee.z);
    this.scene.add(group);
    this.characters.set(employee.id, { group, bodyMat, headMat, employee, evacuating: false });
  }

  /**
   * Update all characters' positions and states.
   * @param employees - Current employee list from GameState
   * @param dt - Elapsed seconds since last call (for animation)
   */
  update(employees: Employee[], dt: number): void {
    this.time += dt;

    for (const emp of employees) {
      const entry = this.characters.get(emp.id);
      if (!entry) continue;

      entry.employee = emp;

      // Lerp toward work position
      entry.group.position.x += (emp.x - entry.group.position.x) * MOVE_LERP;
      entry.group.position.z += (emp.z - entry.group.position.z) * MOVE_LERP;

      // Update body color for injury state
      const roleColor = ROLE_COLORS[emp.role];
      const targetColor = emp.injured ? INJURED_COLOR : roleColor;
      entry.bodyMat.color.setHex(targetColor);

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
   * Mark a character as evacuating (will blink to indicate urgency).
   */
  setEvacuating(employeeId: number, evacuating: boolean): void {
    const entry = this.characters.get(employeeId);
    if (entry) {
      entry.evacuating = evacuating;
      if (!evacuating) entry.group.visible = true;
    }
  }

  /** Move a character directly to safe zone exit position during zone clear. */
  evacuateTo(employeeId: number, x: number, z: number): void {
    const entry = this.characters.get(employeeId);
    if (entry) {
      entry.employee.x = x;
      entry.employee.z = z;
    }
  }

  removeEmployee(id: number): void {
    const entry = this.characters.get(id);
    if (entry) {
      this.scene.remove(entry.group);
      disposeGroup(entry.group);
      this.characters.delete(id);
    }
  }

  clearAll(): void {
    for (const { group } of this.characters.values()) {
      this.scene.remove(group);
      disposeGroup(group);
    }
    this.characters.clear();
  }

  get count(): number {
    return this.characters.size;
  }

  dispose(): void {
    this.clearAll();
  }
}

// ---------- Helpers ----------

function disposeGroup(group: THREE.Group): void {
  for (const child of group.children) {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
  }
}
