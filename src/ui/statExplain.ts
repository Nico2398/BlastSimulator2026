// BlastSimulator2026 — Explanation texts for employee and candidate stats
//
// What each stat does to the game, translated through t(); every number is read
// from balance.ts. Callers attach the text with explainable() / bindExplain().

/** What proficiency `level` changes: task duration, and the XP needed for the next level. */
export function skillLevelExplain(level: number): string {
  void level;
  throw new Error('not implemented');
}

/** What low and high morale do. */
export function moraleExplain(): string {
  throw new Error('not implemented');
}

/** What the fatigue gauge does and what its threshold tick (the rest policy) means. */
export function fatigueExplain(): string {
  throw new Error('not implemented');
}

/** Which vehicle tiers a licence of `tier` allows. */
export function licenceExplain(tier: number): string {
  void tier;
  throw new Error('not implemented');
}

/** The pay cycle a salary is charged on. */
export function salaryExplain(): string {
  throw new Error('not implemented');
}

/** The salary discount and strike exposure of union membership. */
export function unionExplain(): string {
  throw new Error('not implemented');
}

/** What a bare "h left" counts. */
export function ticksLeftExplain(): string {
  throw new Error('not implemented');
}
