/**
 * Unit tests for the shared Puppeteer harness helpers (#1021, #1030).
 *
 * Both cover CI-harness reliability rather than game behaviour: the canvas
 * budget that whole interaction shards die on when it is too tight, and the
 * per-scenario storage reset that keeps one scenario's saved game out of the
 * next scenario in the same shard.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Page } from 'puppeteer';
import { CANVAS_READY_TIMEOUT_MS, resetOriginStorage, forceRenderFrame, executeInteractionActions } from '../../../../scripts/shared/puppeteer-utils.js';
import type { ScenarioStepDef } from '../../../../scripts/shared/scenario-types.js';

/** Minimal CDP-capable page double: records what was sent and whether it detached. */
function fakePage(sendImpl?: (method: string, params: { storageTypes: string }) => Promise<void>) {
  const send = vi.fn(sendImpl ?? (async (_method: string, _params: { storageTypes: string }) => {}));
  const detach = vi.fn(async () => {});
  const createCDPSession = vi.fn(async () => ({ send, detach }));
  return { page: { createCDPSession } as unknown as Page, send, detach, createCDPSession };
}

describe('CANVAS_READY_TIMEOUT_MS', () => {
  it('outlasts the cold starts that failed shards at 10s (#1021)', () => {
    // The four observed failures took 11s-13s to give up. A budget at or under
    // that is the bug being fixed, not a tighter version of the fix.
    expect(CANVAS_READY_TIMEOUT_MS).toBeGreaterThanOrEqual(20000);
  });
});

describe('resetOriginStorage', () => {
  it('clears the two storages the game persists into, for the dev server origin', async () => {
    const { page, send } = fakePage();

    await resetOriginStorage(page, 5173);

    expect(send).toHaveBeenCalledWith('Storage.clearDataForOrigin', {
      origin: 'http://localhost:5173',
      storageTypes: 'indexeddb,local_storage',
    });
  });

  it('leaves the shader and HTTP caches alone — they are shard-warmup, not scenario state', async () => {
    // 'all' drops those too, which made every scenario pay a cold recompile
    // and left sandbox-mode's blast report unsized under CI contention.
    const { page, send } = fakePage();

    await resetOriginStorage(page, 5173);

    const payload = send.mock.calls[0]![1];
    expect(payload.storageTypes).not.toBe('all');
    expect(payload.storageTypes).not.toMatch(/shader_cache|cache_storage/);
  });

  it('targets the port it was given, not a hardcoded one', async () => {
    const { page, send } = fakePage();

    await resetOriginStorage(page, 4321);

    expect(send).toHaveBeenCalledWith(
      'Storage.clearDataForOrigin',
      expect.objectContaining({ origin: 'http://localhost:4321' }),
    );
  });

  it('detaches the CDP session so a shard does not leak one per scenario', async () => {
    const { page, detach } = fakePage();

    await resetOriginStorage(page, 5173);

    expect(detach).toHaveBeenCalledTimes(1);
  });

  it('detaches even when the clear itself fails', async () => {
    const { page, detach } = fakePage(async () => {
      throw new Error('Storage.clearDataForOrigin refused');
    });

    await expect(resetOriginStorage(page, 5173)).rejects.toThrow('refused');
    expect(detach).toHaveBeenCalledTimes(1);
  });
});

describe('forceRenderFrame (#1244)', () => {
  it('calls page.evaluate once', async () => {
    const fakeEvaluatePage = { evaluate: vi.fn(async () => undefined) } as unknown as Page;

    await forceRenderFrame(fakeEvaluatePage);

    expect(fakeEvaluatePage.evaluate).toHaveBeenCalledTimes(1);
  });

  it('reaches window.__renderFrame through the evaluated function', async () => {
    // Not a DOM assertion (there is no real window here) — this pins the
    // bridge name so a future rename of the window hook shows up as a
    // failing test rather than a silent no-op in production.
    const fakeEvaluatePage = { evaluate: vi.fn(async () => undefined) } as unknown as Page;

    await forceRenderFrame(fakeEvaluatePage);

    const [fn] = (fakeEvaluatePage.evaluate as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(fn)).toContain('__renderFrame');
  });
});

describe('executeInteractionActions — excludeFromDeadline (#1224)', () => {
  /** Page double whose screenshot() records whether it ran inside the exclusion wrapper. */
  function capturePage() {
    const state = { inside: 0, screenshotsInside: [] as boolean[] };
    const page = {
      evaluate: vi.fn(async () => ({ gameState: null, uiState: null })),
      screenshot: vi.fn(async () => { state.screenshotsInside.push(state.inside > 0); }),
    } as unknown as Page;
    const excludeMock = vi.fn(async (work: () => Promise<unknown>): Promise<unknown> => {
      state.inside++;
      try { return await work(); } finally { state.inside--; }
    });
    const exclude = excludeMock as unknown as <T>(work: () => Promise<T>) => Promise<T>;
    return { page, state, exclude };
  }

  const step = (interaction: ScenarioStepDef['interaction']): ScenarioStepDef =>
    ({ command: 'tick 1', role: 'setup', ...(interaction !== undefined ? { interaction } : {}) });

  it('routes an inline screenshot capture through the wrapper', async () => {
    const { page, state, exclude } = capturePage();
    await executeInteractionActions(
      page, step([{ type: 'screenshot' }]), true, '/tmp/out', '00', 'tick',
      undefined, undefined, exclude,
    );
    expect(exclude).toHaveBeenCalledTimes(1);
    expect(state.screenshotsInside).toEqual([true]);
  });

  it('wraps each inline screenshot separately', async () => {
    const { page, state, exclude } = capturePage();
    const r = await executeInteractionActions(
      page, step([{ type: 'screenshot' }, { type: 'wait', durationMs: 0 }, { type: 'screenshot' }]),
      true, '/tmp/out', '00', 'tick', undefined, undefined, exclude,
    );
    expect(exclude).toHaveBeenCalledTimes(2);
    expect(state.screenshotsInside).toEqual([true, true]);
    expect(r.screenshotPaths).toHaveLength(2);
  });

  it('does not wrap actions other than screenshot', async () => {
    const { page, exclude } = capturePage();
    await executeInteractionActions(
      page, step([{ type: 'wait', durationMs: 0 }]), true, '/tmp/out', '00', 'tick',
      undefined, undefined, exclude,
    );
    expect(exclude).not.toHaveBeenCalled();
  });

  it('does not call the wrapper when screenshots are disabled', async () => {
    const { page, exclude } = capturePage();
    await executeInteractionActions(
      page, step([{ type: 'screenshot' }]), false, '/tmp/out', '00', 'tick',
      undefined, undefined, exclude,
    );
    expect(exclude).not.toHaveBeenCalled();
  });

  it('captures as before when the wrapper is omitted', async () => {
    const { page, state } = capturePage();
    const r = await executeInteractionActions(
      page, step([{ type: 'screenshot' }]), true, '/tmp/out', '00', 'tick',
    );
    expect(state.screenshotsInside).toEqual([false]);
    expect(r.screenshotPaths).toHaveLength(1);
  });
});
