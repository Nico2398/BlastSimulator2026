/** Inspector research section for the Research Center. */
import type { Building } from '../../../core/entities/Building.js';
import type { GameState } from '../../../core/state/GameState.js';

/** A research section plus its live-sync hook. */
export interface ResearchSection {
  readonly section: HTMLElement;
  /** Names the row set: when it changes the section must be rebuilt, not synced in place. */
  readonly rowSignature: string;
  readonly sync: () => void;
}

/** Research progress of a Research Center, or null for any other building. */
export function researchSection(b: Building, state: GameState): ResearchSection | null {
  // TODO: implement
  void b; void state;
  return null;
}
