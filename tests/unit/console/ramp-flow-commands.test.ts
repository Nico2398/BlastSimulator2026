// BlastSimulator2026 — Console: ramp_flow id:N flow:both|down|up sets a built ramp's traffic direction.

import { describe, it, expect } from 'vitest';
import { rampFlowCommand, type MiningContext } from '../../../src/console/commands/mining.js';
import { createRunner } from '../../../src/console/createRunner.js';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';
import { makeGameContext } from '../../helpers/gameContext.js';

function makeCtx(): MiningContext {
  setLocale('en');
  const ctx = makeGameContext({ mineType: 'desert', seed: 1, size: 32 });
  ctx.state!.builtRamps.push({
    id: 3, def: { originX: 10, originZ: 5, direction: 'south', length: 12, targetDepth: 6, width: 3 }, width: 3,
    footprint: { minX: 9, maxX: 11, minZ: 5, maxZ: 16 },
  });
  return ctx;
}

describe('ramp_flow', () => {
  it('sets a built ramp down only, up only, and back to two-way', () => {
    const ctx = makeCtx();
    const down = rampFlowCommand(ctx, [], { id: '3', flow: 'down' });
    expect(down).toEqual({ success: true, output: t('mining.ramp_flow.set_down', { id: 3 }) });
    expect(ctx.state!.builtRamps[0]!.flow).toBe('down');
    expect(rampFlowCommand(ctx, [], { id: '3', flow: 'up' }).success).toBe(true);
    expect(ctx.state!.builtRamps[0]!.flow).toBe('up');
    expect(rampFlowCommand(ctx, [], { id: '3', flow: 'both' }).output).toBe(t('mining.ramp_flow.set_both', { id: 3 }));
    expect(ctx.state!.builtRamps[0]!.flow).toBeUndefined();
  });

  it('refuses a ramp that is not built, and leaves the others as they are', () => {
    const ctx = makeCtx();
    const r = rampFlowCommand(ctx, [], { id: '9', flow: 'down' });
    expect(r).toEqual({ success: false, output: t('mining.ramp_flow.not_found', { id: 9 }) });
    expect(ctx.state!.builtRamps[0]!.flow).toBeUndefined();
  });

  it('refuses a missing id or an unknown direction with the usage line', () => {
    const usage = t('mining.ramp_flow.usage', { options: 'both|down|up' });
    expect(rampFlowCommand(makeCtx(), [], { flow: 'down' })).toEqual({ success: false, output: usage });
    expect(rampFlowCommand(makeCtx(), [], { id: '3', flow: 'sideways' })).toEqual({ success: false, output: usage });
  });

  it('is registered on the console runner', () => {
    const engine = createRunner();
    expect(engine.runner.run('help').output).toContain('ramp_flow');
  });
});
