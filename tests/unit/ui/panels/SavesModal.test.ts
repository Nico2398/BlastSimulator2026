// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { SavesModal } from '../../../../src/ui/panels/SavesModal.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import type { SaveBackend, SaveMeta } from '../../../../src/core/state/SaveBackend.js';
import { AUTO_SAVE_INTERVAL_TICKS } from '../../../../src/core/config/balance.js';
import { serialize } from '../../../../src/core/state/SaveLoad.js';
import { t, setLocale } from '../../../../src/core/i18n/I18n.js';

function makeBackend(): SaveBackend & { store: Map<string, { meta: SaveMeta; data: string }> } {
  const store = new Map<string, { meta: SaveMeta; data: string }>();
  return {
    store,
    async save(slotId, name, data, summary, levelId) {
      store.set(slotId, { meta: { slotId, name, timestamp: Date.now(), version: 1, campaignSummary: summary, levelId }, data });
    },
    async load(slotId) {
      const entry = store.get(slotId);
      if (!entry) return null;
      return { meta: entry.meta, data: entry.data };
    },
    async list() {
      return [...store.values()].map(e => e.meta);
    },
    async delete(slotId) {
      store.delete(slotId);
    },
  };
}

function mount(): { container: HTMLDivElement; modal: SavesModal } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return { container, modal: new SavesModal(container) };
}

async function flush(): Promise<void> {
  await new Promise(r => setTimeout(r, 0));
}

