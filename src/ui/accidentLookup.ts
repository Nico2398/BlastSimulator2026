// BlastSimulator2026 — Shared accident/incident icon + text lookup (#557)
// BlastReportModal's casualty note-cards and OperationsPanel's incident log
// both read an AccidentRecord's icon and severity, and both resolve the same
// name-lookup-with-fallback / i18n-key-by-severity text. One table and one
// function here so the two never drift apart on either — even though they
// render through genuinely different DOM (a note-card vs. a compact incident
// row) and BlastReportModal shows only 4 of the 8 accident types where
// OperationsPanel shows all 8. DOM-building stays local to each panel; only
// this lookup layer is shared.

import { t } from '../core/i18n/I18n.js';
import type { IconName } from './icons.js';
import type { AccidentRecord } from '../core/entities/Damage.js';
import type { GameState } from '../core/state/GameState.js';

export interface AccidentStyle {
  icon: IconName;
  /** True for the more severe half of a type's damage/destroyed (or injury/death) pair. */
  critical: boolean;
}

/** Icon + severity tier for every AccidentRecord type. */
export const ACCIDENT_STYLE: Record<AccidentRecord['type'], AccidentStyle> = {
  injury: { icon: 'injured', critical: false },
  death: { icon: 'skull', critical: true },
  building_damage: { icon: 'build', critical: false },
  building_destroyed: { icon: 'build', critical: true },
  seismic_damage: { icon: 'build', critical: false },
  seismic_destroyed: { icon: 'build', critical: true },
  vehicle_damage: { icon: 'vehicle', critical: false },
  vehicle_destroyed: { icon: 'vehicle', critical: true },
};

/**
 * Resolves an accident's display text: an employee's real name for
 * death/injury (employees stay in their array with alive:false so a live
 * lookup always works), or the entityLabel type snapshot's i18n name for
 * building/seismic/vehicle records — destroyBuilding/destroyVehicle splice
 * the entity out, so a live lookup after a *_destroyed accident would find
 * nothing. Seismic types are kept distinct from building_damage/destroyed so
 * the text doesn't misattribute a seismic survey's shockwave damage to a
 * blast fragment.
 */
export function accidentText(a: AccidentRecord, state: GameState): string {
  switch (a.type) {
    case 'injury':
    case 'death': {
      const name = state.employees.employees.find(e => e.id === a.entityId)?.name ?? t('ui.operations.incident_unknown_worker');
      return t(a.type === 'death' ? 'ui.operations.incident_death' : 'ui.operations.incident_injury', { name });
    }
    case 'building_damage':
    case 'building_destroyed': {
      const building = a.entityLabel ? t(`building.${a.entityLabel}.name`) : t('ui.operations.incident_unknown_building');
      return t(a.type === 'building_destroyed' ? 'ui.operations.incident_building_destroyed' : 'ui.operations.incident_building_damage', { building });
    }
    case 'seismic_damage':
    case 'seismic_destroyed': {
      const building = a.entityLabel ? t(`building.${a.entityLabel}.name`) : t('ui.operations.incident_unknown_building');
      return t(a.type === 'seismic_destroyed' ? 'ui.operations.incident_seismic_destroyed' : 'ui.operations.incident_seismic_damage', { building });
    }
    case 'vehicle_damage':
    case 'vehicle_destroyed': {
      const vehicle = a.entityLabel ? t(`vehicle_type.${a.entityLabel}`) : t('ui.operations.incident_unknown_vehicle');
      return t(a.type === 'vehicle_destroyed' ? 'ui.operations.incident_vehicle_destroyed' : 'ui.operations.incident_vehicle_damage', { vehicle });
    }
  }
}
