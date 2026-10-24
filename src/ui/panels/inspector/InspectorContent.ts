/** Per-kind content model for the Inspector window (#1756). View types and the kind-to-content dispatch. */
import type { GameState } from '../../../core/state/GameState.js';
import type { EntityPick } from '../../scene/ScenePicking.js';
import { buildingContent } from './buildingContent.js';
import { vehicleContent } from './vehicleContent.js';
import { employeeContent } from './employeeContent.js';
import { fragmentContent } from './fragmentContent.js';
import { holeContent } from './holeContent.js';
import { rampContent } from './rampContent.js';
import type { ConfirmModalConfig } from '../ConfirmModal.js';

export type InspectorKind = EntityPick['kind'];

/** Every action an Inspector button can fire; main.ts decides what each does. */
export type InspectorAction =
  | 'dispatch_here' | 'move_here' | 'upgrade_vehicle' | 'scrap_vehicle'
  | 'upgrade' | 'move' | 'demolish' | 'widen' | 'repair' | 'locate' | 'research';

/** One action button the Inspector renders for the current entity. */
export interface ActionSpec {
  readonly action: InspectorAction;
  readonly labelKey: string;
  readonly icon: string;
  readonly variant: 'ghost' | 'danger';
  readonly disabled?: boolean;
  /** Literal label overriding `labelKey` (#1758). */
  readonly label?: string;
  /** Tooltip text (#1758). */
  readonly title?: string;
  /** Explanatory line shown with the action, e.g. why the order will wait. */
  readonly note?: string;
}

/** Callbacks a view uses to navigate to other entities (host, occupant, driver...). */
export interface InspectorLinks {
  readonly select: (kind: InspectorKind, id: number) => void;
  /** Run a console command line (raise, train, fire...). */
  readonly run: (command: string) => void;
  /** Ask the shared confirm overlay. */
  readonly confirm: (config: ConfirmModalConfig) => void;
  /** Open a panel (the Crew panel from a vehicle's "no licensed driver" row). */
  readonly navigate?: (panel: 'crew') => void;
  /** What repairing a built ramp would cost now, or why it cannot be repaired (#2045); absent without terrain. */
  readonly rampRepairQuote?: (rampId: number) => RampRepairOffer;
}

/** A ramp repair as the Inspector offers it: its cost, or the refusal key and params (`intact` hides the action). */
export type RampRepairOffer =
  | { kind: 'quote'; cost: number }
  | { kind: 'refused'; errorKey: string; errorParams?: Record<string, string | number> };

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
  fragment: fragmentContent,
  hole: holeContent,
  ramp: rampContent,
};

export function contentFor(kind: InspectorKind): KindContent {
  return CONTENT[kind];
}
