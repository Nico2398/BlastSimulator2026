// BlastSimulator2026 — World-invariant test helper (#1084)
//
// Thin assertion wrapper around `assertWorldInvariants` so integration tests
// can fail with a readable message instead of hand-inspecting a Violation[].

import { expect } from 'vitest';
import type { GameState } from '../../src/core/state/GameState.js';
import { assertWorldInvariants } from '../../src/core/state/WorldInvariants.js';

export function expectNoWorldInvariantViolations(state: GameState): void {
  expect(assertWorldInvariants(state)).toEqual([]);
}
