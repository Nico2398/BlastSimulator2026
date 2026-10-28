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

/** A terrain hit — nothing pickable was in front of it, or only a ramp, which is ground itself. */
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
  /** False for callers that want the raw ground tile (placement tools, tile picking) even where a ramp lies. */
  selectRamps = true,
): PickResult {
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

  const entityTargets = renderer.pickables();
  const terrainTargets = [...(renderer.terrain?.meshes ?? []), ...(renderer.landscape?.meshes ?? [])];
  const allHits = raycaster.intersectObjects([...entityTargets, ...terrainTargets], true);
  // Raw-ground callers (placement, tile picking) see through loose rubble and
  // through crew and vehicles: a crater full of fragments, or a tile someone
  // stands on, is still a tile a player can order a ramp or a drill plan onto.
  // Buildings keep occluding.
  const hits = selectRamps ? allHits : allHits.filter(h => !isTransientOccluder(h.object));
  const closest = hits[0];
  if (!closest) return EMPTY_PICK;

  const entity = resolveHitToEntity(closest, renderer);
  if (entity) return { entity, terrain: null };

  const tileX = Math.floor(closest.point.x);
  const tileZ = Math.floor(closest.point.z);
  const terrain: TerrainPick = { point: closest.point.clone(), tileX, tileZ, distance: closest.distance };
  // A ramp is a terrain feature with no mesh of its own: a ground hit inside a
  // built ramp's corridor selects it (#1298). Buildings and vehicles were
  // already resolved above, so they keep priority. The ground hit stays on the
  // result, so "Move Here"/"Dispatch Here" can still target a ramp tile.
  const rampId = selectRamps ? renderer.rampIdAtTile(tileX, tileZ) : null;
  if (rampId !== null) {
    return { entity: { kind: 'ramp', id: rampId, point: closest.point.clone(), distance: closest.distance }, terrain };
  }

  return { entity: null, terrain };
}

/** Movable or loose things a raw-ground pick looks through: fragments, employees, vehicles. */
function isTransientOccluder(object: THREE.Object3D): boolean {
  if (object.userData['entityKind'] === 'fragment') return true;
  const tagged = resolveTaggedAncestor(object);
  return tagged !== null && (tagged.kind === 'employee' || tagged.kind === 'vehicle');
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
/** The terrain hover tag appears after the pointer rests on one pick key for this long. */
export const HOVER_TAG_DWELL_MS = 400;

export type HoverChangeHandler = (hover: PickResult | null) => void;
/** Fires with the pick the pointer rested on, or null once the rest ends. */
type RestChangeHandler = (rest: PickResult | null) => void;
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

  private onRestChangeHandler: RestChangeHandler | null = null;
  private restTimer: ReturnType<typeof setTimeout> | null = null;
  private currentRest: PickResult | null = null;
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHoverKey: string | null = null;
  private currentHover: PickResult | null = null;
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
  setRestChangeHandler(cb: RestChangeHandler): void { this.onRestChangeHandler = cb; }

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
    this.clearRest();

    if (!pick.entity && !pick.terrain) {
      this.clearHover();
      return;
    }
    this.restTimer = setTimeout(() => {
      this.restTimer = null;
      this.currentRest = pick;
      this.onRestChangeHandler?.(pick);
    }, HOVER_TAG_DWELL_MS);
    this.hoverTimer = setTimeout(() => {
      this.currentHover = pick;
      this.onHoverChangeHandler?.(pick);
    }, HOVER_DELAY_MS);
  }

  /** Cancel a pending dwell and end a rest that is showing. */
  private clearRest(): void {
    if (this.restTimer !== null) { clearTimeout(this.restTimer); this.restTimer = null; }
    if (this.currentRest !== null) {
      this.currentRest = null;
      this.onRestChangeHandler?.(null);
    }
  }

  private clearHover(): void {
    this.clearRest();
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
    this.clearRest();
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
    if (this.restTimer !== null) clearTimeout(this.restTimer);
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('mouseup', this.handleMouseUp);
    this.canvas.removeEventListener('mouseleave', this.handleMouseLeave);
    this.canvas.style.cursor = '';
  }
}

function pickKey(pick: PickResult): string {
  // A ramp pick carries its ground tile too: moving along the ramp must
  // re-latch the aim, or "Move Here" targets the tile first hovered.
  const tile = pick.terrain ? `t:${pick.terrain.tileX}:${pick.terrain.tileZ}` : '';
  if (pick.entity) return `e:${pick.entity.kind}:${pick.entity.id}${tile}`;
  return tile;
}
