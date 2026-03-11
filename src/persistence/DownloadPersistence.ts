// BlastSimulator2026 — Download/upload save backend (browser fallback)
// Exports saves as downloadable JSON, imports via file picker.
// Lives OUTSIDE src/core/ — uses DOM APIs.

import type { SaveBackend, SaveMeta, SaveSlot } from '../core/state/SaveBackend.js';
import { SAVE_VERSION } from '../core/state/GameState.js';

/**
 * Download-based persistence: saves trigger a file download,
 * loads prompt a file picker. Slots are held in memory during the session.
 */
export class DownloadPersistence implements SaveBackend {
  private readonly slots = new Map<string, SaveSlot>();

  async save(slotId: string, name: string, data: string, campaignSummary: string): Promise<void> {
    const meta: SaveMeta = {
      slotId,
      name,
      timestamp: Date.now(),
      version: SAVE_VERSION,
      campaignSummary,
    };
    const slot: SaveSlot = { meta, data };
    this.slots.set(slotId, slot);

    // Trigger browser download
    if (typeof document !== 'undefined') {
      const blob = new Blob([JSON.stringify(slot)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `blast-save-${slotId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
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
