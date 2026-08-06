// BlastSimulator2026 — Placement selection overlay (redesign P3)
// The Three.js side of the in-scene grid-select tool: per-tile quads on
// column tops, a border, corner accents, and hole markers for the rect
// shape; a line + endpoint rings for ramps; a point + optional radius ring
// for buildings/surveys. PlacementController (src/ui/scene/) decides state;
// this only draws it — same split as ScenePicking/EntityHighlight in P2.
//
// Simplified from the design doc's full fidelity where the gap is cosmetic
// rather than functional: no occluded-cell x-ray, no rejected-cell-within-
// selection colouring (the game has no per-tile drill validity to drive it),
// no literal screen-space-constant line width (EntityHighlight's ring
// doesn't attempt this either — WebGL line width is unreliable across
// platforms), and the pinned region reads as a blue cell tint rather than a
// full-scene dim shader.

import * as THREE from 'three';

const COLOR_SELECTION = 0xffc840;
const COLOR_PINNED = 0x7ab8ff;
const COLOR_BUILDING_VALID = 0x4fc76b;
const COLOR_SURVEY = 0x3fd0c0;
/** Tile the pointer is over but the step will not accept — #489's "blocked without clear visual indication". */
const COLOR_BLOCKED = 0xff6a5a;

const CELL_FILL_OPACITY = 0.26;
/** The guidance region is a backdrop for the selection drawn on top of it, so it sits lighter. */
const REGION_FILL_OPACITY = 0.2;
const Y_OFFSET = 0.06; // lifted off the terrain to avoid z-fighting
const HOLE_RING_SEGMENTS = 16;
const HOLE_RING_RADIUS = 0.28;
const CORNER_LEN = 0.9; // tiles, per design doc geometry tokens
const CONFIRM_FLASH_MS = 220;
const BEACON_HEIGHT = 14; // world units above the region's centre

export type OverlayShape = 'rect' | 'line' | 'point';

export interface OverlayCellsUpdate {
  shape: 'rect';
  /** Inclusive tile bounds. */
  x1: number; z1: number; x2: number; z2: number;
  /** World tiles the current tutorial step pins the selection to, if any — matching cells tint blue. */
  region?: { x1: number; z1: number; x2: number; z2: number } | null;
  /** Spacing (tiles) between drill-hole markers; omit for no markers (building/ramp footprints don't drill). */
  holeSpacing?: number;
}

export interface OverlayLineUpdate {
  shape: 'line';
  x1: number; z1: number; x2: number; z2: number;
}

export interface OverlayPointUpdate {
  shape: 'point';
  x: number; z: number;
  /** Footprint cells relative to (x, z), e.g. a building's def.footprint. Defaults to the single tile. */
  footprintCells?: ReadonlyArray<readonly [number, number]>;
  /** World-unit radius for a knowledge overlay (survey method radius). */
  radius?: number;
  /** Tints the point/footprint teal (survey) instead of amber — buildings stay amber; green live-validity is not computed here (see file header). */
  tone?: 'default' | 'survey';
}

export type OverlayUpdate = OverlayCellsUpdate | OverlayLineUpdate | OverlayPointUpdate;

/** Inclusive tile rectangle a guided step pins the placement to. */
export interface OverlayRegion { x1: number; z1: number; x2: number; z2: number }

export class SelectionOverlay {
  private readonly scene: THREE.Scene;
  private readonly group: THREE.Group;
  /**
   * The area a guided step pins the placement to, drawn from the moment the
   * tool arms and independent of any selection.
   *
   * Before #489 the region existed only as a blue tint on cells the player had
   * *already* selected, which meant it was invisible until after the click it
   * was supposed to guide — and never visible at all for the point and line
   * tools, which drew no cells. A player told to "click the highlighted tile"
   * saw nothing highlighted, clicked, and was refused without a reason.
   */
  private readonly regionGroup: THREE.Group;
  private readonly surfaceYAt: (x: number, z: number) => number;
  private flashUntil = 0;
  private region: OverlayRegion | null = null;
  private blockedTile: { x: number; z: number } | null = null;

  constructor(scene: THREE.Scene, surfaceYAt: (x: number, z: number) => number) {
    this.scene = scene;
    this.surfaceYAt = surfaceYAt;
    this.group = new THREE.Group();
    this.group.name = 'placement-selection-overlay';
    this.regionGroup = new THREE.Group();
    this.regionGroup.name = 'placement-region-overlay';
    this.scene.add(this.group);
    this.scene.add(this.regionGroup);
  }

  /**
   * Draw (or clear) the guided target area. Persistent: unlike `update`, this
   * survives every selection change until the tool disarms.
   */
  setRegion(region: OverlayRegion | null): void {
    this.region = region ? { ...region } : null;
    this.blockedTile = null;
    this.rebuildRegion();
  }

