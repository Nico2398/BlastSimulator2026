// BlastSimulator2026 — Serialization / deserialization
// Pure functions: GameState ↔ JSON string.

import type { GameState } from './GameState.js';
import { SAVE_VERSION } from './GameState.js';

/**
 * Serialize a GameState to a JSON string.
 * Handles Set→Array conversion for surveyedPositions, and drops `navGrid`
 * entirely — it's derived from the voxel grid, buildings, and drill holes,
 * not save data, and serializing it verbatim silently corrupted every
 * blocked/void cell's `moveCost: Infinity` into `null` on the way through
 * JSON (#458 T0.3). `deserialize` always sets it back to `null`; the loader
 * (regenerateGrid / restoreGrid) rebuilds a real one afterward.
 */
export function serialize(state: GameState): string {
  return JSON.stringify(state, (key, value) => {
    if (key === 'navGrid') return undefined;
    if (value instanceof Set) return { __type: 'Set', values: [...value] };
    return value as unknown;
  });
}

/**
 * v8 -> v9: Employee gained a `taskQueue: number[]` field (#549 cost-based
 * per-employee action selection). A pre-v9 save has no queue for any
 * employee — the field defaults to an empty array so the employee is simply
 * treated as having no follow-up work queued. Mutates `obj` in place,
 * matching every other migration block in `deserialize` below.
 */
function migrateV8ToV9(obj: Record<string, unknown>): Record<string, unknown> {
  const employeesRaw = obj['employees'] as Record<string, unknown> | undefined;
  if (employeesRaw) {
    const employeeList = employeesRaw['employees'] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(employeeList)) {
      for (const e of employeeList) {
        if (!Array.isArray(e['taskQueue'])) {
          e['taskQueue'] = [];
        }
      }
    }
  }
  return obj;
}

/**
 * v9 -> v10: Vehicle gained a `reservedForActionId: number | null` field
 * (#550 vehicle-gated actions). A pre-v10 save has no vehicle-gated
 * reservations to preserve — the field defaults to null for every vehicle,
 * matching purchaseVehicle's own default. Mutates `obj` in place, matching
 * every other migration block in `deserialize` below.
 */
function migrateV9ToV10(obj: Record<string, unknown>): Record<string, unknown> {
  const vehiclesRaw = obj['vehicles'] as Record<string, unknown> | undefined;
  if (vehiclesRaw) {
    const vehicleList = vehiclesRaw['vehicles'] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(vehicleList)) {
      for (const v of vehicleList) {
        if (v['reservedForActionId'] === undefined) {
          v['reservedForActionId'] = null;
        }
      }
    }
  }
  return obj;
}

/**
 * v10 -> v11: GameState gained a `plannedDrillHoles: PlannedHole[]` field
 * (#553 drilling becomes work — a drill plan queues one `drill_hole` action
 * per hole instead of writing holes into state instantly). A pre-v11 save
 * has no holes in flight — the field defaults to an empty array. Mutates
 * `obj` in place, matching every other migration block in `deserialize`
 * below.
 */
function migrateV10ToV11(obj: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(obj['plannedDrillHoles'])) {
    obj['plannedDrillHoles'] = [];
  }
  return obj;
}

/**
 * Deserialize a JSON string back to a GameState.
 * Throws a clear error if the version is unknown.
 */
