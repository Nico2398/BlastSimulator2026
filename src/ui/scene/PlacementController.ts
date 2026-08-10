// BlastSimulator2026 — Placement controller (redesign P3)
// The in-scene grid-select tool: arm/disarm, pointer→tile resolution via the
// same raycast ScenePicking uses, and the six-state machine the design doc
// specifies (idle/armed/hovering/dragging/selected/confirmed). Owns no
// rendering — SelectionOverlay (renderer) and ParamStrip (DOM) read this
// controller's state and draw it. Mirrors ScenePicking's shape: independent
// canvas listeners that coexist with CameraController's own, coordinated via
// CameraController.setArmedRemap rather than by fighting over event order.

import * as THREE from 'three';
import type { GameRenderer } from '../../renderer/GameRenderer.js';
import type { CameraController } from '../../renderer/CameraController.js';
import { pickScene } from './ScenePicking.js';
import {
  getPickerRegion, regionAccepts, regionContains, liveArea, type TileRegion,
} from '../tutorialPickerRegion.js';

export type PlacementShape = 'rect' | 'line' | 'point';
export type PlacementPhase = 'idle' | 'armed' | 'hovering' | 'dragging' | 'selected' | 'confirmed';

export interface PlacementSelection {
  /** Anchor tile — drag/line start, or the point itself in point mode. */
  x1: number;
  z1: number;
  /** Second tile. Equals x1/z1 in point mode. Direction is preserved for 'line' (a ramp's start must stay the start); normalized min/max for 'rect'. */
  x2: number;
  z2: number;
}

export interface PlacementArmConfig {
  shape: PlacementShape;
  /** Tile pre-filled as the current selection, so Confirm is reachable at once (point mode). */
  initialSelection?: { x: number; z: number };
}

export type PlacementConfirmHandler = (sel: PlacementSelection) => void;
export type PlacementChangeHandler = () => void;

/** 220ms amber sweep on confirm (design doc §01, state 6) before the tool disarms itself. */
const CONFIRM_FLASH_MS = 220;

export class PlacementController {
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: THREE.Camera;
  private readonly renderer: GameRenderer;
  private readonly cameraController: CameraController;
  private readonly raycaster = new THREE.Raycaster();

  private phase: PlacementPhase = 'idle';
  private shape: PlacementShape = 'rect';
  private region: TileRegion | null = null;

  private hoverTile: { x: number; z: number } | null = null;
  private anchor: { x: number; z: number } | null = null;
  private current: { x: number; z: number } | null = null;

  /** Tile the pointer is over that the active region refuses, or null. Drives the red cell and the strip's reason line. */
  private blockedTile: { x: number; z: number } | null = null;

  private onConfirmHandler: PlacementConfirmHandler | null = null;
  private onCancelHandler: (() => void) | null = null;
  private onChangeHandler: PlacementChangeHandler | null = null;
  /** Set once by main.ts and never replaced, unlike onChangeHandler — the region/blocked-tile drawing must not depend on which panel armed the tool. */
  private onFeedbackHandler: PlacementChangeHandler | null = null;
  /** Set once by main.ts, never overwritten by a panel arming its own tool — unlike onChangeHandler, which each panel replaces with its own strip refresh. Fires on every arm()/disarm() so ScenePicking can step aside while a placement tool owns the canvas. */
  private onArmedStateHandler: ((armed: boolean) => void) | null = null;

  private readonly handleMouseMove = (e: MouseEvent) => this.onMouseMove(e);
  private readonly handleMouseDown = (e: MouseEvent) => this.onMouseDown(e);
  private readonly handleMouseUp = (e: MouseEvent) => this.onMouseUp(e);
  private readonly handleContextMenu = (e: MouseEvent) => this.onContextMenu(e);
  private readonly handleKeyDown = (e: KeyboardEvent) => this.onKeyDown(e);

