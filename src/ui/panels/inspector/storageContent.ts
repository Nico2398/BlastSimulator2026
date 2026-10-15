/** Inspector storage section for warehouse buildings (#1757). */
import type { Building } from '../../../core/entities/Building.js';
import type { GameState } from '../../../core/state/GameState.js';

/** A storage section plus its live-sync hook. */
export interface StorageContents {
  readonly section: HTMLElement;
  readonly sync: (root: HTMLElement) => void;
}

/** Storage section for a building, or null when the building stores nothing. */
export function storageContents(_b: Building, _state: GameState, _closed: boolean): StorageContents | null {
  // TODO: implement
  return null;
}
