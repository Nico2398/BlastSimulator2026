// BlastSimulator2026 — Vanity projects: executive-pleasing buildings (#1947)

import type { BuildingType } from './Building.js';
import {
  VANITY_MIN_GRADE,
  VANITY_CEO_STATUE_CONFIDENCE, VANITY_GOLF_COURSE_CONFIDENCE,
  VANITY_EXECUTIVE_HELIPAD_CONFIDENCE, VANITY_GOLD_TOWER_CONFIDENCE,
  VANITY_MORALE_ONCE, VANITY_ECOLOGY_ONCE, VANITY_HELIPAD_NUISANCE_ONCE,
  VANITY_GOLD_TOWER_NUISANCE_ONCE, VANITY_WELL_BEING_ONCE,
} from '../config/balance.js';

export type VanityType = 'ceo_statue' | 'golf_course' | 'executive_helipad' | 'gold_tower';

interface VanityEffects {
  /** Board confidence gained on completion. */
  boardConfidence: number;
  moraleOnce?: number;
  ecologyOnce?: number;
  nuisanceOnce?: number;
  wellBeingOnce?: number;
  /** Building type the footprint must touch. */
  mustTouch?: BuildingType;
}

export const VANITY_PROJECTS: Record<VanityType, VanityEffects> = {
  ceo_statue: { boardConfidence: VANITY_CEO_STATUE_CONFIDENCE, moraleOnce: VANITY_MORALE_ONCE },
  golf_course: { boardConfidence: VANITY_GOLF_COURSE_CONFIDENCE, ecologyOnce: VANITY_ECOLOGY_ONCE, mustTouch: 'spoil_heap' },
  executive_helipad: { boardConfidence: VANITY_EXECUTIVE_HELIPAD_CONFIDENCE, nuisanceOnce: VANITY_HELIPAD_NUISANCE_ONCE },
  gold_tower: {
    boardConfidence: VANITY_GOLD_TOWER_CONFIDENCE,
    nuisanceOnce: VANITY_GOLD_TOWER_NUISANCE_ONCE,
    wellBeingOnce: VANITY_WELL_BEING_ONCE,
  },
};

export function isVanityType(t: BuildingType): t is VanityType {
  return Object.prototype.hasOwnProperty.call(VANITY_PROJECTS, t);
}

/** Whether vanity projects can be built on this site (board attached and grade reached). */
export function isVanityAvailable(site: { hasBoard: boolean; grade: number | undefined }): boolean {
  return site.hasBoard || (site.grade !== undefined && site.grade >= VANITY_MIN_GRADE);
}
