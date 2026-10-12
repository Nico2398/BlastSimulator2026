// BlastSimulator2026 — Blast losses
// A blast's report lists the buildings its own carving removed, with positions. Buildings
// that flying rock or a secondary explosion destroyed, and vehicles flyrock destroyed, are
// only named by id in the report's accidents, and the entity is spliced out of the game by
// the time anyone asks. Their positions come from the last look at the world before the
// blast. Pure: it reads a report and a snapshot.

import type { BlastLosses } from './blastPlan.js';
import type { Spot, WorldSnapshot } from './worldSnapshot.js';

/** What this needs of the blast report: which entities its accidents destroyed, and which buildings it already lists. */
export interface BlastLossReport {
  readonly destroyedBuildings?: readonly { readonly buildingId?: number }[];
  readonly accidents?: readonly { readonly type: string; readonly entityId?: number }[];
}

const NONE: BlastLosses = { buildings: [], vehicles: [] };

function destroyedIds(report: BlastLossReport, accidentType: string): Set<number> {
  const ids = new Set<number>();
  for (const accident of report.accidents ?? []) {
    if (accident.type === accidentType && accident.entityId !== undefined) ids.add(accident.entityId);
  }
  return ids;
}

function spotsOf(ids: ReadonlySet<number>, known: ReadonlyMap<number, Spot>): Spot[] {
  const spots: Spot[] = [];
  for (const id of ids) {
    const spot = known.get(id);
    if (spot) spots.push(spot);
  }
  return spots;
}

/** The destroyed buildings and vehicles the report does not already list, placed where they stood before the blast. */
export function blastLosses(report: BlastLossReport | null, before: WorldSnapshot | null): BlastLosses {
  if (report === null || before === null) return NONE;
  const buildings = destroyedIds(report, 'building_destroyed');
  for (const listed of report.destroyedBuildings ?? []) {
    if (listed.buildingId !== undefined) buildings.delete(listed.buildingId);
  }
  return { buildings: spotsOf(buildings, before.buildings), vehicles: spotsOf(destroyedIds(report, 'vehicle_destroyed'), before.vehicles) };
}
