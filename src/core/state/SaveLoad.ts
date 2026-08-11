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

  // v7 → v8: PendingAction gained status/assignedEmployeeId, GhostPreview
  // gained claimed (#547 — the record now survives claim instead of being
  // deleted, so it needs a lifecycle field to track that).
  const pendingActionsRaw = obj['pendingActions'] as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(pendingActionsRaw)) {
    for (const action of pendingActionsRaw) {
      if (action['status'] === undefined) {
        action['status'] = 'queued';
      }
      if (action['assignedEmployeeId'] === undefined) {
        action['assignedEmployeeId'] = null;
      }
    }
  }
  const ghostPreviewsRaw = obj['ghostPreviews'] as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(ghostPreviewsRaw)) {
    for (const ghost of ghostPreviewsRaw) {
      if (ghost['claimed'] === undefined) {
        ghost['claimed'] = false;
      }
    }
  }
  // Under the old model, a non-rest claim deleted the PendingAction record at
  // claim time — only a self-claimed rest action (tickCollapse/
  // tickNeedRestoration/autoInsertNeedTasks/forceShiftRestIfNeeded) could
  // still be sitting in pendingActions while an employee's activeActionId
  // pointed at it. Re-link those so status/assignedEmployeeId reflect the
  // claim under the new model; anything else legitimately has no match.
  if (Array.isArray(pendingActionsRaw)) {
    const employeesForRelink = obj['employees'] as Record<string, unknown> | undefined;
    const employeeListForRelink = employeesForRelink?.['employees'] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(employeeListForRelink)) {
      for (const emp of employeeListForRelink) {
        const activeActionId = emp['activeActionId'];
        if (typeof activeActionId !== 'number') continue;
        const matched = pendingActionsRaw.find(a => a['id'] === activeActionId);
        if (matched === undefined) continue;
        matched['status'] = 'assigned';
        matched['assignedEmployeeId'] = emp['id'];
      }
    }
  }

  // v6: navGrid is never part of the JSON (see serialize's replacer) — always
  // null here, regardless of what an older save happened to carry. The
  // loader is responsible for rebuilding a real one.
  (obj as Record<string, unknown>)['navGrid'] = null;

  return obj as unknown as GameState;
}
