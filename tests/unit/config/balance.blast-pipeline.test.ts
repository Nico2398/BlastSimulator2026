// BlastSimulator2026 — Blast pipeline balance constants
// Verifies the blast pipeline balance constants are exported from balance.ts
// with the values the refactor plan specifies.
// Plan: docs/plans/rock-fragmentation-refactor.md §7.

import { describe, it, expect } from 'vitest';
import {
  MAX_PROPAGATION_ITERATIONS,
  FRAGMENTATION_MULTIPLIER,
  SURFACE_PROXIMITY_DECAY,
  MAX_PROJECTION_VELOCITY,
  PROJECTION_VELOCITY_THRESHOLD,
  OVERSIZED_FRAGMENT_THRESHOLD,
  MAX_TOTAL_FRAGMENTS,
} from '../../../src/core/config/balance.js';

// ─── Step 1: Energy Propagation ─────────────────────────────────────────────────

describe('Step 1 — Energy Propagation', () => {
  it('MAX_PROPAGATION_ITERATIONS is exported from balance.ts', () => {
    expect(MAX_PROPAGATION_ITERATIONS).toBeDefined();
  });

  it('MAX_PROPAGATION_ITERATIONS is 500 — computational guard for the overflow loop', () => {
    expect(MAX_PROPAGATION_ITERATIONS).toBe(500);
  });
});

// ─── Step 2: Fragmentation ──────────────────────────────────────────────────────

describe('Step 2 — Voxel Fragmentation', () => {
  it('FRAGMENTATION_MULTIPLIER is exported from balance.ts', () => {
    expect(FRAGMENTATION_MULTIPLIER).toBeDefined();
  });

  it('FRAGMENTATION_MULTIPLIER is 1.0 — energy must meet the full threshold to fragment', () => {
    expect(FRAGMENTATION_MULTIPLIER).toBe(1.0);
  });
});

// ─── Step 4: Fragment Projection ────────────────────────────────────────────────

describe('Step 4 — Projection', () => {
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

  // ── Structural invariants ──────────────────────────────────────────────────

  it('PROJECTION_VELOCITY_THRESHOLD is less than MAX_PROJECTION_VELOCITY — collapse threshold must be below the hard cap', () => {
    expect(PROJECTION_VELOCITY_THRESHOLD).toBeLessThan(MAX_PROJECTION_VELOCITY);
  });

  it('SURFACE_PROXIMITY_DECAY is a positive number — exponential decay requires a positive coefficient', () => {
    expect(SURFACE_PROXIMITY_DECAY).toBeGreaterThan(0);
  });
});

// ─── Collection Rules ───────────────────────────────────────────────────────────

describe('Collection Rules', () => {
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

  it('MAX_TOTAL_FRAGMENTS is a positive render budget', () => {
    expect(MAX_TOTAL_FRAGMENTS).toBeGreaterThan(0);
  });
});
