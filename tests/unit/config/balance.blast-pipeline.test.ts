// BlastSimulator2026 — Blast pipeline balance constants (5.20)
// Verifies all 13 blast pipeline balance constants are exported from balance.ts
// with the exact values specified in the gameplay-blast-system design doc.

import { describe, it, expect } from 'vitest';
import {
  MAX_PROPAGATION_ITERATIONS,
  FRAGMENTATION_MULTIPLIER,
  FRAGMENTATION_SCORE_SCALE,
  MAX_VORONOI_POINTS,
  MERGE_PROBABILITY,
  COLLISION_DEFLATE_AMOUNT,
  SURFACE_PROXIMITY_DECAY,
  MAX_PROJECTION_VELOCITY,
  PROJECTION_VELOCITY_THRESHOLD,
  PHYSICS_FRAGMENT_CAP,
  SLEEP_VELOCITY_THRESHOLD,
  SLEEP_TICKS_REQUIRED,
  OVERSIZED_FRAGMENT_THRESHOLD,
  MAX_TOTAL_FRAGMENTS,
} from '../../../src/core/config/balance.js';

// ─── Step 1: Energy Propagation ─────────────────────────────────────────────────

describe('Step 1 — Energy Propagation (5.20)', () => {
  it('MAX_PROPAGATION_ITERATIONS is exported from balance.ts', () => {
    expect(MAX_PROPAGATION_ITERATIONS).toBeDefined();
  });

  it('MAX_PROPAGATION_ITERATIONS is 500 — computational guard for the overflow loop', () => {
    expect(MAX_PROPAGATION_ITERATIONS).toBe(500);
  });
});

// ─── Step 2: Fragmentation ──────────────────────────────────────────────────────

describe('Step 2 — Voxel Fragmentation (5.20)', () => {
  it('FRAGMENTATION_MULTIPLIER is exported from balance.ts', () => {
    expect(FRAGMENTATION_MULTIPLIER).toBeDefined();
  });

  it('FRAGMENTATION_MULTIPLIER is 1.0 — energy must meet the full threshold to fragment', () => {
    expect(FRAGMENTATION_MULTIPLIER).toBe(1.0);
  });
});

// ─── Step 3: Fragment Shape Generation (Voronoi) ────────────────────────────────

describe('Step 3 — Voronoi Shape Generation (5.20)', () => {
  // ── FRAGMENTATION_SCORE_SCALE ──────────────────────────────────────────────

  it('FRAGMENTATION_SCORE_SCALE is exported from balance.ts', () => {
    expect(FRAGMENTATION_SCORE_SCALE).toBeDefined();
  });

  it('FRAGMENTATION_SCORE_SCALE is 3.0 — a voxel at threshold produces 3 fragments on average', () => {
    expect(FRAGMENTATION_SCORE_SCALE).toBe(3.0);
  });

  // ── MAX_VORONOI_POINTS ─────────────────────────────────────────────────────

  it('MAX_VORONOI_POINTS is exported from balance.ts', () => {
    expect(MAX_VORONOI_POINTS).toBeDefined();
  });

  it('MAX_VORONOI_POINTS is 2000 — performance guard for O(n log n) Delaunay tetrahedralization', () => {
    expect(MAX_VORONOI_POINTS).toBe(2000);
  });

  // ── MERGE_PROBABILITY ──────────────────────────────────────────────────────

  it('MERGE_PROBABILITY is exported from balance.ts', () => {
    expect(MERGE_PROBABILITY).toBeDefined();
  });

  it('MERGE_PROBABILITY is 0.35 — ~35% of Voronoi cells attempt a face-adjacent merge', () => {
    expect(MERGE_PROBABILITY).toBe(0.35);
  });

  // ── COLLISION_DEFLATE_AMOUNT ───────────────────────────────────────────────

  it('COLLISION_DEFLATE_AMOUNT is exported from balance.ts', () => {
    expect(COLLISION_DEFLATE_AMOUNT).toBeDefined();
  });

  it('COLLISION_DEFLATE_AMOUNT is 0.05 — 5 cm inward deflation for collision mesh gap', () => {
    expect(COLLISION_DEFLATE_AMOUNT).toBe(0.05);
  });

  // ── Structural invariants ──────────────────────────────────────────────────

  it('MERGE_PROBABILITY is a valid probability between 0 and 1', () => {
    expect(MERGE_PROBABILITY).toBeGreaterThanOrEqual(0);
    expect(MERGE_PROBABILITY).toBeLessThanOrEqual(1);
  });

  it('COLLISION_DEFLATE_AMOUNT is smaller than the voxel size of 1 m', () => {
    expect(COLLISION_DEFLATE_AMOUNT).toBeLessThan(1);
  });
});

// ─── Step 4: Fragment Projection & Physics Settle ──────────────────────────────

