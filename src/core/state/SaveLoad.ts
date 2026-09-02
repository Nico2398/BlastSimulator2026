// BlastSimulator2026 — Serialization / deserialization
// Pure functions: GameState ↔ JSON string.

import type { GameState } from './GameState.js';
import { SAVE_VERSION } from './GameState.js';
import { SCORE_DECAY_RATE } from '../config/balance.js';

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
 * Sets `container[key]` to `defaultValue` when the current value fails
 * `predicate`. No-ops when `container` is undefined. Mutates in place.
 * Idempotent: a value that already satisfies `predicate` is left untouched.
 */
function ensureField(
  container: Record<string, unknown> | undefined,
  key: string,
  predicate: (value: unknown) => boolean,
  defaultValue: unknown,
): void {
  if (!container) return;
  if (!predicate(container[key])) {
    container[key] = defaultValue;
  }
}

/**
 * For every item in `obj[listKey][listKey]` (an array of records), default
 * each field in `fields` when it fails its own predicate. The nested list is
 * always read from the same key as its container in this codebase's save
 * shape (e.g. `obj.employees.employees`), so a single key covers both.
 */
function ensureFieldsOnEach(
  obj: Record<string, unknown>,
  listKey: string,
  fields: Array<{ key: string; predicate: (value: unknown) => boolean; defaultValue: unknown }>,
): void {
  const container = obj[listKey] as Record<string, unknown> | undefined;
  if (!container) return;
  const list = container[listKey] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(list)) return;
  for (const item of list) {
    for (const field of fields) {
      ensureField(item, field.key, field.predicate, field.defaultValue);
    }
  }
}

/**
 * Restores a Set<string> field serialized by `serialize`'s replacer
 * (`{ __type: 'Set', values: [...] }`), a raw array (pre-Set-encoding
 * saves), or replaces anything else with an empty Set. A `__type` tag
 * present but not `'Set'` falls through and touches nothing, matching
 * the original if/else-if/else exactly.
 */
function restoreSetField(container: Record<string, unknown> | undefined, key: string): void {
  if (!container) return;
  const raw = container[key];
  if (raw && typeof raw === 'object' && '__type' in (raw as Record<string, unknown>)) {
    const setData = raw as { __type: string; values: string[] };
    if (setData.__type === 'Set') {
      container[key] = new Set(setData.values);
    }
  } else if (Array.isArray(raw)) {
    container[key] = new Set(raw as string[]);
  } else {
    container[key] = new Set<string>();
  }
}

/**
 * v8 -> v9: Employee gained a `taskQueue: number[]` field (#549 cost-based
 * per-employee action selection). A pre-v9 save has no queue for any
 * employee — the field defaults to an empty array so the employee is simply
 * treated as having no follow-up work queued. Mutates `obj` in place,
 * matching every other migration block in `deserialize` below.
 */
function migrateV8ToV9(obj: Record<string, unknown>): Record<string, unknown> {
  ensureFieldsOnEach(obj, 'employees', [
    { key: 'taskQueue', predicate: Array.isArray, defaultValue: [] },
  ]);
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
  ensureFieldsOnEach(obj, 'vehicles', [
    { key: 'reservedForActionId', predicate: v => v !== undefined, defaultValue: null },
  ]);
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
  ensureField(obj, 'plannedDrillHoles', Array.isArray, []);
  return obj;
}

/**
 * v11 -> v12: GameState gained a `plannedChargesByHole: Record<string,
 * PlannedCharge>` field (#554 charging becomes work — a charge order queues
 * one `charge_hole` action per hole instead of writing charges into state
 * instantly). A pre-v12 save has no charges in flight — the field defaults
 * to an empty object. Mutates `obj` in place, matching every other migration
 * block in `deserialize` below.
 */
function migrateV11ToV12(obj: Record<string, unknown>): Record<string, unknown> {
  ensureField(obj, 'plannedChargesByHole', v => typeof v === 'object' && v !== null, {});
  return obj;
}

/**
 * v12 -> v13: GameState gained `plannedRamps: PlannedRamp[]` and
 * `nextPlannedRampId: number` (#555 ramp excavation becomes work — a ramp
 * order queues one `dig_ramp_segment` action per segment instead of carving
 * voxels into the grid instantly). A pre-v13 save has no ramps in flight —
 * `plannedRamps` defaults to an empty array and `nextPlannedRampId` to 1,
 * matching `createGame`'s own defaults.
 *
 * The same #555 branch also added `ScoreState.decayRate`, persisted verbatim
 * (no dedicated migration version bump). A pre-v13 save's `scores` object
 * predates it — leaving `decayRate` undefined turns every future
 * `applyDecay` call into `value +/- undefined` (NaN), which never recovers
 * (ScoreManager.ts). Default it here to `createGame`'s own default,
 * `SCORE_DECAY_RATE`. Mutates `obj` in place, matching every other migration
 * block in `deserialize` below.
 */
