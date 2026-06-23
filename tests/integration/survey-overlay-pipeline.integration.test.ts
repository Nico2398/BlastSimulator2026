// BlastSimulator2026 — Integration test: GameRenderer survey overlay pipeline (issue #386)
// Tests the critical integration point: GameRenderer.syncFromContext() MUST call
// syncSurveyOverlay() to connect survey data to the renderer overlay.
//
// ALL TESTS IN THIS FILE MUST FAIL before implementation — they exercise the
// exact pipeline that is currently disconnected (syncSurveyOverlay is a TODO stub).

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { GameRenderer } from '../../src/renderer/GameRenderer.js';
import { SurveyConfidenceOverlay } from '../../src/renderer/SurveyConfidenceOverlay.js';
import type { SurveyConfidenceOverlayOptions } from '../../src/renderer/SurveyConfidenceOverlay.js';
import type { MiningContext } from '../../src/console/commands/mining.js';
import { createGame } from '../../src/core/state/GameState.js';
import { VoxelGrid } from '../../src/core/world/VoxelGrid.js';

// ── Minimal SceneManager mock (matches SceneManager interface) ──────────────

function makeMockSceneManager() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const sun = new THREE.DirectionalLight();
  const ambient = new THREE.AmbientLight();
  const cameraController = {
    setTarget: vi.fn(),
    update: vi.fn(),
  };
  return {
    scene,
    camera,
    sun,
    ambient,
    cameraController,
    renderer: { render: vi.fn() } as unknown,
  };
}

// ── Helper: build MiningContext ─────────────────────────────────────────────

function makeCtx(
  overrides: { seed?: number; cash?: number; tick?: number } = {},
): MiningContext {
  const state = createGame({
    seed: overrides.seed ?? 42,
    startingCash: overrides.cash ?? 100_000,
  });
  if (overrides.tick !== undefined) {
    state.tickCount = overrides.tick;
  }
  const grid = new VoxelGrid(32, 16, 32);
  return {
    state,
    grid,
    emitter: { on: vi.fn(), emit: vi.fn() } as any,
  };
}

// ── Test Suite: syncSurveyOverlay is called from syncFromContext ────────────

describe('GameRenderer — syncSurveyOverlay pipeline (issue #386)', () => {
  /**
   * This is the critical failing test: syncFromContext() must call
   * syncSurveyOverlay() when survey results are present in the state.
   *
   * Currently FAILS because syncFromContext() never calls syncSurveyOverlay().
   */

  it('syncFromContext calls syncSurveyOverlay when survey results exist', () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const spy = vi.spyOn(renderer, 'syncSurveyOverlay');

    const ctx = makeCtx();
    ctx.state.surveyResults.push({
      id: 1,
      method: 'seismic',
      centerX: 10,
      centerZ: 10,
      completedTick: 50,
      surveyorId: 1,
      estimates: { '10,10': { gold: 0.5 } },
      confidence: 0.85,
    });

    renderer.syncFromContext(ctx);

    // syncSurveyOverlay MUST be called — this is the broken pipeline
    expect(spy).toHaveBeenCalled();
  });

  it('syncFromContext passes non-null options with points array', () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const spy = vi.spyOn(renderer, 'syncSurveyOverlay');

    const ctx = makeCtx();
    ctx.state.surveyResults.push({
      id: 1,
      method: 'core_sample',
      centerX: 15,
      centerZ: 15,
      completedTick: 50,
      surveyorId: 1,
      estimates: { '15,15': { copper: 0.4 } },
      confidence: 0.95,
    });

    renderer.syncFromContext(ctx);

    // Must pass non-null options with points array
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        points: expect.any(Array),
        opacity: expect.any(Number),
      }),
    );
  });

  it('syncFromContext calls syncSurveyOverlay with null when no survey results', () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const spy = vi.spyOn(renderer, 'syncSurveyOverlay');

    const ctx = makeCtx();
    // No survey results added

    renderer.syncFromContext(ctx);

    // Must call with null to hide overlay when no surveys exist
    expect(spy).toHaveBeenCalledWith(null);
  });
});

// ── Test Suite: syncSurveyOverlay implementation ───────────────────────────

