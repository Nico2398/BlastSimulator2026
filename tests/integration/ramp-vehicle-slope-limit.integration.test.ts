// The ramp tool, the console and the spiral helper cut only what vehicles can drive (#2045).
//
// Progression (sandbox) sites: one 20 degree vehicle limit, so the steepest ramp the console accepts is the
// 20 degree cut ratio. Campaign sites keep 30 degrees. Old saves, whose ramps carry no `cutSlopeRatio`, load.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import { VEHICLE_MAX_SLOPE_DEGREES } from '../../src/core/config/balance.js';

const tanDeg = (d: number): number => Math.tan(d * Math.PI / 180);

function sandbox() {
  const { runner, ctx } = createRunner();
  const started = runner.run('sandbox start biome:desert_badlands kit:full seed:42');
  expect(started.success, started.output).toBe(true);
  return { runner, ctx };
}

describe('console ramp orders on a progression site (#2045)', () => {
  it('refuses a 10 m ramp for 5 m of depth (26.6 degrees) and names the 20 degree limit', () => {
    const { runner } = sandbox();
    const result = runner.run('build_ramp start:27,9 end:17,9 depth:5');
    expect(result.success).toBe(false);
    expect(result.output).toContain(String(VEHICLE_MAX_SLOPE_DEGREES));
    expect(result.output).not.toContain('30');
  });

  it('refuses a 5 m ramp for 2 m of depth (21.8 degrees)', () => {
    const { runner } = sandbox();
    expect(runner.run('build_ramp start:30,31 end:35,31 depth:2').success).toBe(false);
  });

  it('accepts a 6 m ramp for 2 m of depth (18.4 degrees)', () => {
    const { runner } = sandbox();
    expect(runner.run('build_ramp start:29,31 end:35,31 depth:2').success).toBe(true);
  });

  it('accepts the shortest legal length: depth / (tan 20 x 0.98), rounded up', () => {
    const { runner } = sandbox();
    const length = Math.ceil(5 / (tanDeg(20) * 0.98));
    expect(runner.run(`build_ramp start:${27},9 end:${27 - length},9 depth:5`).success).toBe(true);
    const { runner: other } = sandbox();
    expect(other.run(`build_ramp start:27,9 end:${27 - (length - 1)},9 depth:5`).success).toBe(false);
  });

  it('refuses an explicit grade over the ceiling', () => {
    const { runner } = sandbox();
    expect(runner.run('build_ramp start:27,9 end:7,9 depth:5 grade:25').success).toBe(false);
  });
});

describe('console ramp orders on a campaign site (#2045)', () => {
  it('still accepts the steep 10 m / 5 m ramp: walking and campaign vehicles keep 30 degrees', () => {
    const { runner } = createRunner();
    expect(runner.run('new_game seed:42').success).toBe(true);
    expect(runner.run('build_ramp start:27,9 end:17,9 depth:5').success).toBe(true);
  });
});

describe('ramp spiral order on a progression site (#2045)', () => {
  it('refuses a 25 degree spiral grade', () => {
    const { runner } = sandbox();
    const result = runner.run('ramp spiral from:20,20 depth:10 grade:25 width:3 preview');
    expect(result.success).toBe(false);
    expect(result.output).toContain('19.6');
  });
});
