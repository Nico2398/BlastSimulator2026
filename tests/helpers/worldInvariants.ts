// BlastSimulator2026 — World-invariant test helper (#1084)
//
// Thin assertion wrapper around `assertWorldInvariants` so integration tests
// can fail with a readable message instead of hand-inspecting a Violation[].

import type { GameState } from '../../src/core/state/GameState.js';

export function expectNoWorldInvariantViolations(state: GameState): void {
  // TODO: implement
  throw new Error('not implemented');
}