export function deserialize(json: string): GameState {
  const parsed: unknown = JSON.parse(json);

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid save data: expected a JSON object');
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj['version'] !== 'number') {
    throw new Error('Invalid save data: missing version field');
  }

  if (obj['version'] > SAVE_VERSION) {
    throw new Error(
      `Unknown save version: ${obj['version']}. ` +
      `This game supports up to version ${SAVE_VERSION}. ` +
      `Please update the game.`
    );
  }

  // v2 → v3: waitingTicks added to Vehicle interface.
  // Older saves may have vehicles without this field — default to 0.
  if ((obj['version'] as number) < 3) {
    const vehiclesRaw = obj['vehicles'] as Record<string, unknown> | undefined;
    if (vehiclesRaw) {
      const vehicleList = vehiclesRaw['vehicles'] as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(vehicleList)) {
        for (const v of vehicleList) {
          if (typeof v['waitingTicks'] !== 'number') {
            v['waitingTicks'] = 0;
          }
        }
      }
    }
  }

  // Restore Set<string> for surveyedPositions
  const raw = obj['surveyedPositions'] as unknown;
  if (raw && typeof raw === 'object' && '__type' in (raw as Record<string, unknown>)) {
    const setData = raw as { __type: string; values: string[] };
    if (setData.__type === 'Set') {
      (obj as Record<string, unknown>)['surveyedPositions'] = new Set(setData.values);
    }
  } else if (Array.isArray(raw)) {
    (obj as Record<string, unknown>)['surveyedPositions'] = new Set(raw as string[]);
  } else {
    (obj as Record<string, unknown>)['surveyedPositions'] = new Set<string>();
  }

  // Restore Set<string> for levelStats.uniqueOresExtracted
  const levelStatsRaw = obj['levelStats'] as Record<string, unknown> | undefined;
  if (levelStatsRaw) {
    const ores = levelStatsRaw['uniqueOresExtracted'];
    if (ores && typeof ores === 'object' && '__type' in (ores as Record<string, unknown>)) {
      const setData = ores as { __type: string; values: string[] };
      if (setData.__type === 'Set') {
        levelStatsRaw['uniqueOresExtracted'] = new Set(setData.values);
      }
    } else if (Array.isArray(ores)) {
      levelStatsRaw['uniqueOresExtracted'] = new Set(ores as string[]);
    } else {
      levelStatsRaw['uniqueOresExtracted'] = new Set<string>();
    }
  }

  // Ensure event system fields exist for saves created before they were added
  const eventsRaw = obj['events'] as Record<string, unknown> | undefined;
  if (eventsRaw) {
    if (!Array.isArray(eventsRaw['firedEventIds'])) {
      eventsRaw['firedEventIds'] = [];
    }
    if (typeof eventsRaw['lastEventTick'] !== 'number') {
      eventsRaw['lastEventTick'] = 0;
    }
    if (typeof eventsRaw['actionCountSinceEvent'] !== 'number') {
      eventsRaw['actionCountSinceEvent'] = 0;
    }
  }

  // Ensure restNeedKey exists on employees saved before the field was added.
  // Absent means "not resting under the general rest path", which is what null
  // encodes — an employee frozen mid-rest in such a save is released by the
  // rest action still sitting in pendingActions.
  const employeesRaw = obj['employees'] as Record<string, unknown> | undefined;
  if (employeesRaw) {
    const employeeList = employeesRaw['employees'] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(employeeList)) {
      for (const e of employeeList) {
        if (e['restNeedKey'] === undefined) {
          e['restNeedKey'] = null;
        }
        // Ensure activeTaskSkill exists on employees saved before the field was
        // added. Absent means "no dispatched-task skill tracked", encoded as null.
        if (e['activeTaskSkill'] === undefined) {
          e['activeTaskSkill'] = null;
        }
      }
    }
  }

  // v4 → v5: collectedOre field added
  if (typeof obj['collectedOre'] !== 'object' || obj['collectedOre'] === null) {
    (obj as Record<string, unknown>)['collectedOre'] = {};
  }

  // v6 → v7: softwareTier/tubingState moved onto GameState from the
  // console-only MiningContext, so a save from before this had neither.
  if (typeof obj['softwareTier'] !== 'number') {
    (obj as Record<string, unknown>)['softwareTier'] = 0;
  }
  if (typeof obj['tubingState'] !== 'object' || obj['tubingState'] === null) {
    (obj as Record<string, unknown>)['tubingState'] = { inventory: 0, installedHoles: new Set<string>() };
  } else {
    const tubingRaw = obj['tubingState'] as Record<string, unknown>;
    const installed = tubingRaw['installedHoles'];
    if (installed && typeof installed === 'object' && '__type' in (installed as Record<string, unknown>)) {
      const setData = installed as { __type: string; values: string[] };
      if (setData.__type === 'Set') tubingRaw['installedHoles'] = new Set(setData.values);
    } else if (Array.isArray(installed)) {
      tubingRaw['installedHoles'] = new Set(installed as string[]);
    } else if (!(installed instanceof Set)) {
      tubingRaw['installedHoles'] = new Set<string>();
    }
    if (typeof tubingRaw['inventory'] !== 'number') tubingRaw['inventory'] = 0;
  }

  // v7 → v8: PendingAction/GhostPreview gained a lifecycle (status/holderId,
  // claimed). A pre-v8 save's *dispatched-and-idle-claimed* actions were
  // deleted from pendingActions the instant they were claimed (the bug #547
  // fixes) — but rest actions created by tickCollapse/tickNeedRestoration/
  // forceShiftRestIfNeeded (GameLoop.ts) already self-claimed synchronously
  // at creation even pre-#547: they push the action to pendingActions AND
  // set the claiming employee's activeActionId immediately, removing it only
  // at rest completion. So a save taken mid-rest genuinely has a surviving
  // pendingActions entry already claimed by a specific employee, not queued.
  if ((obj['version'] as number) < 8) {
    const pendingActionsRaw = obj['pendingActions'] as Array<Record<string, unknown>> | undefined;

    // Map pending-action id -> claiming employee id, from each employee's
    // activeActionId — the only place a pre-#547 save records "this action is
    // already claimed by me".
    const employeesForActiveActionCleanupRaw = obj['employees'] as Record<string, unknown> | undefined;
    const employeesForActiveActionCleanup = employeesForActiveActionCleanupRaw
      ? (employeesForActiveActionCleanupRaw['employees'] as Array<Record<string, unknown>> | undefined)
      : undefined;
    const claimingEmployeeByActionId = new Map<unknown, unknown>();
    if (Array.isArray(employeesForActiveActionCleanup)) {
      for (const e of employeesForActiveActionCleanup) {
        if (e['activeActionId'] !== null && e['activeActionId'] !== undefined) {
          claimingEmployeeByActionId.set(e['activeActionId'], e['id']);
        }
      }
    }

    if (Array.isArray(pendingActionsRaw)) {
      for (const action of pendingActionsRaw) {
        const holderId = claimingEmployeeByActionId.get(action['id']);
        if (action['status'] === undefined) {
          action['status'] = holderId !== undefined ? 'assigned' : 'queued';
        }
        if (action['holderId'] === undefined) {
          action['holderId'] = holderId !== undefined ? holderId : null;
        }
      }
    }

    const ghostPreviewsRaw = obj['ghostPreviews'] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(ghostPreviewsRaw)) {
      for (const ghost of ghostPreviewsRaw) {
        if (ghost['claimed'] === undefined) {
          ghost['claimed'] = claimingEmployeeByActionId.has(ghost['id']);
        }
      }
    }

    // A pre-v8 save's dispatched-and-claimed actions (not the self-claimed
    // rest actions handled above) were already deleted from pendingActions by
    // the old bug, so an employee's activeActionId can reference an id no
    // longer present after migration — clear a truly-dangling reference
    // rather than leave tickEmployees' idle check permanently blocked on it.
    // An action that matched a claiming employee above is, by construction,
    // still present, so this only ever clears the genuinely-stale case.
    const migratedIds = new Set(
      Array.isArray(pendingActionsRaw) ? pendingActionsRaw.map(a => a['id']) : [],
    );
    if (Array.isArray(employeesForActiveActionCleanup)) {
      for (const e of employeesForActiveActionCleanup) {
        if (e['activeActionId'] !== null && e['activeActionId'] !== undefined && !migratedIds.has(e['activeActionId'])) {
          e['activeActionId'] = null;
        }
      }
    }
  }

  // v8 -> v9: Employee.taskQueue (#549).
  if ((obj['version'] as number) < 9) {
    migrateV8ToV9(obj);
  }

  // v9 -> v10: Vehicle.reservedForActionId (#550).
  if ((obj['version'] as number) < 10) {
    migrateV9ToV10(obj);
  }

  // v10 -> v11: GameState.plannedDrillHoles (#553).
  if ((obj['version'] as number) < 11) {
    migrateV10ToV11(obj);
  }

  // v6: navGrid is never part of the JSON (see serialize's replacer) — always
  // null here, regardless of what an older save happened to carry. The
  // loader is responsible for rebuilding a real one.
  (obj as Record<string, unknown>)['navGrid'] = null;

  return obj as unknown as GameState;
}
