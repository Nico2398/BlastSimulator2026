// @vitest-environment jsdom
// BlastSimulator2026 — tutorial games autosave to their own slot (#1333)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SavesModal, AUTO_SAVE_SLOT, TUTORIAL_AUTO_SAVE_SLOT, autoSaveSlotFor,
} from '../../../src/ui/panels/SavesModal.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import type { SaveBackend } from '../../../src/core/state/SaveBackend.js';
import { AUTO_SAVE_INTERVAL_TICKS } from '../../../src/core/config/balance.js';

const flush = () => new Promise<void>(r => setTimeout(r, 0));

describe('autoSaveSlotFor', () => {
  it('constant is auto_tutorial', () => {
    expect(TUTORIAL_AUTO_SAVE_SLOT).toBe('auto_tutorial');
  });
  it('tutorial_pit -> auto_tutorial', () => {
    expect(autoSaveSlotFor('tutorial_pit')).toBe('auto_tutorial');
  });
  it.each(['level_1', 'sandbox', '', null, undefined])('%s -> auto', (id) => {
    expect(autoSaveSlotFor(id as string | null | undefined)).toBe(AUTO_SAVE_SLOT);
  });
});

describe('SavesModal autosave slot by level (#1333)', () => {
  let state: GameState;
  let modal: SavesModal;
  let save: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    state = createGame({ seed: 42 });
    state.tickCount = AUTO_SAVE_INTERVAL_TICKS * 3;
    save = vi.fn(async () => {});
    const backend = { save, load: vi.fn(async () => null), list: vi.fn(async () => []), delete: vi.fn(async () => {}) } as unknown as SaveBackend;
    modal = new SavesModal(document.body);
    modal.setBackend(backend);
    modal.setGetState(() => state);
  });

  it('onTick in the tutorial level writes auto_tutorial, never auto', async () => {
    state.campaign.activeLevelId = 'tutorial_pit';
    modal.onTick(state);
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0]).toBe('auto_tutorial');
  });

  it('quickSave in the tutorial level writes auto_tutorial', async () => {
    state.campaign.activeLevelId = 'tutorial_pit';
    await modal.quickSave();
    expect(save.mock.calls.map(c => c[0])).toEqual(['auto_tutorial']);
  });

  it('campaign onTick writes auto, never auto_tutorial', async () => {
    state.campaign.activeLevelId = 'level_1';
    modal.onTick(state);
    await flush();
    expect(save.mock.calls.map(c => c[0])).toEqual(['auto']);
  });

  it('campaign quickSave writes auto', async () => {
    state.campaign.activeLevelId = 'level_1';
    await modal.quickSave();
    expect(save.mock.calls.map(c => c[0])).toEqual(['auto']);
  });
});
