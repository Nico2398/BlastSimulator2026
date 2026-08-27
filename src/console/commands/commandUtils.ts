// BlastSimulator2026 — Shared console command helpers

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import { t } from '../../core/i18n/I18n.js';

export const NO_EMPLOYEES_MSG = t('console.no_employees');

/** Guard every command that needs a loaded game. */
export function requireGame(ctx: GameContext): CommandResult | null {
  if (!ctx.state) return { success: false, output: t('console.no_game_loaded') };
  return null;
}

/**
 * Sanitizes an already-parsed numeric console-arg override: keeps it only if
 * finite (rejects NaN and ±Infinity) and, when `opts.min` is given, only if
 * `>= opts.min` (inclusive). Returns undefined otherwise so the caller falls
 * back to its own default. Takes the parsed number, not the raw string —
 * callers keep their own `parseInt`/`parseFloat` choice.
 */
export function sanitizeFiniteOverride(parsed: number, opts?: { min?: number }): number | undefined {
  if (!Number.isFinite(parsed)) return undefined;
  if (opts?.min !== undefined && parsed < opts.min) return undefined;
  return parsed;
}

/**
 * Parses a raw named-arg string as a boolean flag. Returns `undefined` when
 * the flag was not passed, `null` when it was passed with an unrecognized
 * value, so callers can distinguish "not given" from "invalid".
 */
function parseBooleanFlag(raw: string | undefined): boolean | undefined | null {
  if (raw === undefined) return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return null;
}

/**
 * Parses the `staffed:true|false` console flag shared by `new_game` and
 * `sandbox start`, defaulting to `false` when omitted. Returns an error
 * message when the raw value is present but not `true`/`false`, so both
 * callers can surface one unified message instead of duplicating the check.
 */
export function parseStaffedFlag(raw: string | undefined): { staffed: boolean; error: null } | { staffed: false; error: string } {
  const parsed = parseBooleanFlag(raw);
  if (parsed === null) {
    return { staffed: false, error: t('console.invalid_staffed_flag', { value: raw! }) };
  }
  return { staffed: parsed === true, error: null };
}