function migrateV12ToV13(obj: Record<string, unknown>): Record<string, unknown> {
  ensureField(obj, 'plannedRamps', Array.isArray, []);
  ensureField(obj, 'nextPlannedRampId', v => typeof v === 'number', 1);
  ensureField(
    obj['scores'] as Record<string, unknown> | undefined,
    'decayRate',
    v => typeof v === 'number',
    SCORE_DECAY_RATE,
  );
  return obj;
}

/**
 * v13 -> v14: GameState gained `plannedBuildings: PlannedBuilding[]` and
 * `nextPlannedBuildingId: number` (#556 construction sites — placing a
 * building queues one `place_building` action at the target instead of
 * creating the building instantly). A pre-v14 save has no buildings in
 * flight — `plannedBuildings` defaults to an empty array and
 * `nextPlannedBuildingId` to 1, matching `createGame`'s own defaults.
 *
 * Stub (skeleton phase): body wired into the migration chain below but not
 * yet implemented — filled in during the implementation phase.
 */
function migrateV13ToV14(obj: Record<string, unknown>): Record<string, unknown> {
  ensureField(obj, 'plannedBuildings', Array.isArray, []);
  ensureField(obj, 'nextPlannedBuildingId', v => typeof v === 'number', 1);
  return obj;
}

/**
 * A pre-v15 need-gauge value ('hunger' or 'breakNeed') remapped to the
 * survivor gauge ('fatigue') — both removed gauges collapse onto the one
 * gauge that still exists (#928), rather than being dropped, so a save that
 * was mid-rest-for-hunger (say) still resolves to a valid, recognized key
 * instead of a dangling reference to a need that no longer exists.
 */
function remapRemovedNeedKey(value: unknown): unknown {
  return value === 'hunger' || value === 'breakNeed' ? 'fatigue' : value;
}

/**
 * v14 -> v15: Employee.hunger and Employee.breakNeed removed — fatigue is the
 * sole need gauge (#928 — three-gauge well-being simplified to one). A pre-v15
 * save's employees carry both stale fields (stripped below; nothing reads
 * them anymore) and a `restNeedKey`/`pendingRestNeedKey` that may reference
 * either removed gauge (remapped to 'fatigue' via remapRemovedNeedKey rather
 * than nulled, since a genuinely in-flight rest still deserves to resolve
 * through the one completion path that exists after migration).
 * PendingAction payloads carry the same 'hunger'/'breakNeed' values under
 * `needKey`/`collapsedNeed` — remapped identically. SitePolicy lost
 * `hungerRestThreshold`/`socialBreakThreshold` (SitePolicy.ts) — stripped
 * from both the top-level policy object and every per-employee
 * `customThresholds` override. Mutates `obj` in place, matching every other
 * migration block in `deserialize` below.
 */
