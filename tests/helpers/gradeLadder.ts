// BlastSimulator2026 — test helpers for the grade x tier permit ladder (#2277)
//
// Everything here reads the balance table (`MINE_GRADES`, `PERMIT_LIMITS`), never a hand-copied
// number, so a re-tuned ladder keeps the tests honest about behaviour rather than about tuning.

import {
  MINE_GRADES,
  type MineGradeTargetConfig,
  type MineTierPerkKind,
} from '../../src/core/config/balance.js';
import { createGradeState, type GradeState } from '../../src/core/economy/MineGrade.js';
import { createGame, type GameState } from '../../src/core/state/GameState.js';

/** Named grades of the ladder. */
export const NAMED_GRADES = [0, 1, 2, 3] as const;
/** Tiers of each named grade. */
export const TIERS = [1, 2, 3] as const;
/** Ladder steps 0..11 (grade x 3 + tier - 1). */
export const RUNGS = Array.from({ length: 12 }, (_, i) => i);

/** Ladder step of a named grade and tier. */
export const rungOf = (grade: number, tier: number): number => grade * 3 + tier - 1;

/** The (grade, tier) of a named ladder step. */
export function gradeTierOfRung(rung: number): { grade: number; tier: number } {
  return { grade: Math.floor(rung / 3), tier: (rung % 3) + 1 };
}

/** Targets of one tier, straight from the table. */
export function tierTargets(grade: number, tier: number): readonly MineGradeTargetConfig[] {
  return MINE_GRADES[grade]!.tiers[tier - 1]!.targets;
}

/** Needed value of one target kind of one tier. */
export function tierNeeded(grade: number, tier: number, kind: MineGradeTargetConfig['kind']): number {
  const found = tierTargets(grade, tier).find(t => t.kind === kind);
  if (!found) throw new Error(`grade ${grade} tier ${tier} has no ${kind} target`);
  return found.value;
}

/** Perk of each kind in force at a ladder step: the table's perk values summed over rungs 1..rung (capped at 11). */
export function perkTotals(rung: number): Record<MineTierPerkKind, number> {
  const out: Record<MineTierPerkKind, number> = { notification_fee_pct: 0, processing_pct: 0, inspection_pct: 0, contract_offers: 0 };
  const top = Math.min(rung, 11);
  for (let r = 1; r <= top; r++) {
    const { grade, tier } = gradeTierOfRung(r);
    const perk = MINE_GRADES[grade]!.tiers[tier - 1]!.perk;
    if (perk) out[perk.kind] += perk.value;
  }
  return out;
}

/** A progression site with every score target unmet until a test raises it. */
export function progressionState(grade: Partial<GradeState> = {}): GameState {
  const state = createGame({ seed: 42 });
  state.grade = { ...createGradeState(), ...grade };
  state.scores.safety = 0;
  state.scores.ecology = 0;
  state.scores.nuisance = 0;
  return state;
}

/** Raises the state's counters and scores to meet (exactly) every given target; counters never go down. */
export function meetTargets(state: GameState, targets: readonly MineGradeTargetConfig[]): void {
  const g = state.grade!;
  for (const { kind, value } of targets) {
    switch (kind) {
      case 'ore_kg': g.oreDeliveredKg = Math.max(g.oreDeliveredKg, value); break;
      case 'blasts': g.blastsFired = Math.max(g.blastsFired, value); break;
      case 'depth_m': g.deepestPitM = Math.max(g.deepestPitM, value); break;
      case 'rock_m3': g.rockBrokenM3 = Math.max(g.rockBrokenM3, value); break;
      case 'safety': state.scores.safety = Math.max(state.scores.safety, value); break;
      case 'ecology': state.scores.ecology = Math.max(state.scores.ecology, value); break;
      case 'neighbours': state.scores.nuisance = Math.max(state.scores.nuisance, value); break;
      case 'no_death': break; // met while nobody has died inside the window
    }
  }
}

/** A site at (grade, tier) whose counters meet that tier's own targets and nothing beyond. */
export function siteMeetingTier(grade: number, tier: number): GameState {
  const state = progressionState({ grade, tier });
  meetTargets(state, tierTargets(grade, tier));
  return state;
}

/** A site at tier 3 of a named grade with the tier-3 targets and the zone mastery met and cash to spare: ready to apply. */
export function siteReadyForNextGrade(grade = 0): GameState {
  const state = progressionState({ grade, tier: 3 });
  meetTargets(state, tierTargets(grade, 3));
  meetTargets(state, MINE_GRADES[grade]!.mastery);
  state.cash = 1_000_000_000;
  return state;
}
