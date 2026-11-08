// BlastSimulator2026 — Explanation texts for the world map and the level-end stats
//
// What a star, a difficulty chip and each level-end stat mean, translated through t();
// every number is read from balance.ts or the level. Callers attach the text with explainable().

export type LevelEndStatId =
  | 'profit' | 'days' | 'blasts' | 'volume' | 'max_depth' | 'unique_ores' | 'casualties' | 'best_safety'
  | 'quarters_survived' | 'final_balance' | 'salaries_paid' | 'fines_paid' | 'exposure_at_arrest'
  | 'arrangements_made' | 'corruption_level' | 'final_ecology' | 'best_ecology' | 'final_wellbeing' | 'shift_mode';

/** The three star criteria, and whether this star is earned. */
export function starExplain(_earned: boolean, _target: number): string {
  throw new Error('not implemented');
}

/** What a level's difficulty tier is and changes. */
export function difficultyExplain(_tier: number, _target: number): string {
  throw new Error('not implemented');
}

/** What a level-end stat measures. */
export function levelEndStatExplain(_id: LevelEndStatId): string {
  throw new Error('not implemented');
}
