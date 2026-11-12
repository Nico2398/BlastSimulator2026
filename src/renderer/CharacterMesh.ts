// BlastSimulator2026 — Character Meshes
// Each employee is a skinned worker from the model library (one .glb per
// role, built in assets/models/blender/workers.py). The role colour tints
// the garment and hard hat; injured workers go dark red; dead are removed.
// Skin and hair tones vary per employee. Workers turn to face where they
// walk, and a WorkerAnimator poses the skeleton every frame — a planted-foot
// walk that becomes a run, a breathing idle, the role's work loop, an
// exhausted slump, panic while evacuating, the collapse.

import * as THREE from 'three';
import type { Employee, EmployeeRole } from '../core/entities/Employee.js';
import { isSameTrailPoint, type MovementTrail } from '../core/entities/MovementTrail.js';
import { tagPickable } from './Pickable.js';
import {
  applyEasedPosition, createTween, exitSpanOf, MOVE_TWEEN_DURATION_S, startSpanPlayback, stepSpanPlayback, trailLength, visibleTrailSpans, withLeadIn,
  type MovementTween, type TrailSpan,
} from './MovementInterpolation.js';
import { headingFromDelta, turnToward } from './Heading.js';
import { modelLibrary, type ModelInstance, type ModelLibrary } from './models/ModelLibrary.js';
import { workerModelId } from './models/ModelIds.js';
import { WorkerAnimator } from './character/WorkerAnimator.js';
import { workerRig } from './character/WorkerRig.js';
import { OVERLAY_Y_KEY } from './TaskProgressBar.js';

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
/** How far above a worker's own hat top his status icon and progress bar float. */
const OVERLAY_CLEARANCE = 0.25;

/** Material every worker model exposes for its overalls and hat. */
export const ROLE_TINT = 'TintRole';
/** Materials for skin and hair, toned per employee, and for the main garment. */
export const SKIN_TINT = 'TintSkin';
export const HAIR_TINT = 'TintHair';
export const GARMENT_TINT = 'TintGarment';

/**
 * Each role's garment, apart in value from its role-coloured hard hat so a
 * worker is not one blob of colour (assets/models/blender/workers.py ships the
 * same values). Injury turns the garment dark red; the hat keeps the role.
 */
export const GARMENT_COLORS: Record<EmployeeRole, number> = {
  driller: 0x34507e,  // denim overalls
  blaster: 0x9a8f80,  // scorched ash-khaki coverall
  driver: 0xff7a1a,   // orange hi-vis vest
  surveyor: 0x2fa58c, // field-teal jacket
  manager: 0x343a52,  // charcoal-navy suit
};

/** Skin tones a crew is drawn from, light to deep. */
export const SKIN_TONES: readonly number[] = [0xF5D0B0, 0xEAB98E, 0xD9A06F, 0xC68A55, 0xA86B3C, 0x8D5524, 0x6B3F22];
/** Hair, brow and beard colours. */
export const HAIR_COLORS: readonly number[] = [0x2A1A12, 0x4A2F1F, 0x6E4224, 0x9A6332, 0x1E1E22, 0x7C7670, 0xB8894A];

/** Stable per-employee pick from a palette (ids are small consecutive integers, so mix them first). */
export function paletteFor(id: number, palette: readonly number[], salt: number): number {
  return palette[paletteIndex(id, palette.length, salt)]!;
}

function paletteIndex(id: number, length: number, salt: number): number {
  let h = Math.imul(id + 1, 0x9E3779B1) ^ Math.imul(salt, 0x85EBCA77);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2C1B3C6D);
  h ^= h >>> 12;
  return (h >>> 0) % length;
}

/** HSL lightness of a 0xRRGGBB colour, 0..1. */
function lightness(hex: number): number {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
}

/** How far apart in lightness hair (and with it brows, beard, moustache) must be from the skin it sits on. */
const HAIR_CONTRAST = 0.14;

