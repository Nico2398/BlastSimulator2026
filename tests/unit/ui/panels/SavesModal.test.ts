// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { SavesModal } from '../../../../src/ui/panels/SavesModal.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import type { SaveBackend, SaveMeta } from '../../../../src/core/state/SaveBackend.js';
import { AUTO_SAVE_INTERVAL_TICKS } from '../../../../src/core/config/balance.js';
import { serialize } from '../../../../src/core/state/SaveLoad.js';
import type { ConfirmModalConfig } from '../../../../src/ui/panels/ConfirmModal.js';
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

  describe('autosave baseline on state swap (#1316)', () => {
    function setup() {
      const backend = makeBackend();
      const a = createGame({ seed: 1, mineType: 'desert' });
      a.cash = 111;
      const b = createGame({ seed: 1, mineType: 'desert' });
      b.cash = 222;
      let current: GameState = a;
      const { modal } = mount();
      modal.setBackend(backend);
      modal.setGetState(() => current);
      const tick = async (s: GameState, n: number) => {
        s.tickCount = n;
        current = s;
        modal.onTick(s);
        await flush();
      };
      return { backend, a, b, modal, tick };
    }

    it('autosaves at once when a fresh state at tick 0 replaces one at tick 2000, then every interval', async () => {
      const { backend, a, b, modal, tick } = setup();
      await tick(a, 2000);
      expect(backend.store.has('auto')).toBe(true);

      backend.store.clear();
      await tick(b, 0);
      expect(backend.store.has('auto')).toBe(true);
      expect(backend.store.get('auto')!.meta.campaignSummary).toContain('222');

      backend.store.clear();
      await tick(b, AUTO_SAVE_INTERVAL_TICKS - 1);
      expect(backend.store.has('auto')).toBe(false);

      b.cash = 333;
      await tick(b, AUTO_SAVE_INTERVAL_TICKS);
      expect(backend.store.has('auto')).toBe(true);
      expect(backend.store.get('auto')!.meta.campaignSummary).toContain('333');
      modal.dispose();
    });

    it('saves exactly once on a swap to a higher tick, then waits a full interval', async () => {
      const { backend, a, b, modal, tick } = setup();
      await tick(a, 100);
      const saveSpy = vi.spyOn(backend, 'save');
      saveSpy.mockClear();

      await tick(b, 5000);
      expect(saveSpy).toHaveBeenCalledTimes(1);

      await tick(b, 5000 + AUTO_SAVE_INTERVAL_TICKS - 1);
      expect(saveSpy).toHaveBeenCalledTimes(1);

      await tick(b, 5000 + AUTO_SAVE_INTERVAL_TICKS);
      expect(saveSpy).toHaveBeenCalledTimes(2);
      modal.dispose();
    });

    it('never re-baselines while the same state object keeps ticking', async () => {
      const { backend, a, modal, tick } = setup();
      await tick(a, 0);
      const saveSpy = vi.spyOn(backend, 'save');
      saveSpy.mockClear();

      for (const n of [1, 50, 150, AUTO_SAVE_INTERVAL_TICKS - 1]) await tick(a, n);
      expect(saveSpy).not.toHaveBeenCalled();

      await tick(a, AUTO_SAVE_INTERVAL_TICKS);
      expect(saveSpy).toHaveBeenCalledTimes(1);
      await tick(a, AUTO_SAVE_INTERVAL_TICKS + 1);
      expect(saveSpy).toHaveBeenCalledTimes(1);
      modal.dispose();
    });
  });

  it('auto-save and quick-save write the getState snapshot, not the bare state onTick was handed', async () => {
    const backend = makeBackend();
    const live = createGame({ seed: 1, mineType: 'desert' });
    live.cash = 1;
    const snapshot = { ...live, cash: 777 };
    const { modal } = mount();
    modal.setBackend(backend);
    modal.setGetState(() => snapshot);

    live.tickCount = 0;
    modal.onTick(live);
    await flush();
    expect(backend.store.get('auto')!.meta.campaignSummary).toContain('777');

    backend.store.clear();
    await modal.quickSave();
    expect(backend.store.get('auto')!.meta.campaignSummary).toContain('777');
    modal.dispose();
  });

  it('auto-save writes nothing when there is no game to snapshot', async () => {
    const backend = makeBackend();
    const live = createGame({ seed: 1, mineType: 'desert' });
    const { modal } = mount();
    modal.setBackend(backend);
    modal.setGetState(() => null);
    live.tickCount = 0;
    modal.onTick(live);
    await flush();
    expect(backend.store.has('auto')).toBe(false);
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
    expect(modal.visible).toBe(false);
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
    modal.setOnLoad((state) => { loaded = state; return null; });
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

  // Issue #1315: load outcome contract. onLoad returns null (loaded) or a refusal reason.
  describe('load outcome (#1315)', () => {
    async function setup(onLoad: (s: GameState) => string | null, slot = true) {
      const backend = makeBackend();
      if (slot) {
        const original = createGame({ seed: 7, mineType: 'desert' });
        original.cash = 4242;
        await backend.save('slot_1', 'Slot 1', serialize(original), '$4,242 — Day 1', null);
      }
      const { container, modal } = mount();
      modal.setBackend(backend);
      const calls: GameState[] = [];
      modal.setOnLoad((s) => { calls.push(s); return onLoad(s); });
      return { backend, container, modal, calls };
    }
    const statusOf = (modal: SavesModal): string =>
      (modal as unknown as { statusEl: HTMLElement }).statusEl.textContent ?? '';

    const colorOf = (modal: SavesModal): string =>
      (modal as unknown as { statusEl: HTMLElement }).statusEl.style.color;

    afterEach(() => { vi.useRealTimers(); });

    it('success: onLoad called once, modal hides, status says loaded, returns true', async () => {
      const { modal, calls } = await setup(() => null);
      modal.show();
      await flush();
      const result = await modal.loadFromSlot('slot_1');
      expect(result).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.cash).toBe(4242);
      expect(modal.visible).toBe(false);
      expect(statusOf(modal)).toBe(t('saveload.loaded'));
      modal.dispose();
    });

    it('refusal: modal stays visible, status carries the reason, no loaded status, returns false', async () => {
      const { modal } = await setup(() => 'level is locked');
      modal.show();
      await flush();
      const result = await modal.loadFromSlot('slot_1');
      expect(result).toBe(false);
      expect(modal.visible).toBe(true);
      expect(statusOf(modal)).toBe(t('saveload.load_refused', { reason: 'level is locked' }));
      expect(statusOf(modal)).not.toBe(t('saveload.loaded'));
      modal.dispose();
    });

    it('refusal status persists past the 4s auto-clear', async () => {
      const { modal } = await setup(() => 'level is locked');
      modal.show();
      await flush();
      vi.useFakeTimers();
      await modal.loadFromSlot('slot_1');
      vi.advanceTimersByTime(10_000);
      expect(statusOf(modal)).toContain('level is locked');
      modal.dispose();
    });

    it('refusal clicked through the real Load button leaves the modal open with the reason', async () => {
      const { modal } = await setup(() => 'nope');
      modal.show();
      await flush();
      modal.root.querySelector<HTMLButtonElement>('[data-slot="slot_1"] [data-action="load"]')!.click();
      await flush();
      expect(modal.visible).toBe(true);
      expect(statusOf(modal)).toContain('nope');
      modal.dispose();
    });

    it('missing slot: modal stays visible with not_found, onLoad never called, returns false', async () => {
      const { modal, calls } = await setup(() => null, false);
      modal.show();
      await flush();
      const result = await modal.loadFromSlot('slot_3');
      expect(result).toBe(false);
      expect(calls).toHaveLength(0);
      expect(modal.visible).toBe(true);
      expect(statusOf(modal)).toBe(t('saveload.not_found'));
      modal.dispose();
    });

    it('corrupt slot data: modal stays visible with saveload.error, returns false', async () => {
      const { backend, modal, calls } = await setup(() => null);
      await backend.save('slot_2', 'Slot 2', 'not json {{{', 'x', null);
      modal.show();
      await flush();
      const result = await modal.loadFromSlot('slot_2');
      expect(result).toBe(false);
      expect(calls).toHaveLength(0);
      expect(modal.visible).toBe(true);
      expect(statusOf(modal)).toContain(t('saveload.error', { msg: '' }).replace(/\s+$/, ''));
      expect(statusOf(modal)).toContain('SyntaxError');
      expect(colorOf(modal)).toBe('var(--bsx-critical-text)');
      modal.dispose();
    });

    it('a refusal while the modal is hidden (CONTINUE path) makes it visible', async () => {
      const { modal } = await setup(() => 'level is locked');
      expect(modal.visible).toBe(false);
      const result = await modal.loadFromSlot('slot_1');
      expect(result).toBe(false);
      expect(modal.visible).toBe(true);
      expect(statusOf(modal)).toContain('level is locked');
      modal.dispose();
    });

    it('a failure while the modal is hidden also makes it visible', async () => {
      const { modal } = await setup(() => null, false);
      const result = await modal.loadFromSlot('slot_1');
      expect(result).toBe(false);
      expect(modal.visible).toBe(true);
      modal.dispose();
    });

    it('returns false without a backend or onLoad', async () => {
      const { modal } = mount();
      expect(await modal.loadFromSlot('slot_1')).toBe(false);
      modal.dispose();
    });

    it('returns false when a backend is set but onLoad is missing', async () => {
      const { modal } = mount();
      modal.setBackend(makeBackend());
      expect(await modal.loadFromSlot('slot_1')).toBe(false);
      modal.dispose();
    });

    it('a second loadFromSlot while one is in flight returns false and does not call onLoad twice', async () => {
      const { modal, calls } = await setup(() => null);
      const first = modal.loadFromSlot('slot_1');
      const second = await modal.loadFromSlot('slot_1');
      expect(second).toBe(false);
      expect(await first).toBe(true);
      expect(calls).toHaveLength(1);
      modal.dispose();
    });

    it('hide() clears a persistent error status', async () => {
      const { modal } = await setup(() => 'level is locked');
      await modal.loadFromSlot('slot_1');
      expect(statusOf(modal)).toContain('level is locked');
      modal.hide();
      expect(statusOf(modal)).toBe('');
      modal.dispose();
    });

    it('a success status is positive-coloured; a refusal is critical-coloured', async () => {
      const ok = await setup(() => null);
      await ok.modal.loadFromSlot('slot_1');
      expect(colorOf(ok.modal)).toBe('var(--bsx-positive)');
      ok.modal.dispose();
      const bad = await setup(() => 'nope');
      await bad.modal.loadFromSlot('slot_1');
      expect(colorOf(bad.modal)).toBe('var(--bsx-critical-text)');
      bad.modal.dispose();
    });

    it('a failing save reports saveload.error in the critical colour', async () => {
      const { backend, modal } = await setup(() => null);
      backend.save = async () => { throw new Error('disk full'); };
      modal.setGetState(() => createGame({ seed: 1, mineType: 'desert' }));
      modal.show();
      await flush();
      modal.root.querySelector<HTMLButtonElement>('[data-slot="slot_2"] [data-action="save-here"]')!.click();
      await flush();
      expect(statusOf(modal)).toContain('disk full');
      expect(colorOf(modal)).toBe('var(--bsx-critical-text)');
      modal.dispose();
    });

    it('save with no active game reports no_game in the critical colour', async () => {
      const { modal } = await setup(() => null);
      modal.setGetState(() => null);
      modal.show();
      await flush();
      modal.root.querySelector<HTMLButtonElement>('[data-slot="slot_2"] [data-action="save-here"]')!.click();
      await flush();
      expect(statusOf(modal)).toBe(t('saveload.no_game'));
      expect(colorOf(modal)).toBe('var(--bsx-critical-text)');
      modal.dispose();
    });

    describe('import', () => {
      async function importFile(modal: SavesModal, content: string): Promise<void> {
        const input = modal.root.querySelector<HTMLInputElement>('input[type="file"]')!;
        const file = new File([content], 'save.json', { type: 'application/json' });
        Object.defineProperty(input, 'files', { value: [file], configurable: true });
        input.dispatchEvent(new Event('change'));
        await new Promise(r => setTimeout(r, 50));
      }

      it('success: hides and shows imported status', async () => {
        const { modal, calls } = await setup(() => null);
        const original = createGame({ seed: 3, mineType: 'desert' });
        modal.show();
        await importFile(modal, serialize(original));
        expect(calls).toHaveLength(1);
        expect(modal.visible).toBe(false);
        expect(statusOf(modal)).toBe(t('saveload.imported'));
        modal.dispose();
      });

      it('refusal: stays visible with the reason, no imported status', async () => {
        const { modal } = await setup(() => 'level is locked');
        const original = createGame({ seed: 3, mineType: 'desert' });
        modal.show();
        await importFile(modal, serialize(original));
        expect(modal.visible).toBe(true);
        expect(statusOf(modal)).toContain('level is locked');
        expect(statusOf(modal)).not.toBe(t('saveload.imported'));
        modal.dispose();
      });

      it('corrupt file: shows the modal with a persistent critical saveload.error, onLoad never called', async () => {
        const { modal, calls } = await setup(() => null);
        await importFile(modal, 'not json {{{');
        expect(calls).toHaveLength(0);
        expect(modal.visible).toBe(true);
        expect(statusOf(modal)).toContain('SyntaxError');
        expect(colorOf(modal)).toBe('var(--bsx-critical-text)');
        modal.dispose();
      });

      it('refusal while hidden makes the modal visible', async () => {
        const { modal } = await setup(() => 'level is locked');
        const original = createGame({ seed: 3, mineType: 'desert' });
        await importFile(modal, serialize(original));
        expect(modal.visible).toBe(true);
        modal.dispose();
      });
    });
  });

  // These slots already carried `data-slot` + `data-action` (save-here/load/
  // delete) before the selector sweep; the names are load-bearing for
  // save-load-visual.json and i18n-live-locale-switch.json, so they are pinned
  // here rather than renamed. `:not([data-action])` is how the latter isolates
  // the close button — that only holds while every slot button carries one.
  describe('stable selectors', () => {
    // Queries run from `modal.root` rather than through `#bs-saves-modal …`:
    // earlier tests in this file leave their (disposed but still id-bearing)
    // containers in document.body, and an id-prefixed selector resolves
    // against the first match in the document, not this modal. `root.id` is
    // asserted once so the selectors below still stand for the real
    // `#bs-saves-modal [data-slot="…"] [data-action="…"]` a scenario clicks.
    it('every empty manual slot is addressable by slot id, and the auto slot offers no save button', async () => {
      const { container, modal } = mount();
      modal.setBackend(makeBackend());
      modal.show();
      await flush();
      const root = modal.root;
      expect(root.id).toBe('bs-saves-modal');

      for (let n = 1; n <= 5; n++) {
        expect(
          root.querySelector(`[data-slot="slot_${n}"] [data-action="save-here"]`),
          `no save-here button for slot_${n}`,
        ).not.toBeNull();
      }
      expect(root.querySelector('[data-slot="auto"]')).not.toBeNull();
      expect(root.querySelector('[data-slot="auto"] [data-action="save-here"]')).toBeNull();
      modal.dispose();
      container.remove();
    });

    it('saving through one slot\'s selector writes that slot, not the first one', async () => {
      const backend = makeBackend();
      const state = createGame({ seed: 1, mineType: 'desert' });
      state.cash = 777;
      const { container, modal } = mount();
      modal.setBackend(backend);
      modal.setGetState(() => state);
      modal.show();
      await flush();

      modal.root.querySelector<HTMLButtonElement>('[data-slot="slot_3"] [data-action="save-here"]')!.click();
      await flush();
      expect(backend.store.has('slot_3')).toBe(true);
      expect(backend.store.has('slot_1')).toBe(false);
      modal.dispose();
      container.remove();
    });

    it('a filled slot exposes load and delete under its own data-slot', async () => {
      const backend = makeBackend();
      const state = createGame({ seed: 1, mineType: 'desert' });
      await backend.save('slot_2', 'Slot 2', serialize(state), '$1,000 — Day 2', null);
      let loaded: GameState | null = null;
      const { container, modal } = mount();
      modal.setBackend(backend);
      modal.setOnLoad(s => { loaded = s; return null; });
      modal.show();
      await flush();

      expect(modal.root.querySelector('[data-slot="slot_2"] [data-action="save-here"]')).toBeNull();
      modal.root.querySelector<HTMLButtonElement>('[data-slot="slot_2"] [data-action="load"]')!.click();
      await flush();
      expect(loaded).not.toBeNull();

      modal.show();
      await flush();
      modal.root.querySelector<HTMLButtonElement>('[data-slot="slot_2"] [data-action="delete"]')!.click();
      await flush();
      expect(backend.store.has('slot_2')).toBe(false);
      modal.dispose();
      container.remove();
    });

    it('the close button stays the only data-action-less button ahead of the slot list', async () => {
      const backend = makeBackend();
      const state = createGame({ seed: 1, mineType: 'desert' });
      await backend.save('slot_1', 'Slot 1', serialize(state), '$1,000 — Day 2', null);
      const { container, modal } = mount();
      modal.setBackend(backend);
      modal.show();
      await flush();

      // i18n-live-locale-switch.json closes this modal with
      // `#bs-saves-modal button:not([data-action])` — export/import are also
      // action-less, so that selector only works while the close button comes
      // first in DOM order.
      const bare = modal.root.querySelectorAll<HTMLButtonElement>('button:not([data-action])');
      expect(bare.length).toBeGreaterThan(0);
      expect(bare[0]!.querySelector('bs-icon[name="x"]')).not.toBeNull();
      bare[0]!.click();
      expect(modal.visible).toBe(false);
      modal.dispose();
      container.remove();
    });
  });

  // Issue #1325: fallback notice, visible failures, overwrite/delete/load confirms.
  describe('fallback, failures and confirmations (#1325)', () => {
    const statusOf = (modal: SavesModal): string =>
      (modal as unknown as { statusEl: HTMLElement }).statusEl.textContent ?? '';

    const colorOf = (modal: SavesModal): string =>
      (modal as unknown as { statusEl: HTMLElement }).statusEl.style.color;

    function failingBackend(failing: { on: boolean }): SaveBackend {
      const inner = makeBackend();
      return {
        ...inner,
        async save(...args: Parameters<SaveBackend['save']>) {
          if (failing.on) throw new Error('quota');
          return inner.save(...args);
        },
      };
    }

    async function filledSetup(opts: { getState?: (() => GameState | null) | null; handler?: boolean } = {}) {
      const backend = makeBackend();
      const original = createGame({ seed: 7, mineType: 'desert' });
      original.cash = 4242;
      await backend.save('slot_1', 'Slot 1', serialize(original), '$4,242 — Day 1', null);
      const { container, modal } = mount();
      modal.setBackend(backend);
      const live = createGame({ seed: 3, mineType: 'desert' });
      live.cash = 777;
      if (opts.getState !== null) modal.setGetState(opts.getState ?? (() => live));
      const configs: ConfirmModalConfig[] = [];
      if (opts.handler !== false) modal.setConfirmHandler(c => { configs.push(c); });
      const loaded: GameState[] = [];
      modal.setOnLoad(s => { loaded.push(s); return null; });
      modal.show();
      await flush();
      return { backend, container, modal, configs, loaded, live };
    }

    const click = (modal: SavesModal, sel: string): void => {
      modal.root.querySelector<HTMLButtonElement>(sel)!.click();
    };

    describe('fallback notice', () => {
      it('memory kind shows the fallback notice', async () => {
        const { container, modal } = mount();
        modal.setBackend(makeBackend());
        modal.setBackendKind('memory');
        modal.show();
        await flush();
        expect(modal.root.textContent).toContain(t('ui.saves.fallback_notice'));
        modal.dispose();
        container.remove();
      });

      it('indexeddb kind shows no fallback notice', async () => {
        const { container, modal } = mount();
        modal.setBackend(makeBackend());
        modal.setBackendKind('indexeddb');
        modal.show();
        await flush();
        expect(modal.root.textContent).not.toContain(t('ui.saves.fallback_notice'));
        modal.dispose();
        container.remove();
      });

      it('no kind set shows no fallback notice', async () => {
        const { container, modal } = mount();
        modal.setBackend(makeBackend());
        modal.show();
        await flush();
        expect(modal.root.textContent).not.toContain(t('ui.saves.fallback_notice'));
        modal.dispose();
        container.remove();
      });

      it('saving in memory mode reports a session-only save', async () => {
        const state = createGame({ seed: 1, mineType: 'desert' });
        const { container, modal } = mount();
        modal.setBackend(makeBackend());
        modal.setBackendKind('memory');
        modal.setGetState(() => state);
        modal.show();
        await flush();
        click(modal, '[data-slot="slot_1"] [data-action="save-here"]');
        await flush();
        expect(statusOf(modal)).toBe(t('saveload.saved_session_only'));
        modal.dispose();
        container.remove();
      });

      it('saving in indexeddb mode keeps the plain saved status', async () => {
        const state = createGame({ seed: 1, mineType: 'desert' });
        const { container, modal } = mount();
        modal.setBackend(makeBackend());
        modal.setBackendKind('indexeddb');
        modal.setGetState(() => state);
        modal.show();
        await flush();
        click(modal, '[data-slot="slot_1"] [data-action="save-here"]');
        await flush();
        expect(statusOf(modal)).toBe(t('saveload.saved'));
        modal.dispose();
        container.remove();
      });
    });

    describe('autosave failure visibility', () => {
      async function autosaveSetup() {
        const failing = { on: true };
        const { container, modal } = mount();
        modal.setBackend(failingBackend(failing));
        const state = createGame({ seed: 1, mineType: 'desert' });
        modal.setGetState(() => state);
        return { failing, container, modal, state };
      }

      it('a failed autosave shows the failure in the critical colour', async () => {
        const { modal, state } = await autosaveSetup();
        modal.onTick(state);
        await flush();
        expect(statusOf(modal)).toBe(t('ui.saves.autosave_failed'));
        expect(colorOf(modal)).toBe('var(--bsx-critical-text)');
      });

      it('a failed quick-save shows the failure too', async () => {
        const { modal } = await autosaveSetup();
        await modal.quickSave();
        expect(statusOf(modal)).toBe(t('ui.saves.autosave_failed'));
      });

      it('timed autosave shows the failure once per streak: a second failure does not re-announce it', async () => {
        const { modal } = await autosaveSetup();
        const tick = (n: number) => ({ ...createGame({ seed: 1, mineType: 'desert' }), tickCount: n });
        const first = tick(0);
        modal.onTick(first);
        await flush();
        expect(statusOf(modal)).toBe(t('ui.saves.autosave_failed'));
        (modal as unknown as { statusEl: HTMLElement }).statusEl.textContent = '';
        modal.onTick({ ...first, tickCount: AUTO_SAVE_INTERVAL_TICKS });
        await flush();
        expect(statusOf(modal)).toBe('');
      });

      it('a quick-save failure always reports, even within a failure streak', async () => {
        const { modal } = await autosaveSetup();
        await modal.quickSave();
        expect(statusOf(modal)).toBe(t('ui.saves.autosave_failed'));
        (modal as unknown as { statusEl: HTMLElement }).statusEl.textContent = '';
        await modal.quickSave();
        expect(statusOf(modal)).toBe(t('ui.saves.autosave_failed'));
      });

      it('onAutoSaveFailed fires once per autosave streak and on every quick-save failure', async () => {
        const { failing, modal, state } = await autosaveSetup();
        const cb = vi.fn();
        modal.setOnAutoSaveFailed(cb);
        modal.onTick(state);
        await flush();
        modal.onTick({ ...state, tickCount: AUTO_SAVE_INTERVAL_TICKS });
        await flush();
        expect(cb).toHaveBeenCalledTimes(1);
        await modal.quickSave();
        await modal.quickSave();
        expect(cb).toHaveBeenCalledTimes(3);
        failing.on = false;
        await modal.quickSave();
        failing.on = true;
        modal.onTick({ ...state, tickCount: AUTO_SAVE_INTERVAL_TICKS * 2 });
        await flush();
        expect(cb).toHaveBeenCalledTimes(4);
      });

      it('a quick-save success on the memory fallback says it is session-only', async () => {
        const { failing, modal } = await autosaveSetup();
        failing.on = false;
        modal.setBackendKind('memory');
        await modal.quickSave();
        expect(statusOf(modal)).toBe(t('saveload.saved_session_only'));
      });

      it('the next successful autosave clears the failure, and a later failure shows again', async () => {
        const { failing, modal } = await autosaveSetup();
        await modal.quickSave();
        expect(statusOf(modal)).toBe(t('ui.saves.autosave_failed'));
        failing.on = false;
        await modal.quickSave();
        expect(statusOf(modal)).not.toBe(t('ui.saves.autosave_failed'));
        failing.on = true;
        await modal.quickSave();
        expect(statusOf(modal)).toBe(t('ui.saves.autosave_failed'));
      });

      it('a successful autosave never touches an unrelated status', async () => {
        const { failing, modal, state } = await autosaveSetup();
        failing.on = false;
        (modal as unknown as { statusEl: HTMLElement }).statusEl.textContent = 'other';
        modal.onTick(state);
        await flush();
        expect(statusOf(modal)).toBe('other');
      });
    });

    describe('backend.list() rejection', () => {
      function listFailing(): SaveBackend {
        return { ...makeBackend(), async list() { throw new Error('idb dead'); } };
      }

      it('show() with a rejecting list produces no unhandled rejection', async () => {
        const seen: unknown[] = [];
        const onRej = (e: unknown): void => { seen.push(e); };
        process.on('unhandledRejection', onRej);
        try {
          const { container, modal } = mount();
          modal.setBackend(listFailing());
          modal.show();
          await flush();
          await flush();
          expect(seen).toEqual([]);
          expect(modal.visible).toBe(true);
          modal.dispose();
          container.remove();
        } finally {
          process.off('unhandledRejection', onRej);
        }
      });

      it('refreshLocale() with a rejecting list produces no unhandled rejection', async () => {
        const seen: unknown[] = [];
        const onRej = (e: unknown): void => { seen.push(e); };
        process.on('unhandledRejection', onRej);
        try {
          const { container, modal } = mount();
          modal.setBackend(listFailing());
          modal.show();
          await flush();
          modal.refreshLocale();
          await flush();
          await flush();
          expect(seen).toEqual([]);
          modal.dispose();
          container.remove();
        } finally {
          process.off('unhandledRejection', onRej);
        }
      });

      it('a rejecting list is reported in the critical colour', async () => {
        const { container, modal } = mount();
        modal.setBackend(listFailing());
        modal.show();
        await flush();
        expect(statusOf(modal)).toContain('idb dead');
        expect(colorOf(modal)).toBe('var(--bsx-critical-text)');
        modal.dispose();
        container.remove();
      });
    });

    describe('overwrite', () => {
      it('a filled manual slot offers OVERWRITE, an empty one does not', async () => {
        const { modal } = await filledSetup();
        expect(modal.root.querySelector('[data-slot="slot_1"] [data-action="overwrite"]')).not.toBeNull();
        expect(modal.root.querySelector('[data-slot="slot_2"] [data-action="overwrite"]')).toBeNull();
      });

      it('the auto slot never offers OVERWRITE', async () => {
        const { backend, modal } = await filledSetup();
        const live = createGame({ seed: 1, mineType: 'desert' });
        await backend.save('auto', 'Auto-Save', serialize(live), '$1 — Day 1', null);
        modal.show();
        await flush();
        expect(modal.root.querySelector('[data-slot="auto"] [data-action="overwrite"]')).toBeNull();
      });

      it('clicking OVERWRITE asks the confirm handler once and writes nothing yet', async () => {
        const { backend, modal, configs } = await filledSetup();
        const before = backend.store.get('slot_1')!.data;
        click(modal, '[data-slot="slot_1"] [data-action="overwrite"]');
        await flush();
        expect(configs).toHaveLength(1);
        expect(configs[0]!.title).toBe(t('ui.saves.confirm_overwrite_title'));
        expect(configs[0]!.body).toBe(t('ui.saves.confirm_overwrite_body'));
        expect(configs[0]!.confirmLabel).toBe(t('ui.saves.overwrite'));
        expect(backend.store.get('slot_1')!.data).toBe(before);
      });

      it('invoking onConfirm replaces the slot content with the live state', async () => {
        const { backend, modal, configs, live } = await filledSetup();
        const before = backend.store.get('slot_1')!.data;
        click(modal, '[data-slot="slot_1"] [data-action="overwrite"]');
        configs[0]!.onConfirm();
        await flush();
        const after = backend.store.get('slot_1')!.data;
        expect(after).not.toBe(before);
        expect(after).toBe(serialize(live));
        expect(backend.store.get('slot_1')!.meta.campaignSummary).toContain('777');
      });

      it('SAVE HERE on an empty slot writes without asking for confirmation', async () => {
        const { backend, modal, configs } = await filledSetup();
        click(modal, '[data-slot="slot_2"] [data-action="save-here"]');
        await flush();
        expect(configs).toHaveLength(0);
        expect(backend.store.has('slot_2')).toBe(true);
      });
    });

    describe('delete', () => {
      it('with a confirm handler, Delete asks first and removes only after onConfirm', async () => {
        const { backend, modal, configs } = await filledSetup();
        click(modal, '[data-slot="slot_1"] [data-action="delete"]');
        await flush();
        expect(configs).toHaveLength(1);
        expect(configs[0]!.title).toBe(t('ui.saves.confirm_delete_title'));
        expect(configs[0]!.body).toBe(t('ui.saves.confirm_delete_body'));
        expect(backend.store.has('slot_1')).toBe(true);
        configs[0]!.onConfirm();
        await flush();
        expect(backend.store.has('slot_1')).toBe(false);
        expect(modal.root.querySelector('[data-slot="slot_1"] [data-action="save-here"]')).not.toBeNull();
      });

      it('without a confirm handler, Delete acts directly', async () => {
        const { backend, modal } = await filledSetup({ handler: false });
        click(modal, '[data-slot="slot_1"] [data-action="delete"]');
        await flush();
        expect(backend.store.has('slot_1')).toBe(false);
      });

      it('a failing delete shows an error status and does not reject', async () => {
        const { backend, modal, configs } = await filledSetup();
        backend.delete = async () => { throw new Error('locked'); };
        click(modal, '[data-slot="slot_1"] [data-action="delete"]');
        configs[0]!.onConfirm();
        await flush();
        await flush();
        expect(statusOf(modal)).toContain(t('saveload.delete_error'));
        expect(colorOf(modal)).toBe('var(--bsx-critical-text)');
      });
    });

    describe('load confirmation', () => {
      it('Load with a live game asks first and loads only after onConfirm', async () => {
        const { modal, configs, loaded } = await filledSetup();
        click(modal, '[data-slot="slot_1"] [data-action="load"]');
        await flush();
        expect(configs).toHaveLength(1);
        expect(configs[0]!.title).toBe(t('ui.saves.confirm_load_title'));
        expect(configs[0]!.body).toBe(t('ui.saves.confirm_load_body'));
        expect(loaded).toHaveLength(0);
        configs[0]!.onConfirm();
        await flush();
        expect(loaded).toHaveLength(1);
        expect(loaded[0]!.cash).toBe(4242);
      });

      it('Load with getState returning null loads directly', async () => {
        const { modal, configs, loaded } = await filledSetup({ getState: () => null });
        click(modal, '[data-slot="slot_1"] [data-action="load"]');
        await flush();
        expect(configs).toHaveLength(0);
        expect(loaded).toHaveLength(1);
      });

      it('Load with no getState callback loads directly', async () => {
        const { modal, configs, loaded } = await filledSetup({ getState: null });
        click(modal, '[data-slot="slot_1"] [data-action="load"]');
        await flush();
        expect(configs).toHaveLength(0);
        expect(loaded).toHaveLength(1);
      });

      it('Load when the live level already ended loads directly', async () => {
        const ended = createGame({ seed: 3, mineType: 'desert' });
        ended.levelEndReason = 'bankruptcy';
        const { modal, configs, loaded } = await filledSetup({ getState: () => ended });
        click(modal, '[data-slot="slot_1"] [data-action="load"]');
        await flush();
        expect(configs).toHaveLength(0);
        expect(loaded).toHaveLength(1);
      });

      it('Load with a live game but no confirm handler loads directly', async () => {
        const { modal, loaded } = await filledSetup({ handler: false });
        click(modal, '[data-slot="slot_1"] [data-action="load"]');
        await flush();
        expect(loaded).toHaveLength(1);
      });

      it('loadFromSlot() called directly never confirms (CONTINUE path)', async () => {
        const { modal, configs, loaded } = await filledSetup();
        const ok = await modal.loadFromSlot('slot_1');
        expect(ok).toBe(true);
        expect(configs).toHaveLength(0);
        expect(loaded).toHaveLength(1);
      });
    });
  });

  describe('handleEscape (#1327)', () => {
    it('hides a shown modal and returns true', () => {
      const { modal } = mount();
      modal.setBackend(makeBackend());
      modal.show();
      expect(modal.handleEscape()).toBe(true);
      expect(modal.visible).toBe(false);
      modal.dispose();
    });

    it('returns false when the modal is already hidden', () => {
      const { modal } = mount();
      modal.setBackend(makeBackend());
      expect(modal.handleEscape()).toBe(false);
      expect(modal.visible).toBe(false);
      modal.dispose();
    });

    it('returns false on a second Esc after the first closed it', () => {
      const { modal } = mount();
      modal.setBackend(makeBackend());
      modal.show();
      expect(modal.handleEscape()).toBe(true);
      expect(modal.handleEscape()).toBe(false);
      modal.dispose();
    });

    it('sets the root display to none', () => {
      const { container, modal } = mount();
      modal.setBackend(makeBackend());
      modal.show();
      modal.handleEscape();
      const root = container.querySelector('#bs-saves-modal') as HTMLElement;
      expect(root.style.display).toBe('none');
      modal.dispose();
    });

    it('clears a persistent error status when closing', async () => {
      const { modal } = mount();
      modal.setBackend(makeBackend());
      modal.setOnLoad(() => null);
      modal.show();
      await flush();
      // Missing slot: loadFromSlot reports a persistent error and keeps the modal open.
      expect(await modal.loadFromSlot('slot_1')).toBe(false);
      const statusEl = (modal as unknown as { statusEl: HTMLElement }).statusEl;
      expect(statusEl.textContent).toBe(t('saveload.not_found'));
      expect(modal.handleEscape()).toBe(true);
      expect(statusEl.textContent).toBe('');
      modal.dispose();
    });

    it('works after a failed load re-shows the hidden modal', async () => {
      const { modal } = mount();
      modal.setBackend(makeBackend());
      modal.setOnLoad(() => null);
      // Hidden (e.g. after Continue), then a failed load re-shows it with an error.
      expect(modal.visible).toBe(false);
      expect(await modal.loadFromSlot('slot_1')).toBe(false);
      expect(modal.visible).toBe(true);
      expect(modal.handleEscape()).toBe(true);
      expect(modal.visible).toBe(false);
      modal.dispose();
    });
  });
});
