// BlastSimulator2026 — Small numeric helpers for the audio directors

import type { Random } from '../../core/math/Random.js';

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Index-free weighted pick from a table of weights; null for an empty or all-zero table. */
export function pickWeighted<T>(random: Random, entries: readonly (readonly [T, number])[]): T | null {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) return null;
  let roll = random.next() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return entries[entries.length - 1]?.[0] ?? null;
}

/** True when `value` appears in a list of plain strings (config lists are literal tuples, so `includes` rejects wider arguments). */
export function listHas(list: readonly string[], value: string): boolean {
  return list.includes(value);
}
