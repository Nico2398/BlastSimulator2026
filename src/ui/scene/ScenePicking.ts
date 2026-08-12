// BlastSimulator2026 — Scene picking (redesign P2)
// DOM-side of scene interaction: owns the raycaster, canvas pointer wiring,
// hover-tag debounce, and click→selection state. The Three.js side (outline
// meshes) lives in renderer/EntityHighlight.ts — this module only decides
// *what* is hovered/selected, never draws it.

import * as THREE from 'three';
import type { GameRenderer } from '../../renderer/GameRenderer.js';
import { resolveTaggedAncestor, type PickableKind } from '../../renderer/Pickable.js';

/** An entity resolved from a raycast hit — a building, vehicle, employee, or fragment. */
export interface EntityPick {
  readonly kind: PickableKind;
  readonly id: number;
  readonly point: THREE.Vector3;
  readonly distance: number;
}

/** A terrain hit — nothing pickable was in front of it. */
export interface TerrainPick {
  readonly point: THREE.Vector3;
  readonly tileX: number;
  readonly tileZ: number;
  readonly distance: number;
}

export interface PickResult {
  readonly entity: EntityPick | null;
  readonly terrain: TerrainPick | null;
}

const EMPTY_PICK: PickResult = { entity: null, terrain: null };

/**
 * Cast a ray from normalized device coordinates through `camera` and resolve
 * the closest hit. Entities and terrain share one raycast so a hill in front
 * of a building correctly occludes it — priority is decided by actual depth,
 * not by kind.
 */
export function pickScene(
  ndcX: number,
  ndcY: number,
  camera: THREE.Camera,
  renderer: GameRenderer,
  raycaster: THREE.Raycaster = new THREE.Raycaster(),
): PickResult {
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

  const entityTargets = renderer.pickables();
  const terrainTargets = [...(renderer.terrain?.meshes ?? []), ...(renderer.landscape?.meshes ?? [])];
  const hits = raycaster.intersectObjects([...entityTargets, ...terrainTargets], true);
  const closest = hits[0];
  if (!closest) return EMPTY_PICK;

  const entity = resolveHitToEntity(closest, renderer);
  if (entity) return { entity, terrain: null };

  return {
    entity: null,
    terrain: {
      point: closest.point.clone(),
      tileX: Math.floor(closest.point.x),
      tileZ: Math.floor(closest.point.z),
      distance: closest.distance,
    },
  };
}

function resolveHitToEntity(hit: THREE.Intersection, renderer: GameRenderer): EntityPick | null {
  // Fragments are leaf InstancedMesh objects (no wrapping Group), tagged with
  // a bucket index rather than an entityId — resolve the instance hit first.
  if (hit.object.userData['entityKind'] === 'fragment') {
    if (hit.instanceId === undefined) return null;
    const bucketIndex = hit.object.userData['bucketIndex'] as number;
    const fragId = renderer.resolveFragmentId(bucketIndex, hit.instanceId);
    if (fragId === null) return null;
    return { kind: 'fragment', id: fragId, point: hit.point.clone(), distance: hit.distance };
  }

  const tagged = resolveTaggedAncestor(hit.object);
  if (!tagged) return null;
  return { kind: tagged.kind, id: tagged.id, point: hit.point.clone(), distance: hit.distance };
}

/** Pixel movement below this between mousedown and mouseup still counts as a click, not a camera drag. */
const CLICK_MOVE_THRESHOLD_PX = 5;
/** Hover tag appears after the cursor rests on the same target for this long (spec: 60ms). */
const HOVER_DELAY_MS = 60;

export type HoverChangeHandler = (hover: PickResult | null) => void;
export type SelectChangeHandler = (selection: EntityPick | null) => void;

/**
 * Wires canvas pointer events to `pickScene`: hover (debounced) while the
 * cursor rests, click→select (deselecting on empty ground), coexisting with
 * CameraController's own mousedown/drag handling on the same canvas.
 */
export class ScenePicking {
  private readonly raycaster = new THREE.Raycaster();
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: THREE.Camera;
  private readonly renderer: GameRenderer;

  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHoverKey: string | null = null;
  private currentHover: PickResult | null = null;
  /**
   * The last thing the cursor was genuinely over, which — unlike
   * {@link currentHover} — SURVIVES the mouse leaving the canvas.
   *
   * `currentHover` answers two different questions that need opposite
   * lifetimes: "what should be highlighted right now" (clear it the moment the
   * cursor leaves) and "what is the player aiming at" (must outlive the trip to
   * a HUD button). Using it for both made every SelectionBar action that reads
   * the aim — Dispatch Here, Move Here, Haul — impossible to use with a mouse:
   * the bar is `position:fixed` over a full-viewport canvas, so reaching the
   * button always fires `mouseleave` first, and the handler then read `null` and
   * bailed one millisecond later. Proven in a real browser: the identical click
   * dispatched synchronously (no cursor travel) worked; via a real mouse it
   * never called the console at all.
   */
  private lastAim: PickResult | null = null;
  private currentSelection: EntityPick | null = null;