function migrateV14ToV15(obj: Record<string, unknown>): Record<string, unknown> {
  const employeesContainer = obj['employees'] as Record<string, unknown> | undefined;
  const employeesList = employeesContainer?.['employees'] as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(employeesList)) {
    for (const emp of employeesList) {
      delete emp['hunger'];
      delete emp['breakNeed'];
      if ('restNeedKey' in emp) emp['restNeedKey'] = remapRemovedNeedKey(emp['restNeedKey']);
      if ('pendingRestNeedKey' in emp) emp['pendingRestNeedKey'] = remapRemovedNeedKey(emp['pendingRestNeedKey']);
    }
  }

  const pendingActions = obj['pendingActions'] as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(pendingActions)) {
    for (const action of pendingActions) {
      const payload = action['payload'] as Record<string, unknown> | undefined;
      if (!payload) continue;
      if ('needKey' in payload) payload['needKey'] = remapRemovedNeedKey(payload['needKey']);
      if ('collapsedNeed' in payload) payload['collapsedNeed'] = remapRemovedNeedKey(payload['collapsedNeed']);
    }
  }

  const sitePolicy = obj['sitePolicy'] as Record<string, unknown> | undefined;
  if (sitePolicy) {
    delete sitePolicy['hungerRestThreshold'];
    delete sitePolicy['socialBreakThreshold'];
    const customThresholds = sitePolicy['customThresholds'] as Record<string, Record<string, unknown>> | undefined;
    if (customThresholds) {
      for (const override of Object.values(customThresholds)) {
        delete override['hunger'];
        delete override['social'];
      }
    }
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
    ensureFieldsOnEach(obj, 'vehicles', [
      { key: 'waitingTicks', predicate: v => typeof v === 'number', defaultValue: 0 },
    ]);
  }

  // Restore Set<string> for surveyedPositions
  restoreSetField(obj, 'surveyedPositions');

  // Restore Set<string> for levelStats.uniqueOresExtracted
  const levelStatsRaw = obj['levelStats'] as Record<string, unknown> | undefined;
  restoreSetField(levelStatsRaw, 'uniqueOresExtracted');

  // Ensure event system fields exist for saves created before they were added
  const eventsRaw = obj['events'] as Record<string, unknown> | undefined;
  ensureField(eventsRaw, 'firedEventIds', Array.isArray, []);
  ensureField(eventsRaw, 'lastEventTick', v => typeof v === 'number', 0);
  ensureField(eventsRaw, 'actionCountSinceEvent', v => typeof v === 'number', 0);
  ensureField(eventsRaw, 'cooldownMinIntervalTicks', v => typeof v === 'number', null);

  // Ensure restNeedKey exists on employees saved before the field was added.
  // Absent means "not resting under the general rest path", which is what null
  // encodes — an employee frozen mid-rest in such a save is released by the
  // rest action still sitting in pendingActions.
  // Ensure activeTaskSkill exists on employees saved before the field was
  // added. Absent means "no dispatched-task skill tracked", encoded as null.
  ensureFieldsOnEach(obj, 'employees', [
    { key: 'restNeedKey', predicate: v => v !== undefined, defaultValue: null },
    { key: 'activeTaskSkill', predicate: v => v !== undefined, defaultValue: null },
  ]);

  // #681: RevoltState.immune was removed as a field entirely (no dedicated
  // save-version bump). A save from before the removal — or a hand-edited
  // one — may still carry a stray revolt.immune key; strip it unconditionally
  // (not gated on save version, since it can appear on a current-version
  // save too) so the restored object actually conforms to the RevoltState
  // type it's cast to below.
  const revoltRaw = obj['revolt'] as Record<string, unknown> | undefined;
  if (revoltRaw && 'immune' in revoltRaw) {
    delete revoltRaw['immune'];
  }

  // v4 → v5: collectedOre field added
  ensureField(obj, 'collectedOre', v => typeof v === 'object' && v !== null, {});

  // ghostPreviewsRevision added alongside the renderer's dirty-check gate
  // (#761) — no dedicated save-version bump, so this can't be gated behind
  // a `version < N` check: every save that predates the PR, including the
  // current v13, is missing it. Read unconditionally, like collectedOre/
  // softwareTier above.
  ensureField(obj, 'ghostPreviewsRevision', v => typeof v === 'number', 0);

  // v6 → v7: softwareTier/tubingState moved onto GameState from the
  // console-only MiningContext, so a save from before this had neither.
  ensureField(obj, 'softwareTier', v => typeof v === 'number', 0);
  ensureField(
    obj,
    'tubingState',
    v => typeof v === 'object' && v !== null,
    { inventory: 0, installedHoles: new Set<string>() },
  );
  const tubingRaw = obj['tubingState'] as Record<string, unknown>;
  if (!(tubingRaw['installedHoles'] instanceof Set)) {
    restoreSetField(tubingRaw, 'installedHoles');
  }
  ensureField(tubingRaw, 'inventory', v => typeof v === 'number', 0);

  // v7 → v8: PendingAction/GhostPreview gained a lifecycle (status/holderId,
  // claimed). A pre-v8 save's *dispatched-and-idle-claimed* actions were
  // deleted from pendingActions the instant they were claimed (the bug #547
  // fixes) — but rest actions created by tickCollapse/tickNeedRestoration/
  // forceShiftRestIfNeeded (now split between NeedRestoration.ts and ForceShiftRest.ts) already self-claimed synchronously
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

  // v11 -> v12: GameState.plannedChargesByHole (#554).
  if ((obj['version'] as number) < 12) {
    migrateV11ToV12(obj);
  }

  // v12 -> v13: GameState.plannedRamps / nextPlannedRampId (#555).
  if ((obj['version'] as number) < 13) {
    migrateV12ToV13(obj);
  }

  // v13 -> v14: GameState.plannedBuildings / nextPlannedBuildingId (#556).
  if ((obj['version'] as number) < 14) {
    migrateV13ToV14(obj);
  }

  // v14 -> v15: Employee.hunger/breakNeed removed, fatigue-only (#928).
  if ((obj['version'] as number) < 15) {
    migrateV14ToV15(obj);
  }

  // v6: navGrid is never part of the JSON (see serialize's replacer) — always
  // null here, regardless of what an older save happened to carry. The
  // loader is responsible for rebuilding a real one.
  (obj as Record<string, unknown>)['navGrid'] = null;

  return obj as unknown as GameState;
}
