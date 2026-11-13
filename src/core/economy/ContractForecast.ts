// BlastSimulator2026 — Contract outlook (#2243)
// Answers "will I make it?" across every active contract at once: per
// material, what is in stock, what is already rolling in on trucks, how fast
// it is being gathered, and how much the active contracts still want — then,
// contract by contract in deadline order, whether stock plus what the current
// pace brings in covers it.
//
// Two contracts on one material share one stock: the earliest deadline draws
// first and the next one only sees what is left, so stock is never counted
// twice. The projection is linear (stock + in transit + rate × hours left);
// ore broken but still lying on the ground is reported, not counted — it only
// becomes stock once someone hauls it.

import type { Contract } from './Contract.js';
import { remainingKg } from './Contract.js';
import { RUBBLE_MATERIAL_ID, collectionRateKgPerHour } from './OreCollectionLog.js';
import { haulDestinationOf, stateRubbleStockKg } from './SpoilHeaps.js';
import { oreGradeScaleOf } from './OreGrade.js';
import { accumulateOreMass } from '../mining/BlastOreReport.js';
import { CONTRACT_OUTLOOK_MISS_RATIO, CONTRACT_OUTLOOK_SAFE_RATIO, TICKS_PER_DAY } from '../config/balance.js';
import type { GameState } from '../state/GameState.js';

/** How one contract (or a whole material) is placed to meet its deadline, best first. */
export type ContractOutlook = 'covered' | 'on_track' | 'at_risk' | 'will_miss';

const OUTLOOK_RANK: Record<ContractOutlook, number> = { covered: 0, on_track: 1, at_risk: 2, will_miss: 3 };

/** The worse of two outlooks. */
export function worseOutlook(a: ContractOutlook, b: ContractOutlook): ContractOutlook {
  return OUTLOOK_RANK[a] >= OUTLOOK_RANK[b] ? a : b;
}

const HOURS_PER_TICK = 24 / TICKS_PER_DAY;

interface ContractForecast {
  readonly contractId: number;
  readonly remainingKg: number;
  readonly hoursLeft: number;
  /** Demand of this contract plus every earlier-deadline contract on the same material. */
  readonly demandByDeadlineKg: number;
  /** Stock, transit and gathering expected by this contract's deadline. */
  readonly projectedKg: number;
  readonly outlook: ContractOutlook;
}

/** One material's line in the overview. */
export interface MaterialOutlook {
  /** Ore id, or RUBBLE_MATERIAL_ID for rubble clearances. */
  readonly materialId: string;
  readonly stockKg: number;
  /** Already loaded on a truck bound for storage. */
  readonly inTransitKg: number;
  /** Broken and lying in the pit, not yet hauled: reported, never counted. */
  readonly onGroundKg: number;
  /** Remaining kg summed over the active contracts on this material. */
  readonly demandKg: number;
  /** Gathered per game-hour over the last day. */
  readonly rateKgPerHour: number;
  /** Pace needed to meet the tightest deadline with what is in hand: the "what we need" to set against the rate. */
  readonly neededRateKgPerHour: number;
  /** Stock + transit + gathering by the last deadline, less all demand: negative is the expected shortfall. */
  readonly spareKg: number;
  /** Hours to the last deadline on this material. */
  readonly horizonHours: number;
  /** Worst outlook among its contracts. */
  readonly outlook: ContractOutlook;
  /** Its active contracts, earliest deadline first. */
  readonly contracts: readonly ContractForecast[];
}

/** Per-material inputs the forecast reads; `forecastFromState` gathers them from a game. */
export interface ForecastInputs {
  readonly active: readonly Contract[];
  readonly tick: number;
  readonly stockKg: Readonly<Record<string, number>>;
  readonly inTransitKg: Readonly<Record<string, number>>;
  readonly onGroundKg: Readonly<Record<string, number>>;
  readonly rateKgPerHour: Readonly<Record<string, number>>;
}

/** Hours before `c`'s deadline at `tick`, never negative. */
export function contractHoursLeft(c: Pick<Contract, 'acceptedAtTick' | 'deadlineTicks'>, tick: number): number {
  return Math.max(0, c.acceptedAtTick + c.deadlineTicks - tick) * HOURS_PER_TICK;
}

/** Material key a contract draws on: its ore, or rubble for a clearance. */
export function contractMaterialKey(c: Pick<Contract, 'type' | 'materialId'>): string {
  return c.type === 'rubble_disposal' ? RUBBLE_MATERIAL_ID : c.materialId;
}

/** Outlook of `demandKg` due when `inHandKg` is held now and `projectedKg` is expected by the deadline. */
export function outlookFor(demandKg: number, inHandKg: number, projectedKg: number): ContractOutlook {
  if (inHandKg >= demandKg) return 'covered';
  if (projectedKg >= demandKg * CONTRACT_OUTLOOK_SAFE_RATIO) return 'on_track';
  if (projectedKg >= demandKg * CONTRACT_OUTLOOK_MISS_RATIO) return 'at_risk';
  return 'will_miss';
}

