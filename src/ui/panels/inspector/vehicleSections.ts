/** Section builders for the vehicle Inspector view (#1761). */
import type { Vehicle } from '../../../core/entities/Vehicle.js';
import type { GameState } from '../../../core/state/GameState.js';
import type { InspectorLinks } from './InspectorContent.js';

export function buildJobSection(v: Vehicle, state: GameState, links: InspectorLinks): HTMLElement {
  void v; void state; void links;
  // TODO: implement
  throw new Error('not implemented');
}

export function buildCargoSection(v: Vehicle, state: GameState): HTMLElement | null {
  void v; void state;
  // TODO: implement
  return null;
}

export function buildDriverSection(v: Vehicle, state: GameState, links: InspectorLinks): HTMLElement {
  void v; void state; void links;
  // TODO: implement
  throw new Error('not implemented');
}