/**
 * An employee's hair colour: their stable pick from HAIR_COLORS, stepping on through the
 * palette until it stands apart from `skin` — otherwise a dark-haired, deep-skinned face
 * reads as one brown blob under the hat, brows and moustache lost in it.
 */
export function hairFor(id: number, skin: number): number {
  const start = paletteIndex(id, HAIR_COLORS.length, 2);
  for (let k = 0; k < HAIR_COLORS.length; k++) {
    const hair = HAIR_COLORS[(start + k) % HAIR_COLORS.length]!;
    if (Math.abs(lightness(hair) - lightness(skin)) >= HAIR_CONTRAST) return hair;
  }
  return HAIR_COLORS.reduce((a, b) => (Math.abs(lightness(b) - lightness(skin)) > Math.abs(lightness(a) - lightness(skin)) ? b : a));
}
/** Stand-in box while the worker asset is not loaded: roughly a minion's envelope. */
const FALLBACK_SIZE = [0.55, 1.2, 0.55] as const;

// ---------- Facing ----------
/** Below this ground speed (m/s) a worker keeps his heading. */
const TURN_SPEED_MIN = 0.05;
/** How fast a worker turns toward where he walks (rad/s). */
const TURN_RATE = 9;

interface CharacterEntry {
  group: THREE.Group;
  instance: ModelInstance;
  /** Poses the skeleton; null for the stand-in box, which has none. */
  animator: WorkerAnimator | null;
  employee: Employee;
  evacuating: boolean;
  tween: MovementTween;
  /** Full trail length the span pace is measured against (#1589). */
  fullTrailLength: number;
  /** True while the mesh plays its last spans up to a host marker before removal (#1589). */
  retiring: boolean;
  /** True on the frame a span ended and the next one has not begun — the gap is hidden (#1589). */
  gapHidden: boolean;
}

/** Most visible spans a retiring mesh plays; trips in between are skipped. */
const MAX_RETIRING_SPANS = 2;

/**
 * Role and injury colours: the hat (and accents) keep the role colour, the
 * garment its own — dark red when hurt. The stand-in box has only the role
 * tint, so on it the injury shows there instead.
 */
function applyStatusTints(instance: ModelInstance, employee: Employee): void {
  const garment = instance.tints.get(GARMENT_TINT);
  const role = instance.tints.get(ROLE_TINT);
  if (garment) {
    garment.color.setHex(employee.injured ? INJURED_COLOR : GARMENT_COLORS[employee.role]);
    role?.color.setHex(ROLE_COLORS[employee.role]);
  } else {
    role?.color.setHex(employee.injured ? INJURED_COLOR : ROLE_COLORS[employee.role]);
  }
}

// ---------- Main class ----------

export class CharacterMesh {
  private readonly scene: THREE.Scene;
  private readonly library: ModelLibrary;
  private readonly characters = new Map<number, CharacterEntry>();
  private timeScale = 1;

  constructor(scene: THREE.Scene, library: ModelLibrary = modelLibrary) {
    this.scene = scene;
    this.library = library;
  }

  addEmployee(employee: Employee, surfaceY: number = 0, trail?: MovementTrail, spawnSpan?: TrailSpan): void {
    this.removeEmployee(employee.id); // a mesh still retiring is dropped first (#1589)
    const exitSpan = spawnSpan ?? exitSpanOf(trail);
    const start = exitSpan?.points[0] ?? employee;
    const group = new THREE.Group();
    const { instance, animator } = this.attachModel(group, employee);
    group.position.set(start.x, surfaceY, start.z);
    tagPickable(group, 'employee', employee.id);
    this.scene.add(group);
    const tween = createTween(start.x, start.z);
    const fullTrailLength = trail ? trailLength(trail.points) : 0;
    if (exitSpan) {
      // Walk out of the host along the recorded span; no fresh chord tween (#1589).
      tween.targetX = employee.x;
      tween.targetZ = employee.z;
      startSpanPlayback(tween, [exitSpan], fullTrailLength);
    }
    // A character leaving a vehicle stays hidden while it is still arriving (#2224).
    const held = (tween.holdS ?? 0) > 0;
    group.visible = !held;
    this.characters.set(employee.id, {
      group, instance, animator, employee, evacuating: false,
      tween, fullTrailLength, retiring: false, gapHidden: held,
    });
  }

