import { describe, it, expect } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { emitHoleCellsChanged } from '../../../src/console/commands/mining/shared.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';

type Region = { minX: number; maxX: number; minZ: number; maxZ: number };

function collect(emitter: EventEmitter): Region[] {
  const regions: Region[] = [];
  emitter.on('nav:occupancy_changed', ({ region }) => { regions.push(region); });
  return regions;
}

describe('emitHoleCellsChanged (#1360)', () => {
  function setup() {
    const { runner, ctx } = createRunner();
    expect(runner.run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    return ctx;
  }

  it('emits nothing for an empty hole list', () => {
    const ctx = setup();
    const regions = collect(ctx.emitter);
    emitHoleCellsChanged(ctx, []);
    expect(regions).toHaveLength(0);
  });

  it('emits nothing when grid is null', () => {
    const emitter = new EventEmitter();
    const regions = collect(emitter);
    emitHoleCellsChanged({ emitter, grid: null }, [{ x: 5, z: 5 }]);
    expect(regions).toHaveLength(0);
  });

  it('emits one 1x1 region per hole at floored coordinates', () => {
    const ctx = setup();
    const regions = collect(ctx.emitter);
    emitHoleCellsChanged(ctx, [{ x: 15.7, z: 15.2 }, { x: 3, z: 9.99 }]);
    expect(regions).toHaveLength(2);
    expect(regions[0]).toMatchObject({ minX: 15, maxX: 15, minZ: 15, maxZ: 15 });
    expect(regions[1]).toMatchObject({ minX: 3, maxX: 3, minZ: 9, maxZ: 9 });
  });
});
