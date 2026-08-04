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
import { getPickerRegion, regionAccepts, regionContains, type TileRegion } from '../tutorialPickerRegion.js';

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

  private onConfirmHandler: PlacementConfirmHandler | null = null;
  private onCancelHandler: (() => void) | null = null;
  private onChangeHandler: PlacementChangeHandler | null = null;
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

  get currentPhase(): PlacementPhase { return this.phase; }
  get currentShape(): PlacementShape { return this.shape; }
  /** True through the whole armed lifecycle, including the 220ms confirm flash — camera remap and ScenePicking suppression only release at disarm(). */
  get isArmed(): boolean { return this.phase !== 'idle'; }
  get hoveredTile(): { x: number; z: number } | null { return this.hoverTile; }
  /** The region the current step pins the selection to, or null when unconstrained. Read by the overlay to dim outside tiles. */
  get activeRegion(): TileRegion | null { return this.region; }

  /** The live selection, or null before an anchor exists. */
  get selection(): PlacementSelection | null {
    if (!this.anchor) return null;
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
    this.anchor = config.initialSelection ? { x: config.initialSelection.x, z: config.initialSelection.z } : null;
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
   * events. For the scenario harness only (window.__placement) — scenario
   * defs aren't bound by playability's "must be clicked" rule the way
   * playtests are, and re-deriving screen pixels for a 3D world tile on every
   * call would be fragile where this is exact. Works for point mode too
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

  /** Whether a tile responds to hover/anchor — inside the pinned region when one is active, per "stops responding to hover" outside it. */
  private isLive(tile: { x: number; z: number }): boolean {
    return !this.region || regionContains(this.region, tile.x, tile.z);
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
    if (this.phase === 'armed' && live) this.phase = 'hovering';
    else if (this.phase === 'hovering' && !live) this.phase = 'armed';
    this.notify();
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    if (this.phase === 'idle' || this.phase === 'confirmed') return;
    const tile = this.tileUnderCursor(e);
    if (!tile || !this.isLive(tile)) return; // anchor outside the pinned region: no rectangle starts

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
    this.cancel();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.phase === 'idle' || this.phase === 'confirmed') return;
    if (e.key === 'Escape') { e.stopPropagation(); this.cancel(); }
    else if (e.key === 'Enter' && this.phase === 'selected') this.confirm();
  }

  private notify(): void { this.onChangeHandler?.(); }

  dispose(): void {
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('mouseup', this.handleMouseUp);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu);
    window.removeEventListener('keydown', this.handleKeyDown);
    if (this.phase !== 'idle') this.cameraController.setArmedRemap(false);
  }
}
