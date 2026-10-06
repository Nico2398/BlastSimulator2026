// @vitest-environment jsdom
// BlastSimulator2026 — tutorial games autosave to their own slot (#1333)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SavesModal, AUTO_SAVE_SLOT, TUTORIAL_AUTO_SAVE_SLOT, autoSaveSlotFor,
} from '../../../src/ui/panels/SavesModal.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import type { SaveBackend, SaveMeta } from '../../../src/core/state/SaveBackend.js';
import { t } from '../../../src/core/i18n/I18n.js';
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
  let save: ReturnType<typeof vi.fn<any[], Promise<void>>>;

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

describe('SavesModal list rendering of the tutorial slot (#1333)', () => {
  const makeModal = (metas: SaveMeta[]) => {
    const backend = {
      save: vi.fn(async () => {}), load: vi.fn(async () => null),
      list: vi.fn(async () => metas), delete: vi.fn(async () => {}),
    } as unknown as SaveBackend;
    const modal = new SavesModal(document.body);
    modal.setBackend(backend);
    return modal;
  };
  const card = (slot: string) => document.body.querySelector(`[data-slot="${slot}"]`) as HTMLElement | null;
  const actions = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-action]')).map(e => (e as HTMLElement).dataset['action']);

  beforeEach(() => { document.body.innerHTML = ''; });

  it('filled tutorial slot is an auto-style card: load only, auto chip, tutorial name', async () => {
    const modal = makeModal([{
      slotId: TUTORIAL_AUTO_SAVE_SLOT, name: 'x', timestamp: Date.now(), version: 1,
      campaignSummary: '', levelId: 'tutorial_pit',
    }]);
    modal.show();
    await flush();
    const c = card(TUTORIAL_AUTO_SAVE_SLOT)!;
    expect(c).not.toBeNull();
    expect(actions(c)).toEqual(['load']);
    expect(c.textContent).toContain(t('saveload.tutorial_auto_name'));
    expect(c.textContent).toContain(t('ui.saves.auto_chip'));
  });

  it('empty tutorial slot shows its own copy and no save-here button', async () => {
    const modal = makeModal([]);
    modal.show();
    await flush();
    const c = card(TUTORIAL_AUTO_SAVE_SLOT)!;
    expect(c.textContent).toContain(t('ui.saves.tutorial_auto_empty'));
    expect(actions(c)).toEqual([]);
  });

  it('lists auto, tutorial auto, then manual slots', async () => {
    const modal = makeModal([]);
    modal.show();
    await flush();
    const ids = Array.from(document.body.querySelectorAll('[data-slot]')).map(e => (e as HTMLElement).dataset['slot']);
    expect(ids.slice(0, 3)).toEqual([AUTO_SAVE_SLOT, TUTORIAL_AUTO_SAVE_SLOT, 'slot_1']);
  });
});
