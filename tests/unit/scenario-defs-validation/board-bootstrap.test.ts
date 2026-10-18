// BlastSimulator2026 — the board scenarios attach their board through a bootstrap step (#1946)

import { describe, it, expect } from 'vitest';
import { isAllowedBootstrapCommand, isObservationCommand } from '../../../scripts/shared/interaction-executor.js';

describe('board console commands in scenario steps (#1946)', () => {
  it('`board start` is a bootstrap primitive (no UI equivalent)', () => {
    expect(isAllowedBootstrapCommand('board start quarterTicks:48 ore:1 profit:1000')).toBe(true);
  });

  it('`board status` is a read-only observation', () => {
    expect(isObservationCommand('board status')).toBe(true);
  });
});
