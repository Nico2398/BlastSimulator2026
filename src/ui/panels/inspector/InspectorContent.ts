/** Per-kind content model for the Inspector window (#1756). Types and dispatch stub only. */
import type { GameState } from '../../../core/state/GameState.js';
import type { EntityPick } from '../../scene/ScenePicking.js';
import type { InspectorAction } from '../../shell/Inspector.js';
import { buildingContent } from './buildingContent.js';
import { vehicleContent } from './vehicleContent.js';
import { employeeContent } from './employeeContent.js';
import { pickedContent } from './pickedContent.js';

export type InspectorKind = EntityPick['kind'];

/** One action button the Inspector renders for the current entity. */
export interface ActionSpec {
  readonly action: InspectorAction;
  readonly labelKey: string;
  readonly icon: string;
  readonly variant: 'ghost' | 'danger';
  readonly disabled?: boolean;
}

/** Callbacks a view uses to navigate to other entities (host, occupant, driver...). */
export interface InspectorLinks {
  readonly select: (kind: InspectorKind, id: number) => void;
}

/** Everything the Inspector shows for one entity at one moment. */
export interface InspectorView {
  readonly title: string;
  readonly sub: string;
  readonly icon: string;
  readonly status: string;
  readonly signature: string;
  readonly sections: HTMLElement[];
  readonly actions: ActionSpec[];
  /** Refresh live values in place inside `root` (the built sections) without rebuilding. */
  readonly sync: (root: HTMLElement) => void;
}

export interface KindContent {
  /** Null when the entity no longer exists. */
  view(entity: Pick<EntityPick, 'kind' | 'id'>, state: GameState, links: InspectorLinks): InspectorView | null;
}

const CONTENT: Record<InspectorKind, KindContent> = {
  building: buildingContent,
  vehicle: vehicleContent,
  employee: employeeContent,
  fragment: pickedContent,
  hole: pickedContent,
  ramp: pickedContent,
};

export function contentFor(kind: InspectorKind): KindContent {
  return CONTENT[kind];
}
