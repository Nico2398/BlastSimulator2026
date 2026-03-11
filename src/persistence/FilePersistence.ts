// BlastSimulator2026 — File-based save backend (Node.js)
// Uses Node.js fs for desktop/local use. Lives OUTSIDE src/core/.

import * as fs from 'fs';
import * as path from 'path';
import type { SaveBackend, SaveMeta, SaveSlot } from '../core/state/SaveBackend.js';
import { SAVE_VERSION } from '../core/state/GameState.js';

export class FilePersistence implements SaveBackend {
  private readonly dir: string;

  constructor(directory: string) {
    this.dir = directory;
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
  }

  private slotPath(slotId: string): string {
    // Sanitize slotId to prevent path traversal
    const safe = slotId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.dir, `${safe}.json`);
  }

  async save(slotId: string, name: string, data: string, campaignSummary: string): Promise<void> {
    const meta: SaveMeta = {
      slotId,
      name,
      timestamp: Date.now(),
      version: SAVE_VERSION,
      campaignSummary,
    };
    const slot: SaveSlot = { meta, data };
    fs.writeFileSync(this.slotPath(slotId), JSON.stringify(slot), 'utf-8');
  }

  async load(slotId: string): Promise<SaveSlot | null> {
    const filePath = this.slotPath(slotId);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as SaveSlot;
  }

  async list(): Promise<SaveMeta[]> {
    if (!fs.existsSync(this.dir)) return [];
    const files = fs.readdirSync(this.dir).filter(f => f.endsWith('.json'));
    const metas: SaveMeta[] = [];
    for (const file of files) {
      const raw = fs.readFileSync(path.join(this.dir, file), 'utf-8');
      const slot = JSON.parse(raw) as SaveSlot;
      metas.push(slot.meta);
    }
    return metas;
  }

  async delete(slotId: string): Promise<void> {
    const filePath = this.slotPath(slotId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}