describe('GameRenderer.syncSurveyOverlay — implementation (issue #386)', () => {
  /**
   * syncSurveyOverlay must wire TerrainMesh.getSurveyOverlay().show() / .hide().
   * Currently it's a no-op TODO stub — all these tests must fail.
   */

  it('syncSurveyOverlay with options wires the overlay to show in the scene', () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);

    // Load a game first so terrain mesh exists
    const ctx = makeCtx();
    renderer.syncFromContext(ctx);

    // The overlay group is added to the scene in the SurveyConfidenceOverlay constructor,
    // so scene.children.length doesn't change. Instead, we check that the overlay
    // group becomes visible and contains mesh children for each confidence point.
    const options: SurveyConfidenceOverlayOptions = {
      points: [
        { x: 10, z: 10, surfaceY: 5, confidence: 0.85, fresh: true },
      ],
      opacity: 0.6,
    };
    renderer.syncSurveyOverlay(options);

    // Find the overlay group and verify it's visible
    const overlayGroups = sm.scene.children.filter(
      (child) => child instanceof THREE.Group,
    ) as THREE.Group[];
    expect(overlayGroups.length).toBeGreaterThan(0);
    const overlayGroup = overlayGroups[overlayGroups.length - 1]!;
    expect(overlayGroup.visible).toBe(true);
    
    // The overlay group should contain mesh children for each confidence point
    expect(overlayGroup.children.length).toBeGreaterThan(0);
  });

  it('syncSurveyOverlay with null hides the overlay group', () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);

    const ctx = makeCtx();
    renderer.syncFromContext(ctx);

    // First, show the overlay by calling syncSurveyOverlay with options.
    // This must create a visible overlay group in the scene.
    renderer.syncSurveyOverlay({
      points: [{ x: 10, z: 10, surfaceY: 5, confidence: 0.85, fresh: true }],
      opacity: 0.6,
    });

    // The overlay MUST exist as a THREE.Group in the scene after show().
    // This FAILS because syncSurveyOverlay is a no-op stub — nothing is created.
    const overlayGroups = sm.scene.children.filter(
      (child) => child instanceof THREE.Group,
    ) as THREE.Group[];
    expect(overlayGroups.length).toBeGreaterThan(0);
    const overlayGroup = overlayGroups[overlayGroups.length - 1]!;
    expect(overlayGroup.visible).toBe(true);

    // Now hide it
    renderer.syncSurveyOverlay(null);

    // After hide(), the overlay group must be invisible
    expect(overlayGroup.visible).toBe(false);
  });
});

// ── Test Suite: confidence points conversion ───────────────────────────────

describe('GameRenderer — survey results to confidence points conversion (issue #386)', () => {
  /**
   * The renderer must convert SurveyResult[] to SurveyConfidencePoint[]
   * considering stale status and surface Y position.
   */

  it('syncSurveyOverlay options contain correct confidence from survey results', () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);

    const ctx = makeCtx();
    ctx.state.surveyResults.push({
      id: 1,
      method: 'seismic',
      centerX: 10,
      centerZ: 10,
      completedTick: 50,
      surveyorId: 1,
      estimates: { '10,10': { gold: 0.8 } },
      confidence: 0.85,
    });

    const spy = vi.spyOn(renderer, 'syncSurveyOverlay');
    renderer.syncFromContext(ctx);

    // This FAILS because syncFromContext never calls syncSurveyOverlay
    expect(spy).toHaveBeenCalled();
    const options = spy.mock.calls[0]?.[0] as SurveyConfidenceOverlayOptions | undefined;
    expect(options).toBeDefined();
    expect(options!.points.length).toBeGreaterThan(0);

    // The center column should have confidence matching the survey
    const centerPoint = options!.points.find(
      (p) => p.x === 10 && p.z === 10,
    );
    expect(centerPoint).toBeDefined();
    expect(centerPoint!.confidence).toBeCloseTo(0.85, 2);
  });

  it('syncSurveyOverlay options mark stale surveys as not fresh', () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);

    const ctx = makeCtx({ tick: 200 });
    // Survey at tick 0 — will be stale at current tick 200
    ctx.state.surveyResults.push({
      id: 1,
      method: 'seismic',
      centerX: 10,
      centerZ: 10,
      completedTick: 0,
      surveyorId: 1,
      estimates: { '10,10': { gold: 0.8 } },
      confidence: 0.85,
    });

    const spy = vi.spyOn(renderer, 'syncSurveyOverlay');
    renderer.syncFromContext(ctx);

    // This FAILS because syncFromContext never calls syncSurveyOverlay
    expect(spy).toHaveBeenCalled();
    const options = spy.mock.calls[0]?.[0] as SurveyConfidenceOverlayOptions | undefined;
    expect(options).toBeDefined();

    const centerPoint = options!.points.find(
      (p) => p.x === 10 && p.z === 10,
    );
    expect(centerPoint).toBeDefined();
    expect(centerPoint!.fresh).toBe(false);
  });
});
