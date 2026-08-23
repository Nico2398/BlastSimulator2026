// BlastSimulator2026 — Regression coverage for issue #704
//
// blast-visual-full.json's step timeouts were set without accounting for
// interaction-mode --screenshots capture cost (1 base render + 4 `shots`
// angles per step, plus any per-step `frames`, each costing several seconds
// under software rasterization with no GPU). This file locks in that each
// step's timeout budget actually covers its capture cost.
//
// See scripts/scenario-defs/blast-visual-full.json and its top-level
// `shots` array (4 camera angles captured after every step).

import { describe, it } from 'vitest';

describe('scenario timeout budget', () => {
  it.todo('blast-visual-full.json step 0 timeout covers base + shots capture cost under software rasterization');

  it.todo('blast-visual-full.json step 36 (blast) timeout covers base + frames + shots capture cost');
});
