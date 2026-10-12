// BlastSimulator2026 — Console command to sound
// Every player action reaches the game as one console command, so this is the single place where an
// accepted order, a hire, a purchase or a refusal gets its sound. One command is one cue (a 60-hole
// drill grid is one `drill_plan grid`), and `tick` is silent, so nothing multiplies at 8x speed.
// The mapping itself is data in commandCueTable.ts.

import type { AudioPlayer, PlayOptions, WorldPoint } from '../AudioPlayer.js';
import { safePlay } from './safePlay.js';
import { COMMAND_CUES, type CueRule, type CueSpec, type VerbRule } from './commandCueTable.js';

/** The shape of ConsoleRunner's ParsedCommand, restated so the audio layer needs nothing from the console. */
export interface ParsedCommandLike {
  readonly command: string;
  readonly args: readonly string[];
  readonly namedArgs: Readonly<Record<string, string>>;
}

export interface CommandCueContext {
  /** True for commands the player did not issue (scripted tutorial steps, automatic pauses): they stay silent. */
  readonly scripted?: boolean;
}

function ownEntry<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

function pickRule(verb: VerbRule, parsed: ParsedCommandLike): CueRule {
  const positional = parsed.args[0];
  const implied = verb.impliedSub;
  const sub = positional ?? (implied !== undefined && parsed.namedArgs[implied.named] !== undefined ? implied.sub : '');
  const rule = verb.subs === undefined ? undefined : ownEntry(verb.subs, sub);
  return rule === undefined ? verb.otherwise : rule;
}

/** Read an `at:x,z` argument; null unless both parts are finite numbers. */
function namedPoint(parsed: ParsedCommandLike): WorldPoint | null {
  const [x, z] = (parsed.namedArgs['at'] ?? '').split(',').map(Number);
  return x !== undefined && z !== undefined && Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null;
}

function playSpec(player: AudioPlayer, spec: CueSpec, parsed: ParsedCommandLike): void {
  if (spec.cue === undefined) return;
  const point = spec.atNamedPoint === true ? namedPoint(parsed) : null;
  const opts: PlayOptions | undefined = point === null ? undefined : { at: point };
  safePlay(player, spec.cue, opts);
  if (spec.then !== undefined) safePlay(player, spec.then.cue, { delayS: spec.then.delayS });
}

/**
 * Voice the outcome of one console command: its success cue, or `ui_denied` when a player-meaningful
 * command was refused. Unknown, periodic and information-only commands play nothing.
 */
export function commandCue(
  player: AudioPlayer,
  parsed: ParsedCommandLike,
  success: boolean,
  ctx?: CommandCueContext,
): void {
  if (ctx?.scripted === true) return;
  const verb = ownEntry(COMMAND_CUES, parsed.command);
  if (verb === undefined) return;
  const rule = pickRule(verb, parsed);
  if (rule === null) return;
  if (!success) {
    safePlay(player, 'ui_denied');
    return;
  }
  playSpec(player, rule, parsed);
}
