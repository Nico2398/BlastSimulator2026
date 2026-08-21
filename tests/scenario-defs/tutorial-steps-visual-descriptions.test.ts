import { describe, it } from 'vitest';

describe('tutorial-steps-visual.json descriptions', () => {
  it.todo('is valid JSON');
  it.todo('contains no stale 4x4/16-hole grid references anywhere in the file');
  it.todo('step 23 (drill_plan grid) description describes the real 3x3/9-hole grid');
  it.todo('step 24 (tick 400) description describes 9 holes, not 16');
  it.todo('step 26 (tick 225) description reasons about 9 holes charging first');
  it.todo('step 29 (blast) description re-derives deathCount:2 against the real x:20-26/z:20-26 footprint, and the deathCount:2 assertion itself stays untouched');
});
