// BlastSimulator2026 — Progression probe metrics: the per-tick observer and run result (#1922)

import type { GameState } from '../../src/core/state/GameState.js';
import type { BlastReport, FragmentData } from '../../src/core/mining/BlastExecution.js';
import { isOversized } from '../../src/core/mining/BlastCalc.js';
import { accumulateOreMass } from '../../src/core/mining/BlastOreReport.js';
import { BUILDING_TIERS, getAllBuildingTypes, getBuildingDef, getUpgradeCost, isSingleTierType } from '../../src/core/entities/Building.js';
import { getAllVehicleRoles, getVehicleDefByTier } from '../../src/core/entities/Vehicle.js';
import { HIRING_COSTS } from '../../src/core/config/balance.js';
import type { ProbeRunConfig } from './probe-config.js';

/** Ticks at which cash is sampled for the report. */
export const CASH_SAMPLE_TICKS = [1000, 3000, 6000, 10000, 15000, 25000, 40000, 50000] as const;

interface ProbeMetrics {
  cashAt: Record<number, number | null>;
  lowPointCash: number;
  lowPointTick: number;
  bankruptTick: number | null;
  firstBlastSoldShareAt6000: number | null;
  blastsFired: number;
  warehouseFullTick: number | null;
  ticksHaulWaitedOnFullStorage: number;
  boulderSoldShare: number | null;
  gradeReachedTick: Record<number, number>;
  /** Cash at the tick each grade was first reached, by grade. */
  gradeCashAt: Record<number, number>;
  /** First tick every building type is owned at its max purchasable tier and every vehicle role at tier 3; null if never. */
  catalogBoughtTick: number | null;
  /** Share of boulder-origin ore that was delivered or sold (no longer in the world), null without boulder ore. */
  boulderOreSoldShare: number | null;
  affordableTick: {
    warehouseT2: number | null;
    researchCenter: number | null;
    secondHauler: number | null;
  };
}

export interface RunResult {
  config: ProbeRunConfig;
  metrics: ProbeMetrics;
  endTick: number;
  endReason: string | null;
}

/** Ticks between catalog-ownership checks: owning the whole catalog is read, not tracked per purchase. */
const CATALOG_CHECK_INTERVAL_TICKS = 50;
const MAX_VEHICLE_TIER = 3;

/** True when every building type is owned at its max purchasable tier and every vehicle role at tier 3. */
function ownsWholeCatalog(state: GameState): boolean {
  const buildings = state.buildings?.buildings ?? []; // partial states (unit fixtures) carry no buildings
  const vehicles = state.vehicles?.vehicles ?? [];
  const topBuildingTier = BUILDING_TIERS[BUILDING_TIERS.length - 1]!;
  return getAllBuildingTypes().every(type => {
    const need = isSingleTierType(type) ? 1 : topBuildingTier;
    return buildings.some(b => b.type === type && b.tier >= need);
  }) && getAllVehicleRoles().every(role => vehicles.some(v => v.type === role && v.tier >= MAX_VEHICLE_TIER));
}

/** A fragment's lineage key: its origin, shared by the pieces a split leaves (the id for a hand-built fragment without one). */
const originKey = (f: Pick<FragmentData, 'id' | 'origin'>): string => (f.origin ? `${f.origin.x},${f.origin.y},${f.origin.z}` : `id${f.id}`);

/** Ticks between boulder re-scans: the only O(fragments) work the observer does outside a blast. */
const BOULDER_SCAN_INTERVAL_TICKS = 50;
/** Tick by which the first blast's sold share is read. */
const FIRST_BLAST_SOLD_TICK = 6000;

/** Ore kg (all ore types) inside `fragments`, summed per ore type first and then across types. */
export function fragmentOreKg(fragments: Iterable<Pick<FragmentData, 'volume' | 'oreDensities'>>): number {
  const ore: Record<string, number> = {};
  for (const f of fragments) accumulateOreMass(ore, f.volume, f.oreDensities);
  return Object.values(ore).reduce((a, b) => a + b, 0);
}

