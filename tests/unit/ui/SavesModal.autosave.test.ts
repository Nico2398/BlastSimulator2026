// @vitest-environment jsdom
// BlastSimulator2026 — SavesModal never autosaves an ended game (#1313)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SavesModal, AUTO_SAVE_SLOT } from '../../../src/ui/panels/SavesModal.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import type { SaveBackend } from '../../../src/core/state/SaveBackend.js';
import { AUTO_SAVE_INTERVAL_TICKS } from '../../../src/core/config/balance.js';

function makeBackend() {
  const save = vi.fn(async () => {});
  const backend: SaveBackend = {
    save,
    load: vi.fn(async () => null),
    list: vi.fn(async () => []),
    delete: vi.fn(async () => {}),
  };
  return { backend, save };
}

const flush = () => new Promise<void>(r => setTimeout(r, 0));

describe('SavesModal autosave vs. level end (#1313)', () => {
  let state: GameState;
  let modal: SavesModal;
  let save: ReturnType<typeof makeBackend>['save'];

  beforeEach(() => {
    state = createGame({ seed: 42 });
    state.tickCount = AUTO_SAVE_INTERVAL_TICKS * 3;
    const b = makeBackend();
    save = b.save;
    modal = new SavesModal(document.body);
    modal.setBackend(b.backend);
    modal.setGetState(() => state);
  });

  it('onTick autosaves a running game', async () => {
    modal.onTick(state);
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0]).toBe(AUTO_SAVE_SLOT);
  });

  it('quickSave saves a running game', async () => {
    await modal.quickSave();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it.each(['completed', 'bankruptcy', 'arrest'] as const)('onTick does not write the auto slot after %s', async (reason) => {
    state.levelEnded = true;
    state.levelEndReason = reason;
    modal.onTick(state);
    await flush();
    expect(save).not.toHaveBeenCalled();
  });

  it('quickSave does not write the auto slot once the level ended', async () => {
    state.levelEnded = true;
    state.levelEndReason = 'completed';
    await modal.quickSave();
    expect(save).not.toHaveBeenCalled();
  });

  it('onTick does not advance lastAutoSaveTick while ended', async () => {
    state.levelEnded = true;
    state.levelEndReason = 'completed';
    modal.onTick(state);
    await flush();
    expect((modal as unknown as { lastAutoSaveTick: number }).lastAutoSaveTick).toBe(-AUTO_SAVE_INTERVAL_TICKS);
  });

  it('judges the state getState returns, not the one passed to onTick', async () => {
    const ended = createGame({ seed: 7 });
    ended.levelEnded = true;
    ended.levelEndReason = 'completed';
    modal.setGetState(() => ended);
    modal.onTick(state);
    await flush();
    expect(save).not.toHaveBeenCalled();
  });
});
