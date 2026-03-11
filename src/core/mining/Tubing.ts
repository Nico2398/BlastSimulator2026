// BlastSimulator2026 — Tubing / casing system
// Player buys tubing units and installs them in drill holes to waterproof them.
// Tubing prevents water infiltration from rain, protecting water-sensitive explosives.

// ── Config ──

/** Cost per tubing unit in game dollars. */
// Real casing: ~$10-50/m for PVC, $100-500/m for steel. Scaled for gameplay.
export const TUBING_COST = 50;

// ── State ──

export interface TubingState {
  /** Number of tubing units in inventory. */
  inventory: number;
  /** Set of hole IDs with tubing installed. */
  installedHoles: Set<string>;
}

export function createTubingState(): TubingState {
  return { inventory: 0, installedHoles: new Set() };
}

// ── Operations ──

export interface TubingResult {
  success: boolean;
  message: string;
  cost: number;
}

/** Buy tubing units. */
export function buyTubing(
  state: TubingState,
  amount: number,
  cash: number,
): TubingResult {
  if (amount <= 0) {
    return { success: false, message: 'Amount must be positive', cost: 0 };
  }
  const totalCost = amount * TUBING_COST;
  if (cash < totalCost) {
    return { success: false, message: `Insufficient funds: need $${totalCost}, have $${cash}`, cost: 0 };
  }
  state.inventory += amount;
  return { success: true, message: `Bought ${amount} tubing units`, cost: totalCost };
}

/** Install tubing on a drill hole. */
export function installTubing(
  state: TubingState,
  holeId: string,
): TubingResult {
  if (state.inventory <= 0) {
    return { success: false, message: 'No tubing in inventory', cost: 0 };
  }
  if (state.installedHoles.has(holeId)) {
    return { success: false, message: `Tubing already installed on hole ${holeId}`, cost: 0 };
  }
  state.inventory--;
  state.installedHoles.add(holeId);
  return { success: true, message: `Tubing installed on hole ${holeId}`, cost: 0 };
}

/** Check if a hole has tubing installed. */
export function hasTubing(state: TubingState, holeId: string): boolean {
  return state.installedHoles.has(holeId);
}
