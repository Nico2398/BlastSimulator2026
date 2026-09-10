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
import { CANVAS_READY_TIMEOUT_MS, resetOriginStorage } from '../../../../scripts/shared/puppeteer-utils.js';

/** Minimal CDP-capable page double: records what was sent and whether it detached. */
function fakePage(sendImpl?: () => Promise<void>) {
  const send = vi.fn(sendImpl ?? (async () => {}));
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
  it('clears every storage type for the dev server origin', async () => {
    const { page, send } = fakePage();

    await resetOriginStorage(page, 5173);

    expect(send).toHaveBeenCalledWith('Storage.clearDataForOrigin', {
      origin: 'http://localhost:5173',
      storageTypes: 'all',
    });
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