  /**
   * Update all characters' positions and states.
   * @param employees - Current employee list from GameState
   * @param dt - Elapsed seconds since last call (for animation)
   * @param heightAt - Optional terrain height sampler, called with the same
   *   eased (x, z) the tween produces so a character's Y follows the slope
   *   under its feet every frame instead of the last synced cell (#1038).
   * @param timeScale - The game-speed multiplier: at 4× a worker covers four
   *   times the ground, and his legs should hurry, not break into a run.
   */
  update(employees: Employee[], dt: number, heightAt?: (x: number, z: number) => number, timeScale = 1): void {
    this.timeScale = timeScale;

    for (const emp of employees) {
      const entry = this.characters.get(emp.id);
      if (!entry) continue;

      entry.employee = emp;

      // Ease toward work position (duration-aware tween, #520), along the
      // route the simulation actually walked this batch (#1199).
      const fromX = entry.group.position.x;
      const fromZ = entry.group.position.z;
      if (!entry.retiring && !this.tweenTargetIs(entry, emp)) this.beginHostSpans(entry, emp);
      if (entry.retiring || (entry.tween.spans && this.tweenTargetIs(entry, emp))) {
        const finished = this.playSpans(entry, dt, heightAt);
        this.animateGait(entry, entry.group.position.x - fromX, entry.group.position.z - fromZ, dt);
        if (finished && entry.retiring) {
          this.removeEmployee(emp.id);
          continue;
        }
        entry.group.visible = !entry.gapHidden;
        continue;
      }
      entry.tween.spans = undefined;
      const eased = applyEasedPosition(entry.group.position, entry.tween, fromX, fromZ, emp.x, emp.z, dt, heightAt, emp.walkTrail);
      this.animateGait(entry, eased.x - fromX, eased.z - fromZ, dt);

      // Body colour for injury state
      applyStatusTints(entry.instance, emp);

      // An evacuating worker is never hidden: his panic run, raised arm and
      // gaping mouth (WorkerAnimator) are the cue.
      entry.group.visible = true;
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

  /**
   * Keep the mesh and play its trail up to the host board/enter marker, then remove it (#1589).
   * Without a usable walk trail the mesh goes at once.
   */
  retireEmployee(employee: Employee): void {
    const entry = this.characters.get(employee.id);
    if (!entry || entry.retiring) return;
    const trail = employee.walkTrail;
    const spans = trail ? visibleTrailSpans(trail) : [];
    const first = spans[0];
    if (!trail || !first) {
      this.removeEmployee(employee.id);
      return;
    }
    const played: TrailSpan[] = spans.length > MAX_RETIRING_SPANS ? [first, spans[spans.length - 1]!] : spans;
    // Start from where the mesh really is, so it walks on rather than popping to the trail start.
    const { x, z } = entry.group.position;
    const lead = withLeadIn(played, x, z, trail.points);
    entry.retiring = true;
    entry.gapHidden = false;
    entry.fullTrailLength = lead.fullTrailLength;
    startSpanPlayback(entry.tween, lead.spans, entry.fullTrailLength);
  }

  /** True while a mesh is playing out its final span before removal (#1589). */
  isRetiring(id: number): boolean {
    return this.characters.get(id)?.retiring ?? false;
  }

  /** Ids of meshes still playing out their final span (#1589). */
  retiringIds(): number[] {
    return [...this.characters.entries()].filter(([, e]) => e.retiring).map(([id]) => id);
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
      const { instance, animator } = this.attachModel(entry.group, entry.employee);
      entry.instance = instance;
      entry.animator = animator;
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

  private attachModel(group: THREE.Group, employee: Employee): { instance: ModelInstance; animator: WorkerAnimator | null } {
    const instance = this.library.instantiate(workerModelId(employee.role), { size: FALLBACK_SIZE, tint: ROLE_TINT });
    applyStatusTints(instance, employee);
    const skin = paletteFor(employee.id, SKIN_TONES, 1);
    instance.tints.get(SKIN_TINT)?.color.setHex(skin);
    instance.tints.get(HAIR_TINT)?.color.setHex(hairFor(employee.id, skin));
    group.add(instance.root);
    group.userData[OVERLAY_Y_KEY] = instance.bounds.max.y + OVERLAY_CLEARANCE;
    const rig = instance.isFallback ? null : workerRig(instance.root);
    const animator = rig ? new WorkerAnimator(rig, employee.role, employee.id) : null;
    return { instance, animator };
  }

  private tweenTargetIs(entry: CharacterEntry, emp: Employee): boolean {
    return entry.tween.targetX === emp.x && entry.tween.targetZ === emp.z;
  }

  /**
   * A new target reached through a board..alight trail (two or more visible spans) plays the spans
   * with the ride hidden between them, instead of gliding the chord (#1589).
   */
  private beginHostSpans(entry: CharacterEntry, emp: Employee): void {
    const trail = emp.walkTrail;
    if (!trail || trail.relocated || trail.hostMarkers.length === 0) return;
    const spans = visibleTrailSpans(trail);
    const last = trail.points[trail.points.length - 1];
    if (spans.length < 2 || !last || !isSameTrailPoint(last, emp.x, emp.z)) return;
    const { x, z } = entry.group.position;
    const lead = withLeadIn(spans, x, z, trail.points);
    entry.tween.targetX = emp.x;
    entry.tween.targetZ = emp.z;
    entry.fullTrailLength = lead.fullTrailLength;
    entry.gapHidden = false;
    startSpanPlayback(entry.tween, lead.spans, entry.fullTrailLength);
  }

  /** Steps span playback and places the group; returns true once the last span has finished. */
  private playSpans(entry: CharacterEntry, dt: number, heightAt?: (x: number, z: number) => number): boolean {
    const { position } = entry.group;
    const step = stepSpanPlayback(entry.tween, position.x, position.z, dt, entry.fullTrailLength);
    position.x = step.x;
    position.z = step.z;
    if (heightAt) position.y = heightAt(step.x, step.z);
    // Hidden for the frame that crosses from one span to the next (the ride in between is not shown).
    // ... and for the whole ride when a hold follows the span (#2224).
    entry.gapHidden = (step.spanDone && !step.finished) || (entry.tween.holdS ?? 0) > 0;
    if (step.finished && !entry.retiring) {
      // Snap the tween to its target so a later frame never glides back to the stale origin (#2224).
      const { tween } = entry;
      tween.spans = undefined;
      tween.path = null;
      tween.window = undefined;
      tween.holdS = 0;
      tween.prevX = tween.targetX;
      tween.prevZ = tween.targetZ;
      tween.elapsedS = MOVE_TWEEN_DURATION_S;
    }
    return step.finished;
  }

  /** Face the direction of travel, then let the animator pose the body for what the worker is doing. */
  private animateGait(entry: CharacterEntry, dx: number, dz: number, dt: number): void {
    if (dt <= 0) return;
    const speed = Math.hypot(dx, dz) / dt;
    const before = entry.group.rotation.y;
    if (speed > TURN_SPEED_MIN) {
      entry.group.rotation.y = turnToward(before, headingFromDelta(dx, dz), TURN_RATE * dt);
    }
    if (!entry.animator) return;
    let turn = entry.group.rotation.y - before;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const emp = entry.employee;
    entry.animator.update(dt, {
      speed,
      timeScale: this.timeScale,
      turn: turn / dt,
      working: emp.taskTicksRemaining !== null && emp.taskTicksRemaining > 0,
      collapsing: emp.collapsing,
      evacuating: entry.evacuating,
      injured: emp.injured,
      fatigue: emp.fatigue,
    });
  }
}
