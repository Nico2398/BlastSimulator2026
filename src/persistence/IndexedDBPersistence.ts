// BlastSimulator2026 — IndexedDB save backend (browser)
// Uses IndexedDB for web persistence. Lives OUTSIDE src/core/.

import type { SaveBackend, SaveMeta, SaveSlot } from '../core/state/SaveBackend.js';
import { SAVE_VERSION } from '../core/state/GameState.js';

const DB_NAME = 'BlastSimulator2026';
const STORE_NAME = 'saves';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'meta.slotId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txn(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

export class IndexedDBPersistence implements SaveBackend {
  async save(slotId: string, name: string, data: string, campaignSummary: string): Promise<void> {
    const meta: SaveMeta = {
      slotId,
      name,
      timestamp: Date.now(),
      version: SAVE_VERSION,
      campaignSummary,
    };
    const slot: SaveSlot = { meta, data };
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = txn(db, 'readwrite').put(slot);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async load(slotId: string): Promise<SaveSlot | null> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = txn(db, 'readonly').get(slotId);
      req.onsuccess = () => resolve((req.result as SaveSlot | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async list(): Promise<SaveMeta[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = txn(db, 'readonly').getAll();
      req.onsuccess = () => {
        const slots = req.result as SaveSlot[];
        resolve(slots.map(s => s.meta));
      };
      req.onerror = () => reject(req.error);
    });
  }

  async delete(slotId: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = txn(db, 'readwrite').delete(slotId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}
