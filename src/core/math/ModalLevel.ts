// BlastSimulator2026 — levels of a set of heights (#2045)
// A dug floor is stepped: a charge leaves a hole bottom below it and a lump above it. Neither the lowest nor the
// highest height names that floor; the level most heights sit on does, or the level a caller aims at.

interface Level {
  /** The level's lowest height, the one it is named by. */
  y: number;
  count: number;
}

/** Finite `heights` grouped into levels: sorted, a new level wherever a height stands more than `toleranceM` above the current one's lowest. */
function levelsOf(heights: Iterable<number>, toleranceM: number): Level[] {
  const levels: Level[] = [];
  for (const h of [...heights].filter(Number.isFinite).sort((a, b) => a - b)) {
    const last = levels.at(-1);
    if (last !== undefined && h - last.y <= toleranceM) last.count++;
    else levels.push({ y: h, count: 1 });
  }
  return levels;
}

/** The lowest height of the level most of `heights` share; the lower level wins a tie. NaN when no height is finite. */
export function modalLevel(heights: Iterable<number>, toleranceM: number): number {
  let best: Level | null = null;
  for (const level of levelsOf(heights, toleranceM)) if (best === null || level.count > best.count) best = level;
  return best?.y ?? NaN;
}

/**
 * The lowest height of the level of `heights` nearest `aimY`; a tie goes to the level more heights share, then to the
 * lower one. Without a finite aim, the modal level. NaN when no height is finite.
 */
export function nearestLevel(heights: Iterable<number>, toleranceM: number, aimY: number): number {
  if (!Number.isFinite(aimY)) return modalLevel(heights, toleranceM);
  let best: Level | null = null;
  for (const level of levelsOf(heights, toleranceM)) {
    if (best === null) { best = level; continue; }
    const d = Math.abs(level.y - aimY);
    const bestD = Math.abs(best.y - aimY);
    if (d < bestD || (d === bestD && level.count > best.count)) best = level;
  }
  return best?.y ?? NaN;
}
