// BlastSimulator2026 — Vanity projects: executive-pleasing buildings (#1947)

import type { BuildingType } from './Building.js';

export type VanityType = 'ceo_statue' | 'golf_course' | 'executive_helipad' | 'gold_tower';

export interface VanityEffects {
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
  ceo_statue: { boardConfidence: 0 },
  golf_course: { boardConfidence: 0 },
  executive_helipad: { boardConfidence: 0 },
  gold_tower: { boardConfidence: 0 },
};

export function isVanityType(t: BuildingType): t is VanityType {
  // TODO: implement
  void t;
  return false;
}

/** Whether vanity projects can be built on this site (board attached and grade reached). */
export function isVanityAvailable(site: { hasBoard: boolean; grade: number | undefined }): boolean {
  // TODO: implement
  void site;
  return false;
}
