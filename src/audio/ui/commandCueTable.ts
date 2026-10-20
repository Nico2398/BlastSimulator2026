// BlastSimulator2026 — Which console command makes which sound
// Pure data. Every verb the console registers is either a key of COMMAND_CUES (it can make a sound) or of
// SILENT_COMMANDS (it never does, with the reason), and a test fails when a new verb is in neither. A
// sub-command is the first positional argument (`employee hire ...`).

import type { OneShotId } from '../SoundCatalog.js';
import { UI_COMMAND_CONFIG } from '../../core/config/audio/ui.js';

/** What a successful command plays; a failed one plays `ui_denied` whenever the rule exists. */
export interface CueSpec {
  /** Cue on success. Absent: the command is audible only when it fails (its success sound belongs to someone else). */
  readonly cue?: OneShotId;
  /** A second cue after a short delay, for cause-and-effect pairs. */
  readonly then?: { readonly cue: OneShotId; readonly delayS: number };
}

/** `null` marks a sub-command that is information only: silent on success and on failure. */
export type CueRule = CueSpec | null;

export interface VerbRule {
  /** Rule per sub-command. */
  readonly subs?: Readonly<Record<string, CueRule>>;
  /** Rule for any other sub-command (including none). */
  readonly otherwise: CueRule;
  /** Sub-command implied by a named argument when no positional one is given (`time speed:4`). */
  readonly impliedSub?: { readonly named: string; readonly sub: string };
}

const ORDER: CueSpec = { cue: 'order_queued' };
const CONFIRM: CueSpec = { cue: 'ui_confirm' };
const BACK: CueSpec = { cue: 'ui_back' };
/** Plays only when the command is refused (its success sound belongs to the game director). */
const DENY_ONLY: CueSpec = {};

/** Cancelling a queued order. */
const CANCELLABLE_ORDER = { subs: { cancel: BACK }, otherwise: ORDER } as const satisfies VerbRule;

/**
 * A new vehicle's engine start belongs to the game director (it spots the vehicle appearing and plays
 * `vehicle_start` at it), and so does the thud of a scrapped one and the coins of a paid delivery:
 * those commands voice only a refusal here. An upgrade keeps its vehicle, so the director sees no new one
 * and the engine start follows the purchase from here.
 */
const VEHICLE_UPGRADE: CueSpec = {
  cue: 'purchase',
  then: { cue: 'vehicle_start', delayS: UI_COMMAND_CONFIG.vehicleStartDelayS },
};

export const COMMAND_CUES: Readonly<Record<string, VerbRule>> = {
  // ── Orders to the crew ──
  survey: { subs: { show: null, mode: null, ore_report: null }, otherwise: ORDER },
  drill_plan: { subs: { grid: ORDER, add: ORDER, clear: BACK, remove: BACK, show: null }, otherwise: null },
  charge: { subs: { show: null }, otherwise: ORDER },
  build_ramp: CANCELLABLE_ORDER,
  ramp: { subs: { spiral: ORDER }, otherwise: null },
  widen_ramp: CANCELLABLE_ORDER,
  level_ground: CANCELLABLE_ORDER,
  drain_hole: { otherwise: ORDER },
  install_tubing: { otherwise: ORDER },
  zone: { subs: { clear: ORDER, status: null }, otherwise: null },
  research: { subs: { queue: ORDER, status: null }, otherwise: null },
  permit: { subs: { apply: CONFIRM, status: null }, otherwise: null },
  board: { subs: { status: null, start: null }, otherwise: null },

  // ── Blasting: the blast director voices the blast itself, a refusal still gets its denial ──
  blast: { subs: { status: null }, otherwise: DENY_ONLY },
  blast_plan: { subs: { save: CONFIRM, load: CONFIRM, validate: null, list: null }, otherwise: null },

  // ── Money, buildings, vehicles, staff ──
  build: {
    subs: { list: null, types: null, destroy: ORDER, upgrade: { cue: 'purchase' }, move: ORDER },
    otherwise: { cue: 'build_placed' },
  },
  vehicle: {
    subs: {
      list: null,
      buy: { cue: 'purchase' },
      upgrade: VEHICLE_UPGRADE,
      scrap: DENY_ONLY,
      haul: ORDER,
      break: ORDER,
      reposition: ORDER,
      driver: CONFIRM,
    },
    otherwise: null,
  },
  employee: {
    subs: {
      list: null,
      candidates: null,
      hire: { cue: 'hire' },
      fire: { cue: 'fire' },
      raise: { cue: 'coins_small' },
      assign_skill: CONFIRM,
      dispatch: ORDER,
      train: ORDER,
      cancel: BACK,
    },
    otherwise: null,
  },
  buy_software: { otherwise: { cue: 'purchase' } },
  buy: { otherwise: { cue: 'purchase' } },
  contract: {
    subs: {
      accept: CONFIRM,
      decline: BACK,
      deliver: DENY_ONLY,
      negotiate: CONFIRM,
      hold: { cue: 'ui_toggle_off' },
      release: { cue: 'ui_toggle_on' },
      list: null,
      status: null,
    },
    otherwise: null,
  },
  set_policy: { otherwise: { cue: 'ui_tab' } },
  event: { subs: { choose: CONFIRM }, otherwise: null },
  corrupt: { otherwise: { cue: 'coins_big' } },
  mafia: { subs: { status: null }, otherwise: CONFIRM },

  // ── Time and persistence ──
  time: {
    subs: { pause: { cue: 'ui_toggle_off' }, resume: { cue: 'ui_toggle_on' }, speed: { cue: 'ui_tab' }, status: null },
    otherwise: null,
    impliedSub: { named: 'speed', sub: 'speed' },
  },
  save: { otherwise: CONFIRM },
  load: { otherwise: CONFIRM },
};

/** Verbs that never make a sound, and why. */
export const SILENT_COMMANDS: Readonly<Record<string, string>> = {
  tick: 'runs once per real second at any speed; a cue per tick is exactly the noise this layer avoids',
  help: 'handled by the runner itself and not a registered handler',
  state: 'JSON dump for tooling',
  stats: 'read-only report',
  scores: 'read-only report',
  needs: 'read-only report',
  finances: 'read-only report',
  fragments: 'read-only report',
  fragment: 'alias of fragments',
  inspect: 'read-only report',
  terrain_info: 'read-only report',
  landscape_info: 'read-only report',
  preview: 'read-only report',
  blast_preview: 'read-only report',
  weather: 'debug control; the weather beds follow the simulated weather, not the command',
  new_game: 'screen transition; loading and level start have their own cues',
  campaign: 'screen transition; level start and end have their own cues',
  sandbox: 'screen transition; level start has its own cues',
  tutorial_start: 'screen transition; the tutorial overlay has its own cues',
};
