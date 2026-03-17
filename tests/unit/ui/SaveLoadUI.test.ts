// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SaveLoadUI } from '../../../src/ui/SaveLoadUI.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { SaveBackend, SaveMeta } from '../../../src/core/state/SaveBackend.js';
import { AUTO_SAVE_INTERVAL_TICKS } from '../../../src/core/config/balance.js';

// Minimal in-memory SaveBackend
function makeBackend(): SaveBackend & { store: Map<string, { meta: SaveMeta; data: string }> } {
  const store = new Map<string, { meta: SaveMeta; data: string }>();
  return {
    store,
    async save(slotId, name, data, summary) {
      store.set(slotId, { meta: { slotId, name, timestamp: Date.now(), campaignSummary: summary }, data });
    },
    async load(slotId) {
      const entry = store.get(slotId);
      if (!entry) return null;
      return { slotId, data: entry.data };
    },
    async list() {
      return [...store.values()].map(e => e.meta);
    },
    async delete(slotId) {
      store.delete(slotId);
    },
  };
}

describe('SaveLoadUI (12.3)', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('renders hidden by default', () => {
    const ui = new SaveLoadUI(container);
    expect(ui.visible).toBe(false);
    ui.dispose();
  });

  it('shows and hides correctly', () => {
    const backend = makeBackend();
    const ui = new SaveLoadUI(container);
    ui.setBackend(backend);
    ui.show();
    expect(ui.visible).toBe(true);
    ui.hide();
    expect(ui.visible).toBe(false);
    ui.dispose();
  });

  it('triggers autoSave after AUTO_SAVE_INTERVAL_TICKS ticks', async () => {
    const backend = makeBackend();
    const state = createGame({ seed: 1, mineType: 'desert' });
    const ui = new SaveLoadUI(container);
    ui.setBackend(backend);
    ui.setGetState(() => state);

    // First tick triggers the initial auto-save (lastAutoSaveTick starts at -interval)
    state.tickCount = 0;
    ui.onTick(state);
    await new Promise(r => setTimeout(r, 0));
    expect(backend.store.has('auto')).toBe(true);

    // Clear store and advance by less than interval — should not save again
    backend.store.clear();
    state.tickCount = AUTO_SAVE_INTERVAL_TICKS - 1;
    ui.onTick(state);
    await new Promise(r => setTimeout(r, 0));
    expect(backend.store.has('auto')).toBe(false);

    // Advance past interval — should save again
    state.tickCount = AUTO_SAVE_INTERVAL_TICKS;
    ui.onTick(state);
    await new Promise(r => setTimeout(r, 0));
    expect(backend.store.has('auto')).toBe(true);

    ui.dispose();
  });

  it('renders 6 slot rows when shown', async () => {
    const backend = makeBackend();
    const ui = new SaveLoadUI(container);
    ui.setBackend(backend);
    ui.show();
    // Wait for async refreshSlotList
    await new Promise(r => setTimeout(r, 0));
    // Each slot row has two buttons (save + load + delete = 3 per row)
    // Check at least 6 save buttons (one per slot)
    const saveBtns = container.querySelectorAll('button.bs-btn-primary');
    // 6 slots (auto + slot_1 through slot_5) × 1 save button each
    expect(saveBtns.length).toBeGreaterThanOrEqual(6);
    ui.dispose();
  });

  it('auto-save slot save button is disabled', async () => {
    const backend = makeBackend();
    const ui = new SaveLoadUI(container);
    ui.setBackend(backend);
    ui.show();
    await new Promise(r => setTimeout(r, 0));
    // First slot row (auto) should have disabled save button
    const firstRow = container.querySelectorAll('button.bs-btn-primary')[0] as HTMLButtonElement | undefined;
    expect(firstRow?.disabled).toBe(true);
    ui.dispose();
  });
});
