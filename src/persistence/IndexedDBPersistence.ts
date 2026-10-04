// BlastSimulator2026 — IndexedDB save backend (browser)
// Uses IndexedDB for web persistence. Lives OUTSIDE src/core/.

import type { SaveBackend, SaveMeta, SaveSlot } from '../core/state/SaveBackend.js';
import { buildSaveSlot } from './SaveSlotBuilder.js';

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
    request.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

/** Longest the startup probe waits for IndexedDB before the caller falls back. */
const PROBE_TIMEOUT_MS = 3000;

function txn(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

export class IndexedDBPersistence implements SaveBackend {
  /** Resolves when IndexedDB is usable; rejects when missing, blocked, errored or timed out. */
  async probe(): Promise<void> {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('IndexedDB probe timed out')), PROBE_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.list(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async save(slotId: string, name: string, data: string, campaignSummary: string, levelId: string | null): Promise<void> {
    const slot = buildSaveSlot(slotId, name, data, campaignSummary, levelId);
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(slot);
      // Resolve on commit, not on the request: a quota failure aborts the txn after onsuccess.
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB save failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB save aborted'));
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