describe('SavesModal', () => {
  afterEach(() => {
    setLocale('en');
  });

  it('carries a stable root id and is hidden by default', () => {
    const { container, modal } = mount();
    expect(container.querySelector('#bs-saves-modal')).not.toBeNull();
    expect(modal.visible).toBe(false);
    modal.dispose();
  });

  it('show/hide toggle visibility', () => {
    const { modal } = mount();
    modal.setBackend(makeBackend());
    modal.show();
    expect(modal.visible).toBe(true);
    modal.hide();
    expect(modal.visible).toBe(false);
    modal.dispose();
  });

  it('renders one card per slot (auto + 5 manual) when shown, none yet saved', async () => {
    const { container, modal } = mount();
    modal.setBackend(makeBackend());
    modal.show();
    await flush();
    const text = container.textContent ?? '';
    // No save has been made yet — the AUTO chip only appears once the auto
    // slot actually has data (see the dedicated auto-chip test below).
    expect(text).toContain(t('ui.saves.auto_empty'));
    // 5 empty manual slots, each rendered with its own "Slot N — empty" line.
    for (let n = 1; n <= 5; n++) {
      expect(text).toContain(t('ui.saves.slot_empty', { n }));
    }
    modal.dispose();
  });

  it('an empty slot shows SAVE HERE, not LOAD', async () => {
    const { container, modal } = mount();
    modal.setBackend(makeBackend());
    modal.show();
    await flush();
    const buttons = Array.from(container.querySelectorAll('button')).map(b => b.textContent);
    expect(buttons).toContain(t('ui.saves.save_here'));
  });

  it('a filled manual slot shows LOAD and a delete button, not SAVE HERE for that slot', async () => {
    const backend = makeBackend();
    await backend.save('slot_1', 'Slot 1', '{}', '$1,000 — Day 2', null);
    const { container, modal } = mount();
    modal.setBackend(backend);
    modal.show();
    await flush();

    const text = container.textContent ?? '';
    expect(text).toContain('$1,000 — Day 2');
    expect(container.querySelectorAll('bs-icon[name="trash"]').length).toBe(1);
    const loadButtons = Array.from(container.querySelectorAll('button')).filter(b => b.textContent === t('saveload.load'));
    expect(loadButtons.length).toBeGreaterThan(0);
    modal.dispose();
  });

  it('the auto slot never gets a delete button, even when saved', async () => {
    const backend = makeBackend();
    await backend.save('auto', 'Auto-Save', '{}', '$500 — Day 1', null);
    const { container, modal } = mount();
    modal.setBackend(backend);
    modal.show();
    await flush();
    expect(container.querySelectorAll('bs-icon[name="trash"]').length).toBe(0);
    // A filled auto slot carries the AUTO chip identifying it as the
    // automatic slot, distinct from a manually-saved one.
    expect(container.textContent).toContain(t('ui.saves.auto_chip'));
    modal.dispose();
  });

  it('resolves the real level name into the summary line for a campaign save', async () => {
    const backend = makeBackend();
    await backend.save('slot_1', 'Slot 1', '$80,000 — Day 5', 'dusty_hollow', 'dusty_hollow');
    const { container, modal } = mount();
    modal.setBackend(backend);
    modal.show();
    await flush();
    expect(container.textContent).toContain(t('level.dusty_hollow.name'));
    modal.dispose();
  });

  it('formats a very recent save as "just now"', async () => {
    // Mutate the stored timestamp directly rather than faking the clock —
    // fake timers would also stall flush()'s own real setTimeout(0).
    const backend = makeBackend();
    await backend.save('slot_1', 'Slot 1', 'data', '$1 — Day 1', null);
    backend.store.get('slot_1')!.meta.timestamp = Date.now();
    const { container, modal } = mount();
    modal.setBackend(backend);
    modal.show();
    await flush();
    expect(container.textContent).toContain(t('ui.saves.ago_now'));
    modal.dispose();
  });

  it('formats an older save in minutes', async () => {
    const backend = makeBackend();
    await backend.save('slot_1', 'Slot 1', 'data', '$1 — Day 1', null);
    backend.store.get('slot_1')!.meta.timestamp = Date.now() - 7 * 60_000;
    const { container, modal } = mount();
    modal.setBackend(backend);
    modal.show();
    await flush();
    expect(container.textContent).toContain(t('ui.saves.ago_minutes', { n: 7 }));
    modal.dispose();
  });

  it('triggers autoSave after AUTO_SAVE_INTERVAL_TICKS ticks', async () => {
    const backend = makeBackend();
    const state = createGame({ seed: 1, mineType: 'desert' });
    const { modal } = mount();
    modal.setBackend(backend);
    modal.setGetState(() => state);

    state.tickCount = 0;
    modal.onTick(state);
    await flush();
    expect(backend.store.has('auto')).toBe(true);

    backend.store.clear();
    state.tickCount = AUTO_SAVE_INTERVAL_TICKS - 1;
    modal.onTick(state);
    await flush();
    expect(backend.store.has('auto')).toBe(false);

    state.tickCount = AUTO_SAVE_INTERVAL_TICKS;
    modal.onTick(state);
    await flush();
    expect(backend.store.has('auto')).toBe(true);

    modal.dispose();
  });

  it('clicking SAVE HERE on an empty slot saves the live state into that slot', async () => {
    const backend = makeBackend();
    const state = createGame({ seed: 1, mineType: 'desert' });
    state.cash = 12345;
    const { container, modal } = mount();
    modal.setBackend(backend);
    modal.setGetState(() => state);
    modal.show();
    await flush();

    const saveHereBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === t('ui.saves.save_here'));
    saveHereBtn!.click();
    await flush();

    expect(backend.store.has('slot_1')).toBe(true);
    expect(backend.store.get('slot_1')!.meta.campaignSummary).toContain('12,345');
  });

  it('clicking SAVE HERE with no active game reports no_game rather than throwing', async () => {
    const backend = makeBackend();
    const { container, modal } = mount();
    modal.setBackend(backend);
    modal.setGetState(() => null);
    modal.show();
    await flush();

    const saveHereBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === t('ui.saves.save_here'));
    saveHereBtn!.click();
    await flush();

    expect(backend.store.has('slot_1')).toBe(false);
    expect(container.textContent).toContain(t('saveload.no_game'));
    modal.dispose();
  });

  it('clicking LOAD deserializes the slot and routes it through onLoad, then hides', async () => {
    const backend = makeBackend();
    const original = createGame({ seed: 7, mineType: 'desert' });
    original.cash = 99999;
    await backend.save('slot_1', 'Slot 1', serialize(original), '$99,999 — Day 1', null);

    const { container, modal } = mount();
    modal.setBackend(backend);
    let loaded: GameState | null = null;
    modal.setOnLoad((state) => { loaded = state; });
    modal.show();
    await flush();

    const loadBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === t('saveload.load'));
    loadBtn!.click();
    await flush();

    expect(loaded).not.toBeNull();
    expect(loaded!.cash).toBe(99999);
    expect(modal.visible).toBe(false);
    modal.dispose();
  });

  it('clicking the delete button removes the slot and re-renders without it', async () => {
    const backend = makeBackend();
    await backend.save('slot_1', 'Slot 1', '{}', '$1 — Day 1', null);
    const { container, modal } = mount();
    modal.setBackend(backend);
    modal.show();
    await flush();

    const deleteBtn = container.querySelector('bs-icon[name="trash"]')!.closest('button') as HTMLButtonElement;
    deleteBtn.click();
    await flush();

    expect(backend.store.has('slot_1')).toBe(false);
    expect(container.textContent).toContain(t('ui.saves.slot_empty', { n: 1 }));
    modal.dispose();
  });

  it('a locale refresh re-renders the static chrome and, while visible, the slot list', async () => {
    const backend = makeBackend();
    const { container, modal } = mount();
    modal.setBackend(backend);
    modal.show();
    await flush();
    expect(container.textContent).toContain('SAVED GAMES');

    setLocale('fr');
    modal.refreshLocale();
    await flush();

    expect(container.textContent).toContain('PARTIES SAUVEGARDÉES');
    modal.dispose();
  });

  it('dispose removes the modal from the DOM', () => {
    const { container, modal } = mount();
    modal.dispose();
    expect(container.querySelector('#bs-saves-modal')).toBeNull();
  });
});