describe('Step 4 — Projection & Physics Settle (5.20)', () => {
  // ── SURFACE_PROXIMITY_DECAY ────────────────────────────────────────────────

  it('SURFACE_PROXIMITY_DECAY is exported from balance.ts', () => {
    expect(SURFACE_PROXIMITY_DECAY).toBeDefined();
  });

  it('SURFACE_PROXIMITY_DECAY is 0.5 — exponential decay factor for surface proximity', () => {
    expect(SURFACE_PROXIMITY_DECAY).toBe(0.5);
  });

  // ── MAX_PROJECTION_VELOCITY ─────────────────────────────────────────────────

  it('MAX_PROJECTION_VELOCITY is exported from balance.ts', () => {
    expect(MAX_PROJECTION_VELOCITY).toBeDefined();
  });

  it('MAX_PROJECTION_VELOCITY is 80 — cap of 80 m/s for projected fragment speed', () => {
    expect(MAX_PROJECTION_VELOCITY).toBe(80);
  });

  // ── PROJECTION_VELOCITY_THRESHOLD ───────────────────────────────────────────

  it('PROJECTION_VELOCITY_THRESHOLD is exported from balance.ts', () => {
    expect(PROJECTION_VELOCITY_THRESHOLD).toBeDefined();
  });

  it('PROJECTION_VELOCITY_THRESHOLD is 2.0 — fragments above 2 m/s are "projected", below are "collapse"', () => {
    expect(PROJECTION_VELOCITY_THRESHOLD).toBe(2.0);
  });

  // ── PHYSICS_FRAGMENT_CAP ────────────────────────────────────────────────────

  it('PHYSICS_FRAGMENT_CAP is exported from balance.ts', () => {
    expect(PHYSICS_FRAGMENT_CAP).toBeDefined();
  });

  it('PHYSICS_FRAGMENT_CAP is 200 — maximum fragments with full Cannon-es rigid-body simulation', () => {
    expect(PHYSICS_FRAGMENT_CAP).toBe(200);
  });

  // ── SLEEP_VELOCITY_THRESHOLD ────────────────────────────────────────────────

  it('SLEEP_VELOCITY_THRESHOLD is exported from balance.ts', () => {
    expect(SLEEP_VELOCITY_THRESHOLD).toBeDefined();
  });

  it('SLEEP_VELOCITY_THRESHOLD is 0.1 — fragments below 0.1 m/s are candidates for sleep', () => {
    expect(SLEEP_VELOCITY_THRESHOLD).toBe(0.1);
  });

  // ── SLEEP_TICKS_REQUIRED ────────────────────────────────────────────────────

  it('SLEEP_TICKS_REQUIRED is exported from balance.ts', () => {
    expect(SLEEP_TICKS_REQUIRED).toBeDefined();
  });

  it('SLEEP_TICKS_REQUIRED is 15 — fragment must be below sleep velocity for 15 consecutive ticks to become static', () => {
    expect(SLEEP_TICKS_REQUIRED).toBe(15);
  });

  // ── Structural invariants ──────────────────────────────────────────────────

  it('PROJECTION_VELOCITY_THRESHOLD is less than MAX_PROJECTION_VELOCITY — collapse threshold must be below the hard cap', () => {
    expect(PROJECTION_VELOCITY_THRESHOLD).toBeLessThan(MAX_PROJECTION_VELOCITY);
  });

  it('SLEEP_VELOCITY_THRESHOLD is less than PROJECTION_VELOCITY_THRESHOLD — sleep threshold is an order of magnitude below projection', () => {
    expect(SLEEP_VELOCITY_THRESHOLD).toBeLessThan(PROJECTION_VELOCITY_THRESHOLD);
  });

  it('PHYSICS_FRAGMENT_CAP does not exceed MAX_TOTAL_FRAGMENTS — the rigid-body cap must be within total fragment budget', () => {
    expect(PHYSICS_FRAGMENT_CAP).toBeLessThanOrEqual(MAX_TOTAL_FRAGMENTS);
  });

  it('SURFACE_PROXIMITY_DECAY is a positive number — exponential decay requires a positive coefficient', () => {
    expect(SURFACE_PROXIMITY_DECAY).toBeGreaterThan(0);
  });
});

// ─── Collection Rules ───────────────────────────────────────────────────────────

describe('Collection Rules (5.20)', () => {
  it('OVERSIZED_FRAGMENT_THRESHOLD is exported from balance.ts', () => {
    expect(OVERSIZED_FRAGMENT_THRESHOLD).toBeDefined();
  });

  it('OVERSIZED_FRAGMENT_THRESHOLD is 0.5 — fragments larger than 0.5 m³ require secondary breaking', () => {
    expect(OVERSIZED_FRAGMENT_THRESHOLD).toBe(0.5);
  });

  // ── Structural invariant ───────────────────────────────────────────────────

  it('OVERSIZED_FRAGMENT_THRESHOLD is within expected range — above zero and below typical blast fragment volumes', () => {
    expect(OVERSIZED_FRAGMENT_THRESHOLD).toBeGreaterThan(0);
    expect(OVERSIZED_FRAGMENT_THRESHOLD).toBeLessThan(10);
  });
});
