// BlastSimulator2026 — createRunner's afterCommand re-classification guards (#1306)

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/core/engine/OrderReachability.js', async importOriginal => {
  const original = await importOriginal<typeof import('../../../src/core/engine/OrderReachability.js')>();
  return { ...original, refreshOrderReachability: vi.fn(original.refreshOrderReachability) };
});

import { createRunner } from '../../../src/console/createRunner.js';
import { refreshOrderReachability } from '../../../src/core/engine/OrderReachability.js';

const refresh = vi.mocked(refreshOrderReachability);

function startedRunner() {
  const { runner, ctx } = createRunner();
  expect(runner.run('campaign start level:tutorial_pit cash:250000')).toMatchObject({ success: true });
  return { runner, state: ctx.state! };
}

function queueOrder(runner: ReturnType<typeof createRunner>['runner']): void {
  expect(runner.run('build freight_warehouse at:1,8')).toMatchObject({ success: true });
}

describe('createRunner afterCommand (#1306)', () => {
  beforeEach(() => { refresh.mockClear(); });

  it('does nothing before any game exists', () => {
    const { runner } = createRunner();
    runner.run('help');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('re-classifies after a command while paused with an order queued', () => {
    const { runner, state } = startedRunner();
    state.isPaused = true;
    queueOrder(runner);
    refresh.mockClear();

    runner.run('employee hire role:driller');

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not re-classify while the game is running', () => {
    const { runner, state } = startedRunner();
    state.isPaused = true;
    queueOrder(runner);
    state.isPaused = false;
    refresh.mockClear();

    runner.run('employee hire role:driller');

    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not re-classify when nothing is queued', () => {
    const { runner, state } = startedRunner();
    state.isPaused = true;
    state.pendingActions.length = 0;
    refresh.mockClear();

    runner.run('employee hire role:driller');

    expect(refresh).not.toHaveBeenCalled();
  });

  it('skips a bare tick command, which classifies on its own', () => {
    const { runner, state } = startedRunner();
    state.isPaused = true;
    queueOrder(runner);
    refresh.mockClear();

    runner.run('tick');

    expect(refresh).not.toHaveBeenCalled();
  });
});
