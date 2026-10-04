// BlastSimulator2026 — Download/upload save backend (browser fallback)
// In-memory session fallback when IndexedDB is unavailable.
// Lives OUTSIDE src/core/.

import type { SaveBackend, SaveMeta, SaveSlot } from '../core/state/SaveBackend.js';
import { buildSaveSlot } from './SaveSlotBuilder.js';

/**
 * Session-only persistence: slots live in memory until the page closes.
 * Saving never triggers a download (autosave would spam the player);
 * manual export lives in SavesModal.exportSave.
 */
export class DownloadPersistence implements SaveBackend {
  private readonly slots = new Map<string, SaveSlot>();

  async save(slotId: string, name: string, data: string, campaignSummary: string, levelId: string | null): Promise<void> {
    const slot = buildSaveSlot(slotId, name, data, campaignSummary, levelId);
    this.slots.set(slotId, slot);
  }

  async load(slotId: string): Promise<SaveSlot | null> {
    return this.slots.get(slotId) ?? null;
  }

  /** Import a save from a JSON string (called after user picks a file). */
  importSave(json: string): SaveSlot {
    const slot = JSON.parse(json) as SaveSlot;
    this.slots.set(slot.meta.slotId, slot);
    return slot;
  }

  async list(): Promise<SaveMeta[]> {
    return Array.from(this.slots.values()).map(s => s.meta);
  }

  async delete(slotId: string): Promise<void> {
    this.slots.delete(slotId);
  }
}
