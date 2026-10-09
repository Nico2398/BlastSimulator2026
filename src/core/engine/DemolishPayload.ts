// BlastSimulator2026 — Typed view of a 'demolish_building' action payload (#1392).

/** Payload of a pending 'demolish_building' action. */
export interface DemolishBuildingActionPayload {
  buildingId: number;
  cost: number;
  /** Ticks for a tier-1 destroyer; the live estimate rescales by the reserved vehicle's tier. */
  durationTicks: number;
  footprint: ReadonlyArray<readonly [number, number]>;
  /** Place-building order to queue once the demolition finishes (upgrade/move), or null. */
  rebuildOrderId: number | null;
}

/**
 * Narrow an untyped action payload (PendingAction.payload / task progress
 * actionPayload) to a demolish payload. Missing or mistyped fields fall back
 * to neutral values so a hand-built or restored payload never throws.
 */
export function readDemolishPayload(payload: Readonly<Record<string, unknown>> | null | undefined): DemolishBuildingActionPayload {
  const p = payload ?? {};
  return {
    buildingId: typeof p['buildingId'] === 'number' ? p['buildingId'] : -1,
    cost: typeof p['cost'] === 'number' ? p['cost'] : 0,
    durationTicks: typeof p['durationTicks'] === 'number' ? p['durationTicks'] : 1,
    footprint: Array.isArray(p['footprint']) ? p['footprint'] as DemolishBuildingActionPayload['footprint'] : [],
    rebuildOrderId: typeof p['rebuildOrderId'] === 'number' ? p['rebuildOrderId'] : null,
  };
}
