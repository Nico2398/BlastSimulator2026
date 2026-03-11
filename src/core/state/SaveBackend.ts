// BlastSimulator2026 — Save backend interface
// PURE TYPE — no platform imports, no side effects.
// Implementations live in src/persistence/ (outside core).

/** Metadata stored alongside each save slot. */
export interface SaveMeta {
  slotId: string;
  name: string;
  timestamp: number;
  version: number;
  /** Snapshot of campaign progress for the save list UI. */
  campaignSummary: string;
}

/** A saved slot with metadata and serialized game state. */
export interface SaveSlot {
  meta: SaveMeta;
  data: string;
}

/**
 * Persistence backend for save/load.
 * Implementations: FilePersistence, IndexedDBPersistence, DownloadPersistence.
 */
export interface SaveBackend {
  /** Save serialized state to a slot. */
  save(slotId: string, name: string, data: string, campaignSummary: string): Promise<void>;

  /** Load a saved slot by ID. Returns null if not found. */
  load(slotId: string): Promise<SaveSlot | null>;

  /** List all saved slots with metadata. */
  list(): Promise<SaveMeta[]>;

  /** Delete a save slot. */
  delete(slotId: string): Promise<void>;
}