  /**
   * Mark the tile the pointer is over as refused, or clear the mark.
   *
   * Silence was the whole complaint: outside the region a click produced no
   * selection, no hover, and no message, so the terrain read as broken rather
   * than as out of bounds.
   */
  setBlockedTile(tile: { x: number; z: number } | null): void {
    const same = (this.blockedTile === null && tile === null)
      || (this.blockedTile !== null && tile !== null
        && this.blockedTile.x === tile.x && this.blockedTile.z === tile.z);
    if (same) return;
    this.blockedTile = tile ? { x: tile.x, z: tile.z } : null;
    this.rebuildRegion();
  }

  private rebuildRegion(): void {
    for (const child of [...this.regionGroup.children]) {
      this.regionGroup.remove(child);
      disposeObject(child);
    }
    const r = this.region;
    if (r) {
      for (let z = r.z1; z <= r.z2; z++) {
        for (let x = r.x1; x <= r.x2; x++) {
          this.regionGroup.add(this.makeCell(x, z, COLOR_PINNED, false, REGION_FILL_OPACITY));
        }
      }
      this.regionGroup.add(this.makeBorder(r.x1, r.z1, r.x2, r.z2, COLOR_PINNED));
      this.regionGroup.add(...this.makeCorners(r.x1, r.z1, r.x2, r.z2, COLOR_PINNED));
      this.regionGroup.add(this.makeBeacon(r));
    }
    if (this.blockedTile) {
      this.regionGroup.add(this.makeCell(this.blockedTile.x, this.blockedTile.z, COLOR_BLOCKED, false, 0.4));
    }
  }

  /** Rebuild the overlay for the current placement state. Call from PlacementController's onChange, not per-frame. */
  update(u: OverlayUpdate | null): void {
    this.clearChildren();
    if (!u) return;

    const flashing = performance.now() < this.flashUntil;
    if (u.shape === 'rect') this.buildRect(u, flashing);
    else if (u.shape === 'line') this.buildLine(u, flashing);
    else this.buildPoint(u, flashing);
  }

  /** 220ms amber pulse on confirm (design doc: "220ms amber sweep along +X"; simplified to a brightness pulse — see file header). */
  flashConfirm(): void {
    this.flashUntil = performance.now() + CONFIRM_FLASH_MS;
  }

  /** Take everything off: the selection and the guided region both. Called when the tool goes idle. */
  clear(): void {
    this.clearChildren();
    this.setRegion(null);
  }