  constructor(canvas: HTMLCanvasElement, camera: THREE.Camera, renderer: GameRenderer, cameraController: CameraController) {
    this.canvas = canvas;
    this.camera = camera;
    this.renderer = renderer;
    this.cameraController = cameraController;
    canvas.addEventListener('mousemove', this.handleMouseMove);
    canvas.addEventListener('mousedown', this.handleMouseDown);
    canvas.addEventListener('mouseup', this.handleMouseUp);
    canvas.addEventListener('contextmenu', this.handleContextMenu);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  setConfirmHandler(cb: PlacementConfirmHandler): void { this.onConfirmHandler = cb; }
  setCancelHandler(cb: () => void): void { this.onCancelHandler = cb; }
  /** Fires on every phase/selection change — the DOM strip and renderer redraw off this instead of polling every frame. */
  setChangeHandler(cb: PlacementChangeHandler): void { this.onChangeHandler = cb; }
  setArmedStateHandler(cb: (armed: boolean) => void): void { this.onArmedStateHandler = cb; }
  /** Fires alongside every change, for the scene-level feedback main.ts owns (region outline, refused tile). */
  setFeedbackHandler(cb: PlacementChangeHandler): void { this.onFeedbackHandler = cb; }

  get currentPhase(): PlacementPhase { return this.phase; }
  get currentShape(): PlacementShape { return this.shape; }
  /** True through the whole armed lifecycle, including the 220ms confirm flash — camera remap and ScenePicking suppression only release at disarm(). */
  get isArmed(): boolean { return this.phase !== 'idle'; }
  get hoveredTile(): { x: number; z: number } | null { return this.hoverTile; }
  /** The region the current step pins the selection to, or null when unconstrained. Read by the overlay to dim outside tiles. */
  get activeRegion(): TileRegion | null { return this.region; }
  /** Tile the pointer is over that the region refuses, or null. The overlay marks it red and the strip explains it. */
  get refusedTile(): { x: number; z: number } | null { return this.blockedTile; }

  /** The live selection, or null before an anchor exists. */
  get selection(): PlacementSelection | null {
    if (!this.anchor) return null;
    // An exact region *is* the answer, so any live pick resolves to it rather
    // than to whatever the player's drag covered. Reproducing a rectangle
    // corner-for-corner from a 3D pick is not something a player can do, and
    // asking them to was how the drill step became impossible to finish (#489).
    if (this.region?.exact) {
      const r = this.region;
      return { x1: r.x1, z1: r.z1, x2: r.x2, z2: r.z2 };
    }
    const cur = this.current ?? this.anchor;
    if (this.shape === 'rect') {
      return {
        x1: Math.min(this.anchor.x, cur.x), z1: Math.min(this.anchor.z, cur.z),
        x2: Math.max(this.anchor.x, cur.x), z2: Math.max(this.anchor.z, cur.z),
      };
    }
    return { x1: this.anchor.x, z1: this.anchor.z, x2: cur.x, z2: cur.z };
  }

  /** Whether the live selection may be confirmed: exists, and satisfies the active region if any. */
  get canConfirm(): boolean {
    const sel = this.selection;
    if (!sel) return false;
    if (!this.region) return true;
    return regionAccepts(this.region, sel);
  }

  /** Arm the tool. Reads the tutorial's published region itself (tutorialPickerRegion.ts's publish/subscribe handoff) so callers never need to know a tutorial is running. */
  arm(config: PlacementArmConfig): void {
    this.shape = config.shape;
    this.region = getPickerRegion();
    this.hoverTile = null;
    this.blockedTile = null;
    // A guided step drops the pre-fill entirely. The survey panel pre-fills the
    // middle of the map, which sits outside every guided region — so the strip
    // opened showing a tile the step would never accept and a Confirm that was
    // dead before the player had touched anything (#489). Clamping it into the
    // region would fix that and skip the pick the step is teaching; leaving it
    // out puts the player on the click the card is asking for, with the region
    // drawn under their cursor and a visible reason on Confirm until they make it.
    this.anchor = config.initialSelection && !this.region
      ? { x: config.initialSelection.x, z: config.initialSelection.z }
      : null;
    this.current = this.anchor;
    this.phase = 'armed';
    this.cameraController.setArmedRemap(true);
    this.onArmedStateHandler?.(true);
    this.notify();
  }

  /** Drop back to idle without confirming. Does not fire onCancel — call cancel() for a player-initiated exit. */
  disarm(): void {
    this.phase = 'idle';
    this.hoverTile = null;
    this.blockedTile = null;
    this.anchor = null;
    this.current = null;
    this.region = null;
    this.cameraController.setArmedRemap(false);
    this.onArmedStateHandler?.(false);
    this.notify();
  }

  /** Esc / right-click / re-press the arming button — every exit path in the design doc's remap table. */
  cancel(): void {
    if (this.phase === 'idle' || this.phase === 'confirmed') return;
    this.disarm();
    this.onCancelHandler?.();
  }

  confirm(): void {
    if (!this.canConfirm) return;
    const sel = this.selection;
    if (!sel) return;
    this.phase = 'confirmed';
    // The confirm handler runs first — it's what arms the overlay's flash
    // (via overlay.flashConfirm()) — so the notify() below renders with the
    // flash already active instead of one frame behind it.
    this.onConfirmHandler?.(sel);
    this.notify();
    setTimeout(() => this.disarm(), CONFIRM_FLASH_MS);
  }

  /**
   * Set the selection directly and enter 'selected', bypassing real pointer
   * events. For the command-mode scenario harness only (window.__placement)
   * — a `role: 'player'` step's `interaction` array is what carries the
   * click-only requirement, and command mode has no such step, so this
   * shortcut is exact rather than fragile where re-deriving screen pixels
   * for a 3D world tile on every call would be. Works for point mode too
   * (pass the same tile twice). No-op while idle/confirmed, same as a real drag.
   */
  paintRect(x1: number, z1: number, x2: number, z2: number): void {
    if (this.phase === 'idle' || this.phase === 'confirmed') return;
    this.anchor = { x: x1, z: z1 };
    this.current = { x: x2, z: z2 };
    this.phase = 'selected';
    this.notify();
  }

  private tileUnderCursor(e: MouseEvent): { x: number; z: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const pick = pickScene(ndcX, ndcY, this.camera, this.renderer, this.raycaster);
    if (!pick.terrain) return null;
    return { x: pick.terrain.tileX, z: pick.terrain.tileZ };
  }

  /**
   * Whether a tile responds to hover/anchor.
   *
   * Measured against the region's live area rather than the region itself: an
   * exact region snaps anyway, so the extra margin costs nothing and spares the
   * player a pixel-perfect pick on a single tile.
   */
  private isLive(tile: { x: number; z: number }): boolean {
    if (!this.region) return true;
    const live = liveArea(this.region);
    return regionContains(live, tile.x, tile.z);
  }

  private onMouseMove(e: MouseEvent): void {
    if (this.phase === 'idle' || this.phase === 'confirmed') return;
    const tile = this.tileUnderCursor(e);

    if (this.phase === 'dragging') {
      if (tile) { this.current = tile; this.notify(); }
      return;
    }

    this.hoverTile = tile;
    const live = tile !== null && this.isLive(tile);
    // Out-of-bounds reads as refused rather than as nothing at all: the overlay
    // paints this tile red and the strip says why.
    this.blockedTile = tile !== null && !live ? tile : null;
    if (this.phase === 'armed' && live) this.phase = 'hovering';
    else if (this.phase === 'hovering' && !live) this.phase = 'armed';
    this.notify();
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    if (this.phase === 'idle' || this.phase === 'confirmed') return;
    const tile = this.tileUnderCursor(e);
    if (!tile || !this.isLive(tile)) {
      // Anchor outside the pinned region: no rectangle starts, but the refusal
      // is shown. Returning in silence here is what made the terrain look dead.
      this.blockedTile = tile;
      this.notify();
      return;
    }
    this.blockedTile = null;

    if (this.shape === 'point') {
      this.anchor = tile;
      this.current = tile;
      this.phase = 'selected';
      this.notify();
      return;
    }

    // From 'selected', a fresh mousedown anywhere starts a new rectangle/line rather than editing the old one.
    this.anchor = tile;
    this.current = tile;
    this.phase = 'dragging';
    this.notify();
  }

  private onMouseUp(e: MouseEvent): void {
    if (e.button !== 0) return;
    if (this.phase !== 'dragging') return;
    const tile = this.tileUnderCursor(e);
    if (tile) this.current = tile;
    this.phase = 'selected';
    this.notify();
  }

  private onContextMenu(e: MouseEvent): void {
    if (this.phase === 'idle' || this.phase === 'confirmed') return;
    e.preventDefault();
    // A right-drag used purely to orbit the camera must not cancel the armed
    // tool — only a right-button click (no meaningful movement) does. Single
    // source of truth for the drag/click distinction lives on CameraController
    // (RIGHT_DRAG_THRESHOLD_PX), not duplicated here (#544).
    if (this.cameraController.rightButtonDragged) return;
    this.cancel();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.phase === 'idle' || this.phase === 'confirmed') return;
    if (e.key === 'Escape') { e.stopPropagation(); this.cancel(); }
    else if (e.key === 'Enter' && this.phase === 'selected') this.confirm();
  }

  private notify(): void {
    this.onChangeHandler?.();
    this.onFeedbackHandler?.();
  }

  dispose(): void {
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('mouseup', this.handleMouseUp);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu);
    window.removeEventListener('keydown', this.handleKeyDown);
    if (this.phase !== 'idle') this.cameraController.setArmedRemap(false);
  }
}