/** One overview line per material an open contract wants, ordered worst outlook first, then by material id. */
export function forecastContracts(inputs: ForecastInputs): MaterialOutlook[] {
  const byMaterial = new Map<string, Contract[]>();
  for (const c of inputs.active) {
    if (c.completed || c.expired || remainingKg(c) <= 0) continue;
    const key = contractMaterialKey(c);
    const list = byMaterial.get(key) ?? [];
    list.push(c);
    byMaterial.set(key, list);
  }
  const lines: MaterialOutlook[] = [];
  for (const [materialId, contracts] of byMaterial) {
    lines.push(forecastMaterial(materialId, contracts, inputs));
  }
  return lines.sort((a, b) => OUTLOOK_RANK[b.outlook] - OUTLOOK_RANK[a.outlook] || a.materialId.localeCompare(b.materialId));
}

function forecastMaterial(materialId: string, contracts: Contract[], inputs: ForecastInputs): MaterialOutlook {
  const stockKg = inputs.stockKg[materialId] ?? 0;
  const inTransitKg = inputs.inTransitKg[materialId] ?? 0;
  const rate = inputs.rateKgPerHour[materialId] ?? 0;
  const inHand = stockKg + inTransitKg;
  const ordered = [...contracts].sort((a, b) =>
    contractHoursLeft(a, inputs.tick) - contractHoursLeft(b, inputs.tick) || a.id - b.id);
  let cumulative = 0;
  let outlook: ContractOutlook = 'covered';
  let neededRate = 0;
  const forecasts: ContractForecast[] = ordered.map(c => {
    const remaining = remainingKg(c);
    const hoursLeft = contractHoursLeft(c, inputs.tick);
    cumulative += remaining;
    const projected = inHand + rate * hoursLeft;
    const own = outlookFor(cumulative, inHand, projected);
    outlook = worseOutlook(outlook, own);
    const gap = cumulative - inHand;
    // A deadline this hour still needs the whole gap within the hour, not an infinite pace.
    if (gap > 0) neededRate = Math.max(neededRate, gap / Math.max(hoursLeft, HOURS_PER_TICK));
    return { contractId: c.id, remainingKg: remaining, hoursLeft, demandByDeadlineKg: cumulative, projectedKg: projected, outlook: own };
  });
  const horizonHours = forecasts.length > 0 ? forecasts[forecasts.length - 1]!.hoursLeft : 0;
  return {
    materialId, stockKg, inTransitKg, onGroundKg: inputs.onGroundKg[materialId] ?? 0,
    demandKg: cumulative, rateKgPerHour: rate, neededRateKgPerHour: neededRate,
    spareKg: inHand + rate * horizonHours - cumulative, horizonHours, outlook, contracts: forecasts,
  };
}

/**
 * Whether taking `offer` now is safe: what its material would have by the
 * offer's deadline once the active contracts due by then are served, against
 * the kg it asks for.
 */
export function offerOutlook(offer: Contract, inputs: ForecastInputs): ContractOutlook {
  const key = contractMaterialKey(offer);
  const inHand = (inputs.stockKg[key] ?? 0) + (inputs.inTransitKg[key] ?? 0);
  const rate = inputs.rateKgPerHour[key] ?? 0;
  const hours = offer.deadlineTicks * HOURS_PER_TICK;
  let committed = 0;
  for (const c of inputs.active) {
    if (c.completed || c.expired || contractMaterialKey(c) !== key) continue;
    if (contractHoursLeft(c, inputs.tick) <= hours) committed += remainingKg(c);
  }
  const ask = offer.quantityKg + committed;
  return outlookFor(ask, inHand, inHand + rate * hours);
}

/** Per-material kg of the logistics fragments in one state, ore by ore id and barren rock as rubble. */
function fragmentKgByMaterial(state: GameState, which: 'in_transit' | 'on_ground'): Record<string, number> {
  const kg: Record<string, number> = {};
  const gradeScale = oreGradeScaleOf(state.world);
  for (const tracked of state.logistics.fragments) {
    if (tracked.state !== which) continue;
    const f = tracked.fragment;
    if (haulDestinationOf(f, gradeScale) === 'spoil_heap') {
      kg[RUBBLE_MATERIAL_ID] = (kg[RUBBLE_MATERIAL_ID] ?? 0) + f.mass;
      continue;
    }
    accumulateOreMass(kg, f.volume, f.oreDensities);
  }
  return kg;
}

/** The inputs a live game gives the forecast: stock, logistics pipeline, rate log. */
export function forecastInputsFromState(state: GameState): ForecastInputs {
  return {
    active: state.contracts.active,
    tick: state.tickCount,
    stockKg: { ...state.collectedOre, [RUBBLE_MATERIAL_ID]: stateRubbleStockKg(state) },
    inTransitKg: fragmentKgByMaterial(state, 'in_transit'),
    onGroundKg: fragmentKgByMaterial(state, 'on_ground'),
    rateKgPerHour: collectionRateKgPerHour(state.oreCollectionLog, state.tickCount),
  };
}

/** The overview for a live game. */
export function forecastFromState(state: GameState): MaterialOutlook[] {
  return forecastContracts(forecastInputsFromState(state));
}
