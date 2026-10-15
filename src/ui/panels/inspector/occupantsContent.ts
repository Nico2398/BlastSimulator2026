/** Inspector residents and school-trainee sections for buildings. */
import type { Building } from '../../../core/entities/Building.js';
import type { GameState } from '../../../core/state/GameState.js';
import type { InspectorLinks } from './InspectorContent.js';

/** A building section plus its live-sync hook. */
export interface OccupantsSection {
  readonly section: HTMLElement;
  /** Names the row set: when it changes the section must be rebuilt, not synced in place. */
  readonly rowSignature: string;
  readonly sync: () => void;
}

/** Who lives or is inside the building, or null when it has no residents. */
export function residentsSection(b: Building, state: GameState, links: InspectorLinks): OccupantsSection | null {
  // TODO: implement
  void b; void state; void links;
  return null;
}

/** Courses and enrolled trainees of a school, or null when the building teaches nothing. */
export function schoolSection(b: Building, state: GameState, links: InspectorLinks): OccupantsSection | null {
  // TODO: implement
  void b; void state; void links;
  return null;
}
