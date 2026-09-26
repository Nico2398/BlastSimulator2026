// BlastSimulator2026 — Shared console command helpers

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import { t } from '../../core/i18n/I18n.js';
import { resolveContractPriceMultiplier } from '../../core/campaign/Level.js';

export { resolveContractPriceMultiplier };

/** Re-evaluates on every call so a runtime language switch (Settings) is reflected. */
export function noEmployeesMessage(): string {
  return t('console.no_employees');
}

/** Trailing " Staffed." suffix (or '') shared by new_game/campaign start/sandbox start success messages. */
export function staffedSuffix(staffed: boolean): string {
  return staffed ? t('console.staffed_suffix') : '';
}

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

/**
 * Parses the `agent_occupancy:true|false` console flag (#1206) shared by
 * `new_game` and `sandbox start` — mirrors `parseStaffedFlag` exactly,
 * defaulting to `undefined` (let `createGame` fall back to
 * `AGENT_OCCUPANCY_ENABLED_DEFAULT`) when omitted, rather than `false`: this
 * flag opts a fresh game in or out explicitly, it does not itself carry a
 * default the way `staffed` does.
 */
export function parseAgentOccupancyFlag(raw: string | undefined): { agentOccupancy: boolean | undefined; error: null } | { agentOccupancy: undefined; error: string } {
  const parsed = parseBooleanFlag(raw);
  if (parsed === null) {
    return { agentOccupancy: undefined, error: t('console.invalid_agent_occupancy_flag', { value: raw! }) };
  }
  return { agentOccupancy: parsed, error: null };
}