  private clearChildren(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      disposeObject(child);
    }
  }

  private buildRect(u: OverlayCellsUpdate, flashing: boolean): void {
    const x0 = Math.min(u.x1, u.x2), x1 = Math.max(u.x1, u.x2);
    const z0 = Math.min(u.z1, u.z2), z1 = Math.max(u.z1, u.z2);
    const region = u.region ?? null;

    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const inRegion = region !== null && x >= region.x1 && x <= region.x2 && z >= region.z1 && z <= region.z2;
        const color = region ? (inRegion ? COLOR_PINNED : COLOR_SELECTION) : COLOR_SELECTION;
        this.group.add(this.makeCell(x, z, color, flashing));
      }
    }

    this.group.add(this.makeBorder(x0, z0, x1, z1, region ? COLOR_PINNED : COLOR_SELECTION));
    this.group.add(...this.makeCorners(x0, z0, x1, z1, region ? COLOR_PINNED : COLOR_SELECTION));

    if (u.holeSpacing && u.holeSpacing > 0) {
      for (let z = z0; z <= z1; z += u.holeSpacing) {
        for (let x = x0; x <= x1; x += u.holeSpacing) {
          this.group.add(this.makeHoleMarker(x, z));
        }
      }
    }
  }

  private buildLine(u: OverlayLineUpdate, flashing: boolean): void {
    const y1 = this.surfaceYAt(u.x1, u.z1) + Y_OFFSET;
    const y2 = this.surfaceYAt(u.x2, u.z2) + Y_OFFSET;
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(u.x1 + 0.5, y1, u.z1 + 0.5),
      new THREE.Vector3(u.x2 + 0.5, y2, u.z2 + 0.5),
    ]);
    const material = new THREE.LineBasicMaterial({ color: COLOR_SELECTION, transparent: true, opacity: flashing ? 1 : 0.9 });
    this.group.add(new THREE.Line(geometry, material));
    this.group.add(this.makeHoleMarker(u.x1, u.z1));
    this.group.add(this.makeHoleMarker(u.x2, u.z2));
  }

  private buildPoint(u: OverlayPointUpdate, flashing: boolean): void {
    const color = u.tone === 'survey' ? COLOR_SURVEY : COLOR_SELECTION;
    const cells = u.footprintCells ?? [[0, 0]] as const;
    for (const [dx, dz] of cells) this.group.add(this.makeCell(u.x + dx, u.z + dz, color, flashing));

    if (u.radius !== undefined) {
      const y = this.surfaceYAt(u.x, u.z) + Y_OFFSET;
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= HOLE_RING_SEGMENTS * 2; i++) {
        const angle = (i / (HOLE_RING_SEGMENTS * 2)) * Math.PI * 2;
        points.push(new THREE.Vector3(u.x + 0.5 + Math.cos(angle) * u.radius, y, u.z + 0.5 + Math.sin(angle) * u.radius));
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({ color: COLOR_SURVEY, transparent: true, opacity: 0.7 });
      this.group.add(new THREE.LineLoop(geometry, material));
    }
  }

  private makeCell(x: number, z: number, color: number, flashing: boolean, opacity = CELL_FILL_OPACITY): THREE.Mesh {
    const y = this.surfaceYAt(x, z) + Y_OFFSET;
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: flashing ? 0.6 : opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x + 0.5, y, z + 0.5);
    return mesh;
  }

  /** Rectangle outline at each tile's own surface height (steps down a bench face rather than shearing through it). */
  private makeBorder(x0: number, z0: number, x1: number, z1: number, color: number): THREE.Object3D {
    const group = new THREE.Group();
    const seg = (ax: number, az: number, bx: number, bz: number) => {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(ax, this.surfaceYAt(Math.min(ax, bx), Math.min(az, bz)) + Y_OFFSET, az),
        new THREE.Vector3(bx, this.surfaceYAt(Math.min(ax, bx), Math.min(az, bz)) + Y_OFFSET, bz),
      ]);
      group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color })));
    };
    for (let x = x0; x <= x1; x++) { seg(x, z0, x + 1, z0); seg(x, z1 + 1, x + 1, z1 + 1); }
    for (let z = z0; z <= z1; z++) { seg(x0, z, x0, z + 1); seg(x1 + 1, z, x1 + 1, z + 1); }
    return group;
  }

  private makeCorners(x0: number, z0: number, x1: number, z1: number, color: number): THREE.Object3D[] {
    const corners: Array<[number, number, number, number]> = [
      [x0, z0, 1, 1], [x1 + 1, z0, -1, 1], [x0, z1 + 1, 1, -1], [x1 + 1, z1 + 1, -1, -1],
    ];
    return corners.map(([cx, cz, dx, dz]) => {
      const y = this.surfaceYAt(cx, cz) + Y_OFFSET + 0.01;
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(cx + dx * CORNER_LEN, y, cz),
        new THREE.Vector3(cx, y, cz),
        new THREE.Vector3(cx, y, cz + dz * CORNER_LEN),
      ]);
      return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, linewidth: 2 }));
    });
  }

  /**
   * A vertical mast over the region's centre.
   *
   * A one-tile target — which is what the survey and warehouse steps pin —
   * covers a handful of pixels from the game's low, shallow camera, and a flat
   * tint on the ground is easy to read as terrain. The mast is the part the
   * player's eye finds; the outline underneath is what tells them how big the
   * target is.
   */
  private makeBeacon(r: OverlayRegion): THREE.Object3D {
    const cx = (r.x1 + r.x2) / 2 + 0.5;
    const cz = (r.z1 + r.z2) / 2 + 0.5;
    const base = this.surfaceYAt(Math.round(cx), Math.round(cz)) + Y_OFFSET;
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(cx, base, cz),
      new THREE.Vector3(cx, base + BEACON_HEIGHT, cz),
    ]);
    return new THREE.Line(geometry, new THREE.LineBasicMaterial({
      color: COLOR_PINNED, transparent: true, opacity: 0.9,
    }));
  }

  private makeHoleMarker(x: number, z: number): THREE.Object3D {
    const y = this.surfaceYAt(x, z) + Y_OFFSET + 0.005;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= HOLE_RING_SEGMENTS; i++) {
      const angle = (i / HOLE_RING_SEGMENTS) * Math.PI * 2;
      points.push(new THREE.Vector3(x + 0.5 + Math.cos(angle) * HOLE_RING_RADIUS, y, z + 0.5 + Math.sin(angle) * HOLE_RING_RADIUS));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({ color: COLOR_SELECTION }));
  }

  dispose(): void {
    this.clearChildren();
    this.setRegion(null);
    this.scene.remove(this.group);
    this.scene.remove(this.regionGroup);
  }
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh | THREE.Line;
    if ('geometry' in mesh && mesh.geometry) mesh.geometry.dispose();
    const material = (mesh as THREE.Mesh).material;
    if (Array.isArray(material)) material.forEach(m => m.dispose());
    else if (material) material.dispose();
  });
}

// Building-valid and survey tokens exported for callers that want the exact
// design-doc colours in their own DOM chips (ParamStrip reads these).
export const OVERLAY_COLORS = {
  selection: COLOR_SELECTION,
  pinned: COLOR_PINNED,
  buildingValid: COLOR_BUILDING_VALID,
  survey: COLOR_SURVEY,
} as const;