/**
 * Reads the game once per tick and condenses the run into ProbeMetrics. Pure
 * reader: never writes state. Per-tick work walks the pending-action list only;
 * fragment scans happen on a blast and every BOULDER_SCAN_INTERVAL_TICKS.
 *
 * Definitions where the issue leaves room:
 * - first blast sold share: ore kg delivered through ore_sale/supply contracts
 *   (grade tracker) up to t6000 or the second blast, over the ore in the first
 *   blast's fragments. Null off the progression ladder (no grade state).
 * - boulder sold share: boulder ore (oversized fragments at blast time) that is
 *   no longer lying as a boulder (broken, hauled or sold). Broken pieces are new
 *   fragments, so "sold" cannot be told from "broken" without lineage; this is
 *   an upper-bound proxy (100% carries little information). Null without a
 *   fragmenter or boulder ore.
 * - low point: the global run minimum of cash, not strictly the opening's dip.
 * - affordable ticks: first tick cash covers the catalog cost (in-place upgrade
 *   cost for the warehouse; vehicle price plus a driver's hiring fee for the hauler).
 */
export class MetricsObserver {
  private readonly cashAt: Record<number, number | null> = {};
  private lowPointCash = Infinity;
  private lowPointTick = 0;
  private bankruptTick: number | null = null;
  private blastsFired = 0;
  private lastReport: BlastReport | null = null;
  private firstBlastOreKg: number | null = null;
  private soldAtSecondBlastKg: number | null = null;
  private soldAt6000Kg: number | null = null;
  private warehouseFullTick: number | null = null;
  private haulWaitTicks = 0;
  /** Ore kg of each boulder still lying on the ground, by fragment id. */
  private readonly boulderOreKg = new Map<number, number>();
  private boulderTotalKg = 0;
  /** Ore kg of every boulder seen at a blast, by origin key: a split's pieces keep their parent's origin. */
  private readonly boulderOriginOreKg = new Map<string, number>();
  private catalogBoughtTick: number | null = null;
  private readonly gradeCashAt: Record<number, number> = {};
  private lastState: GameState | null = null;
  private readonly gradeReachedTick: Record<number, number> = {};
  private grade = 0;
  private readonly affordableTick: ProbeMetrics['affordableTick'] = {
    warehouseT2: null, researchCenter: null, secondHauler: null,
  };
  private readonly costs = {
    warehouseT2: getUpgradeCost('freight_warehouse', 2),
    researchCenter: getBuildingDef('research_center', 1).constructionCost,
    secondHauler: getVehicleDefByTier('debris_hauler', 1).purchaseCost + HIRING_COSTS.driver,
  };

  constructor() {
    for (const t of CASH_SAMPLE_TICKS) this.cashAt[t] = null;
  }

  onTick(state: GameState): void {
    this.lastState = state;
    const t = state.tickCount;
    for (const sample of CASH_SAMPLE_TICKS) {
      if (this.cashAt[sample] === null && t >= sample) this.cashAt[sample] = state.cash;
    }
    if (state.cash < this.lowPointCash) { this.lowPointCash = state.cash; this.lowPointTick = t; }
    if (this.bankruptTick === null && (state.bankruptcy.bankrupt || state.levelEndReason === 'bankruptcy')) {
      this.bankruptTick = t;
    }
    this.observeBlast(state);
    this.observeStorage(state);
    this.observeProgress(state);
    if (t === FIRST_BLAST_SOLD_TICK || (this.soldAt6000Kg === null && t > FIRST_BLAST_SOLD_TICK)) {
      this.soldAt6000Kg = this.soldAtSecondBlastKg ?? state.grade?.oreDeliveredKg ?? null;
    }
    if (t > 0 && t % BOULDER_SCAN_INTERVAL_TICKS === 0) this.pruneBoulders(state);
    if (this.catalogBoughtTick === null && t % CATALOG_CHECK_INTERVAL_TICKS === 0 && ownsWholeCatalog(state)) {
      this.catalogBoughtTick = t;
    }
  }