  private pointerDown = false;
  private downX = 0;
  private downY = 0;
  /** False while a placement tool (P3) owns the canvas — entity hover/select would otherwise fight it for the same clicks. */
  private enabled = true;

  private onHoverChangeHandler: HoverChangeHandler | null = null;
  private onSelectChangeHandler: SelectChangeHandler | null = null;

  private readonly handleMouseMove = (e: MouseEvent) => this.onMouseMove(e);
  private readonly handleMouseDown = (e: MouseEvent) => this.onMouseDown(e);
  private readonly handleMouseUp = (e: MouseEvent) => this.onMouseUp(e);
  private readonly handleMouseLeave = () => this.clearHover();

  constructor(canvas: HTMLCanvasElement, camera: THREE.Camera, renderer: GameRenderer) {
    this.canvas = canvas;
    this.camera = camera;
    this.renderer = renderer;
    canvas.addEventListener('mousemove', this.handleMouseMove);
    canvas.addEventListener('mousedown', this.handleMouseDown);
    canvas.addEventListener('mouseup', this.handleMouseUp);
    canvas.addEventListener('mouseleave', this.handleMouseLeave);
  }

  setHoverChangeHandler(cb: HoverChangeHandler): void { this.onHoverChangeHandler = cb; }
  setSelectChangeHandler(cb: SelectChangeHandler): void { this.onSelectChangeHandler = cb; }

  /** Suppress hover/select while a placement tool is armed; clears any live hover on disable. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clearHover();
  }

  get selection(): EntityPick | null { return this.currentSelection; }
  get hover(): PickResult | null { return this.currentHover; }

  /** Select an entity directly (e.g. clicking its row in a panel) without a scene click. */
  select(entity: EntityPick | null): void {
    this.currentSelection = entity;
    this.onSelectChangeHandler?.(entity);
  }

  clearSelection(): void { this.select(null); }

  private ndcFromEvent(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
    };
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.enabled) return;
    if (this.pointerDown) return; // camera is orbiting/panning — no hover during a drag
    const { x, y } = this.ndcFromEvent(e);
    const pick = pickScene(x, y, this.camera, this.renderer, this.raycaster);
    const key = pickKey(pick);
    this.canvas.style.cursor = pick.entity ? 'pointer' : '';

    if (key === this.lastHoverKey) return; // still resting on the same target
    this.lastHoverKey = key;
    if (this.hoverTimer !== null) clearTimeout(this.hoverTimer);

    if (!pick.entity && !pick.terrain) {
      this.clearHover();
      return;
    }
    this.hoverTimer = setTimeout(() => {
      this.currentHover = pick;
      // Latch the aim too. Only a new pick replaces it — clearHover() must not,
      // or the trip to a HUD button destroys what the button is meant to act on.
      this.lastAim = pick;
      this.onHoverChangeHandler?.(pick);
    }, HOVER_DELAY_MS);
  }

  /**
   * What the player is aiming at, for HUD actions that act on a scene target
   * (Dispatch Here, Move Here, Haul). Outlives the cursor leaving the canvas;
   * see {@link lastAim}. Use {@link hover} for highlighting, never for aiming.
   */
  get aim(): PickResult | null { return this.lastAim; }

  private clearHover(): void {
    if (this.hoverTimer !== null) { clearTimeout(this.hoverTimer); this.hoverTimer = null; }
    this.lastHoverKey = null;
    this.canvas.style.cursor = '';
    if (this.currentHover !== null) {
      this.currentHover = null;
      this.onHoverChangeHandler?.(null);
    }
  }

  private onMouseDown(e: MouseEvent): void {
    if (!this.enabled) return;
    this.pointerDown = true; // suppresses hover during any drag — left orbit, right/middle pan alike
    if (e.button !== 0) return; // only the left button drives selection — right/middle pan the camera
    this.downX = e.clientX;
    this.downY = e.clientY;
  }

  private onMouseUp(e: MouseEvent): void {
    if (!this.enabled) return;
    this.pointerDown = false;
    if (e.button !== 0) return;
    const dx = e.clientX - this.downX;
    const dy = e.clientY - this.downY;
    if (Math.hypot(dx, dy) > CLICK_MOVE_THRESHOLD_PX) return; // was a camera-orbit drag, not a click

    const { x, y } = this.ndcFromEvent(e);
    const pick = pickScene(x, y, this.camera, this.renderer, this.raycaster);
    this.select(pick.entity); // entity clicked → select it; empty ground/terrain → deselect
  }

  dispose(): void {
    if (this.hoverTimer !== null) clearTimeout(this.hoverTimer);
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('mouseup', this.handleMouseUp);
    this.canvas.removeEventListener('mouseleave', this.handleMouseLeave);
    this.canvas.style.cursor = '';
  }
}

function pickKey(pick: PickResult): string {
  if (pick.entity) return `e:${pick.entity.kind}:${pick.entity.id}`;
  if (pick.terrain) return `t:${pick.terrain.tileX}:${pick.terrain.tileZ}`;
  return '';
}
