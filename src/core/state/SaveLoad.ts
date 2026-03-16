// BlastSimulator2026 — Serialization / deserialization
// Pure functions: GameState ↔ JSON string.

import type { GameState } from './GameState.js';
import { SAVE_VERSION } from './GameState.js';

/**
 * Serialize a GameState to a JSON string.
 * Handles Set→Array conversion for surveyedPositions.
 */
export function serialize(state: GameState): string {
  return JSON.stringify(state, (_key, value) => {
    if (value instanceof Set) return { __type: 'Set', values: [...value] };
    return value as unknown;
  });
}

/**
 * Deserialize a JSON string back to a GameState.
 * Throws a clear error if the version is unknown.
 */
export function deserialize(json: string): GameState {
  const parsed: unknown = JSON.parse(json);

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid save data: expected a JSON object');
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj['version'] !== 'number') {
    throw new Error('Invalid save data: missing version field');
  }

  if (obj['version'] > SAVE_VERSION) {
    throw new Error(
      `Unknown save version: ${obj['version']}. ` +
      `This game supports up to version ${SAVE_VERSION}. ` +
      `Please update the game.`
    );
  }

  // Future: add migration logic for older versions here.

  // Restore Set<string> for surveyedPositions
  const raw = obj['surveyedPositions'] as unknown;
  if (raw && typeof raw === 'object' && '__type' in (raw as Record<string, unknown>)) {
    const setData = raw as { __type: string; values: string[] };
    if (setData.__type === 'Set') {
      (obj as Record<string, unknown>)['surveyedPositions'] = new Set(setData.values);
    }
  } else if (Array.isArray(raw)) {
    (obj as Record<string, unknown>)['surveyedPositions'] = new Set(raw as string[]);
  } else {
    (obj as Record<string, unknown>)['surveyedPositions'] = new Set<string>();
  }

  // Restore Set<string> for levelStats.uniqueOresExtracted
  const levelStatsRaw = obj['levelStats'] as Record<string, unknown> | undefined;
  if (levelStatsRaw) {
    const ores = levelStatsRaw['uniqueOresExtracted'];
    if (ores && typeof ores === 'object' && '__type' in (ores as Record<string, unknown>)) {
      const setData = ores as { __type: string; values: string[] };
      if (setData.__type === 'Set') {
        levelStatsRaw['uniqueOresExtracted'] = new Set(setData.values);
      }
    } else if (Array.isArray(ores)) {
      levelStatsRaw['uniqueOresExtracted'] = new Set(ores as string[]);
    } else {
      levelStatsRaw['uniqueOresExtracted'] = new Set<string>();
    }
  }

  return obj as unknown as GameState;
}