  private observeBlast(state: GameState): void {
    const report = state.lastBlastReport;
    if (!report || report === this.lastReport) return;
    this.lastReport = report;
    this.blastsFired++;
    if (this.blastsFired === 1) {
      this.firstBlastOreKg = fragmentOreKg(state.logistics.fragments.map(f => f.fragment));
    } else if (this.blastsFired === 2) {
      this.soldAtSecondBlastKg = state.grade?.oreDeliveredKg ?? null;
    }
    for (const f of state.logistics.fragments) {
      if (f.state !== 'on_ground' || !isOversized(f.fragment.volume) || this.boulderOreKg.has(f.fragment.id)) continue;
      const kg = fragmentOreKg([f.fragment]);
      if (kg <= 0) continue;
      this.boulderOriginOreKg.set(originKey(f.fragment), kg);
      this.boulderOreKg.set(f.fragment.id, kg);
      this.boulderTotalKg += kg;
    }
  }

  private observeStorage(state: GameState): void {
    const t = state.tickCount;
    let waiting = false;
    for (const a of state.pendingActions) {
      if (a.blockedReason === 'storage_full') { waiting = true; break; }
    }
    if (waiting) this.haulWaitTicks++;
    const full = state.logistics.storageCapacityKg > 0 && state.logistics.storedMassKg >= state.logistics.storageCapacityKg;
    if (this.warehouseFullTick === null && (waiting || full)) this.warehouseFullTick = t;
  }

  private observeProgress(state: GameState): void {
    const t = state.tickCount;
    const grade = state.grade?.grade ?? 0;
    for (; this.grade < grade; this.grade++) {
      this.gradeReachedTick[this.grade + 1] = t;
      this.gradeCashAt[this.grade + 1] = state.cash;
    }
    for (const key of Object.keys(this.costs) as Array<keyof typeof this.costs>) {
      if (this.affordableTick[key] === null && state.cash >= this.costs[key]) this.affordableTick[key] = t;
    }
  }

  /** Drop tracked boulders that no longer lie on the ground as boulders. */
  private pruneBoulders(state: GameState): void {
    if (this.boulderOreKg.size === 0) return;
    const standing = new Set<number>();
    for (const f of state.logistics.fragments) {
      if (f.state === 'on_ground') standing.add(f.fragment.id);
    }
    for (const id of [...this.boulderOreKg.keys()]) {
      if (!standing.has(id)) this.boulderOreKg.delete(id);
    }
  }

  finalize(): ProbeMetrics {
    return {
      cashAt: { ...this.cashAt },
      lowPointCash: Number.isFinite(this.lowPointCash) ? this.lowPointCash : 0,
      lowPointTick: this.lowPointTick,
      bankruptTick: this.bankruptTick,
      firstBlastSoldShareAt6000: this.soldShare(),
      blastsFired: this.blastsFired,
      warehouseFullTick: this.warehouseFullTick,
      ticksHaulWaitedOnFullStorage: this.haulWaitTicks,
      boulderSoldShare: this.boulderShare(),
      gradeReachedTick: { ...this.gradeReachedTick },
      gradeCashAt: { ...this.gradeCashAt },
      catalogBoughtTick: this.catalogBoughtTick,
      boulderOreSoldShare: this.boulderOreSoldShare(),
      affordableTick: { ...this.affordableTick },
    };
  }

  private soldShare(): number | null {
    if (this.soldAt6000Kg === null || !this.firstBlastOreKg) return null;
    return Math.min(1, this.soldAt6000Kg / this.firstBlastOreKg);
  }

  /**
   * Boulder-origin ore no longer in the world (delivered or sold) over all boulder ore seen at blasts.
   * Pieces of a split keep their parent's origin and ore density, so the ore still in the world is
   * the sum over fragments carrying a tracked origin. One fragment scan, at finalize.
   */
  private boulderOreSoldShare(): number | null {
    const state = this.lastState;
    let total = 0;
    for (const kg of this.boulderOriginOreKg.values()) total += kg;
    if (!state || total <= 0) return null;
    const remaining = fragmentOreKg(state.logistics.fragments
      .filter(f => this.boulderOriginOreKg.has(originKey(f.fragment)))
      .map(f => f.fragment));
    return Math.max(0, Math.min(1, 1 - remaining / total));
  }

  private boulderShare(): number | null {
    const state = this.lastState;
    if (!state || this.boulderTotalKg <= 0) return null;
    if (!state.vehicles.vehicles.some(v => v.type === 'rock_fragmenter')) return null;
    this.pruneBoulders(state);
    return 1 - [...this.boulderOreKg.values()].reduce((a, b) => a + b, 0) / this.boulderTotalKg;
  }
}
