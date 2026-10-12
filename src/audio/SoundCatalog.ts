// BlastSimulator2026 — Sound catalog
// The one table that says what every sound in the game is: which bus it plays
// on, where its audio comes from (a decoded sample or a synthesized recipe),
// how loud it is, how it varies from play to play and how it is rate-limited.
// Adding a sound is adding an entry here (plus its file in public/audio/sfx/ or
// its recipe in synth/recipes.ts); nothing that consumes the catalog changes.
//
// Level convention. Every sample file is normalised to -18 dBFS gated RMS with a
// -1 dBFS peak ceiling (see public/audio/CREDITS.md); every synth recipe is
// rendered to the same level (loops: -26 dBFS). `gainDb` is the trim against
// that reference, so 0 means "as loud as an ordinary effect".

/** Buses a sound can play on: the user-facing volume sliders other than master/music. */
export type SoundBus = 'effects' | 'ambient' | 'ui';

/** Procedural sounds rendered at startup by src/audio/synth. */
export type SynthRecipeId =
  | 'blast_sub'
  | 'blast_tail'
  | 'blast_beep'
  | 'blast_cancel'
  | 'siren_loop'
  | 'thunder'
  | 'wind_bed'
  | 'rain_light_bed'
  | 'rain_heavy_bed'
  | 'machinery_bed';

interface SampleSource {
  readonly kind: 'sample';
  /** File basenames under AUDIO_ASSET_BASE (no extension). One is picked per play, never the same twice in a row. */
  readonly files: readonly string[];
}

interface SynthSource {
  readonly kind: 'synth';
  readonly recipe: SynthRecipeId;
}

export interface SoundDefinition {
  readonly bus: SoundBus;
  readonly source: SampleSource | SynthSource;
  /** Trim in dB against the normalised asset level. */
  readonly gainDb: number;
  /** +/- random pitch change per play, in cents. */
  readonly pitchJitterCents?: number;
  /** +/- random level change per play, in dB. */
  readonly gainJitterDb?: number;
  /** Minimum gap in ms between two plays sharing a cooldown key (default key = the sound id). */
  readonly cooldownMs?: number;
  /** Concurrent instances; at the cap the newest play is dropped. */
  readonly maxVoices?: number;
  /** 1 background .. 4 never dropped for budget: who survives a full global voice budget. */
  readonly priority: 1 | 2 | 3 | 4;
  /** Positional (pan, distance gain, air absorption) when the caller passes `at`. */
  readonly spatial?: boolean;
  /** 0..1 send level into the shared outdoor reverb. */
  readonly reverbSend?: number;
  /** Seamless looped bed driven through `AudioPlayer.loop`. Synth sources only. */
  readonly loop?: true;
}

const sample = (...files: string[]): SampleSource => ({ kind: 'sample', files });
const synth = (recipe: SynthRecipeId): SynthSource => ({ kind: 'synth', recipe });

export const SOUND_CATALOG = {
  // ── Interface: generic controls (delegated from the DOM) ──
  ui_click: { bus: 'ui', source: sample('ui_click_1', 'ui_click_2'), gainDb: -6, pitchJitterCents: 60, cooldownMs: 25, maxVoices: 3, priority: 2 },
  ui_hover: { bus: 'ui', source: sample('ui_hover'), gainDb: -14, cooldownMs: 70, maxVoices: 2, priority: 1 },
  ui_open: { bus: 'ui', source: sample('ui_open'), gainDb: -6, cooldownMs: 60, maxVoices: 2, priority: 2 },
  ui_close: { bus: 'ui', source: sample('ui_close'), gainDb: -6, cooldownMs: 60, maxVoices: 2, priority: 2 },
  ui_tab: { bus: 'ui', source: sample('ui_tab'), gainDb: -7, cooldownMs: 60, maxVoices: 2, priority: 2 },
  ui_toggle_on: { bus: 'ui', source: sample('ui_toggle_on'), gainDb: -6, cooldownMs: 40, maxVoices: 2, priority: 2 },
  ui_toggle_off: { bus: 'ui', source: sample('ui_toggle_off'), gainDb: -6, cooldownMs: 40, maxVoices: 2, priority: 2 },
  ui_slider: { bus: 'ui', source: sample('ui_slider'), gainDb: -9, pitchJitterCents: 40, cooldownMs: 55, maxVoices: 2, priority: 1 },
  ui_denied: { bus: 'ui', source: sample('ui_denied'), gainDb: -3, cooldownMs: 120, maxVoices: 2, priority: 3 },
  ui_error: { bus: 'ui', source: sample('ui_error'), gainDb: -3, cooldownMs: 150, maxVoices: 2, priority: 3 },
  ui_confirm: { bus: 'ui', source: sample('ui_confirm'), gainDb: -4, cooldownMs: 60, maxVoices: 2, priority: 2 },
  ui_back: { bus: 'ui', source: sample('ui_back'), gainDb: -7, cooldownMs: 60, maxVoices: 2, priority: 2 },
  ui_select: { bus: 'ui', source: sample('ui_select'), gainDb: -6, pitchJitterCents: 50, cooldownMs: 50, maxVoices: 2, priority: 2 },
  ui_invalid: { bus: 'ui', source: sample('ui_invalid'), gainDb: -4, cooldownMs: 250, maxVoices: 1, priority: 2 },
  ui_modal: { bus: 'ui', source: sample('ui_modal'), gainDb: -5, cooldownMs: 200, maxVoices: 1, priority: 2 },

  // ── Interface: notifications and event alerts ──
  notify_info: { bus: 'ui', source: sample('notify_info'), gainDb: -6, cooldownMs: 400, maxVoices: 2, priority: 2 },
  notify_good: { bus: 'ui', source: sample('notify_good'), gainDb: -4, cooldownMs: 400, maxVoices: 2, priority: 3 },
  notify_warn: { bus: 'ui', source: sample('notify_warn'), gainDb: -3, cooldownMs: 500, maxVoices: 2, priority: 3 },
  notify_bad: { bus: 'ui', source: sample('notify_bad'), gainDb: -2, cooldownMs: 600, maxVoices: 2, priority: 3 },
  notify_alert: { bus: 'ui', source: sample('notify_alert'), gainDb: -1, cooldownMs: 1000, maxVoices: 1, priority: 4 },
  event_union: { bus: 'ui', source: sample('event_union'), gainDb: -4, cooldownMs: 1000, maxVoices: 1, priority: 3 },
  event_lawsuit: { bus: 'ui', source: sample('event_lawsuit'), gainDb: -4, cooldownMs: 1000, maxVoices: 1, priority: 3 },
  event_mafia: { bus: 'ui', source: sample('event_mafia'), gainDb: -4, cooldownMs: 1000, maxVoices: 1, priority: 3 },
  event_politics: { bus: 'ui', source: sample('event_politics'), gainDb: -4, cooldownMs: 1000, maxVoices: 1, priority: 3 },

  // ── Interface: orders, staff, money ──
  order_queued: { bus: 'ui', source: sample('order_queued'), gainDb: -5, cooldownMs: 120, maxVoices: 2, priority: 2 },
  order_done: { bus: 'ui', source: sample('order_done'), gainDb: -9, cooldownMs: 250, maxVoices: 2, priority: 1 },
  build_placed: { bus: 'effects', source: sample('place_1', 'place_2', 'place_3', 'place_4'), gainDb: -4, pitchJitterCents: 80, cooldownMs: 120, maxVoices: 2, priority: 2 },
  hire: { bus: 'ui', source: sample('hire'), gainDb: -3, cooldownMs: 150, maxVoices: 2, priority: 2 },
  fire: { bus: 'ui', source: sample('fire'), gainDb: -3, cooldownMs: 150, maxVoices: 2, priority: 2 },
  purchase: { bus: 'ui', source: sample('purchase'), gainDb: -3, cooldownMs: 150, maxVoices: 2, priority: 2 },
  unlock: { bus: 'ui', source: sample('unlock'), gainDb: -4, cooldownMs: 300, maxVoices: 1, priority: 3 },
  level_up: { bus: 'ui', source: sample('level_up'), gainDb: -7, cooldownMs: 600, maxVoices: 1, priority: 2 },
  coins_small: { bus: 'ui', source: sample('coins_small'), gainDb: -6, pitchJitterCents: 100, cooldownMs: 500, maxVoices: 2, priority: 2 },
  coins_big: { bus: 'ui', source: sample('coins_big'), gainDb: -4, cooldownMs: 800, maxVoices: 1, priority: 2 },
  cash_till: { bus: 'ui', source: sample('cash_till'), gainDb: -4, cooldownMs: 1500, maxVoices: 1, priority: 3 },

  // ── World: construction, vehicles, crew ──
  building_built: { bus: 'effects', source: sample('impact_plate_1', 'impact_plate_2'), gainDb: -2, pitchJitterCents: 120, cooldownMs: 300, maxVoices: 2, priority: 2, spatial: true, reverbSend: 0.2 },
  building_demolished: { bus: 'effects', source: sample('crash_1', 'crash_2'), gainDb: 0, pitchJitterCents: 150, cooldownMs: 400, maxVoices: 2, priority: 3, spatial: true, reverbSend: 0.4 },
  vehicle_start: { bus: 'effects', source: sample('truck_start'), gainDb: -4, pitchJitterCents: 100, cooldownMs: 900, maxVoices: 2, priority: 2, spatial: true, reverbSend: 0.15 },
  vehicle_horn: { bus: 'effects', source: sample('horn'), gainDb: -5, pitchJitterCents: 80, cooldownMs: 2500, maxVoices: 1, priority: 2, spatial: true, reverbSend: 0.25 },
  vehicle_scrap: { bus: 'effects', source: sample('impact_metal_1', 'impact_metal_2'), gainDb: -2, pitchJitterCents: 150, cooldownMs: 300, maxVoices: 2, priority: 2, spatial: true, reverbSend: 0.2 },
  shift_bell: { bus: 'effects', source: sample('bell'), gainDb: -7, cooldownMs: 4000, maxVoices: 1, priority: 2 },
  worker_collapse: { bus: 'effects', source: sample('impact_soft_1', 'impact_soft_2', 'impact_soft_3'), gainDb: -3, pitchJitterCents: 120, cooldownMs: 800, maxVoices: 2, priority: 2, spatial: true },
  drill_done: { bus: 'effects', source: sample('impact_metal_1', 'impact_metal_2'), gainDb: -7, pitchJitterCents: 200, cooldownMs: 300, maxVoices: 2, priority: 1, spatial: true },
  charge_loaded: { bus: 'effects', source: sample('charge_click'), gainDb: -6, pitchJitterCents: 150, cooldownMs: 250, maxVoices: 2, priority: 1, spatial: true },
  survey_done: { bus: 'effects', source: sample('survey_ping'), gainDb: -5, cooldownMs: 600, maxVoices: 1, priority: 2, spatial: true, reverbSend: 0.3 },

  // ── World: work and hauling (short bursts, one site at a time) ──
  work_drill: { bus: 'effects', source: sample('drill_1', 'drill_2'), gainDb: -4, pitchJitterCents: 120, cooldownMs: 400, maxVoices: 2, priority: 1, spatial: true, reverbSend: 0.15 },
  work_dig: { bus: 'effects', source: sample('dig_1', 'dig_2', 'dig_3'), gainDb: -4, pitchJitterCents: 150, cooldownMs: 400, maxVoices: 2, priority: 1, spatial: true, reverbSend: 0.1 },
  work_hammer: { bus: 'effects', source: sample('hammer_1', 'hammer_2'), gainDb: -5, pitchJitterCents: 120, cooldownMs: 400, maxVoices: 2, priority: 1, spatial: true },
  haul_load: { bus: 'effects', source: sample('impact_soft_1', 'impact_soft_2', 'impact_soft_3'), gainDb: -5, pitchJitterCents: 200, gainJitterDb: 2, cooldownMs: 150, maxVoices: 3, priority: 1, spatial: true },
  haul_dump: { bus: 'effects', source: sample('dump_1', 'dump_2'), gainDb: -4, pitchJitterCents: 150, gainJitterDb: 2, cooldownMs: 200, maxVoices: 2, priority: 1, spatial: true, reverbSend: 0.15 },
  boulder_break: { bus: 'effects', source: sample('boulder_break'), gainDb: -2, pitchJitterCents: 200, cooldownMs: 250, maxVoices: 2, priority: 2, spatial: true, reverbSend: 0.25 },
  debris_hit: { bus: 'effects', source: sample('impact_rock_1', 'impact_rock_2', 'impact_rock_3', 'impact_rock_4', 'impact_soft_1', 'impact_soft_2'), gainDb: -6, pitchJitterCents: 450, gainJitterDb: 4, cooldownMs: 18, maxVoices: 10, priority: 1, spatial: true, reverbSend: 0.3 },
  debris_pebble: { bus: 'effects', source: sample('impact_small_1', 'impact_small_2', 'impact_small_3', 'impact_small_4', 'impact_small_5'), gainDb: -9, pitchJitterCents: 500, gainJitterDb: 4, cooldownMs: 12, maxVoices: 8, priority: 1, spatial: true, reverbSend: 0.25 },

  // ── Blasting ──
  blast_beep: { bus: 'effects', source: synth('blast_beep'), gainDb: -4, cooldownMs: 150, maxVoices: 2, priority: 4 },
  blast_cancel: { bus: 'effects', source: synth('blast_cancel'), gainDb: -4, cooldownMs: 500, maxVoices: 1, priority: 4 },
  blast_siren: { bus: 'effects', source: synth('siren_loop'), gainDb: -4, priority: 4, loop: true },
  blast_crack: { bus: 'effects', source: sample('blast_crack_1', 'blast_crack_2', 'blast_crack_3'), gainDb: 2, pitchJitterCents: 100, maxVoices: 3, priority: 4, spatial: true, reverbSend: 0.4 },
  blast_boom: { bus: 'effects', source: sample('blast_boom_1', 'blast_boom_2'), gainDb: 3, pitchJitterCents: 80, maxVoices: 3, priority: 4, spatial: true, reverbSend: 0.55 },
  blast_sub: { bus: 'effects', source: synth('blast_sub'), gainDb: 2, maxVoices: 2, priority: 4, reverbSend: 0.2 },
  blast_tail: { bus: 'effects', source: synth('blast_tail'), gainDb: 0, maxVoices: 2, priority: 4, reverbSend: 0.65 },
  blast_dud: { bus: 'effects', source: sample('blast_dud'), gainDb: -3, pitchJitterCents: 150, cooldownMs: 150, maxVoices: 3, priority: 3, spatial: true, reverbSend: 0.3 },

  // ── Level end stings ──
  level_win: { bus: 'effects', source: sample('level_win'), gainDb: -2, maxVoices: 1, priority: 4 },
  level_lose: { bus: 'effects', source: sample('level_lose'), gainDb: -2, maxVoices: 1, priority: 4 },

  // ── Ambient ──
  thunder: { bus: 'ambient', source: synth('thunder'), gainDb: 0, cooldownMs: 2500, maxVoices: 2, priority: 2, reverbSend: 0.3 },
  amb_wind: { bus: 'ambient', source: synth('wind_bed'), gainDb: 0, priority: 1, loop: true },
  amb_rain_light: { bus: 'ambient', source: synth('rain_light_bed'), gainDb: 0, priority: 1, loop: true },
  amb_rain_heavy: { bus: 'ambient', source: synth('rain_heavy_bed'), gainDb: 0, priority: 1, loop: true },
  amb_machinery: { bus: 'ambient', source: synth('machinery_bed'), gainDb: 0, priority: 1, loop: true },
} as const satisfies Record<string, SoundDefinition>;

type SoundId = keyof typeof SOUND_CATALOG;

/** Ids of looped beds (played through `AudioPlayer.loop`). */
export type LoopId = {
  [K in SoundId]: (typeof SOUND_CATALOG)[K] extends { readonly loop: true } ? K : never;
}[SoundId];

/** Ids of one-shot sounds (played through `AudioPlayer.play`). */
export type OneShotId = Exclude<SoundId, LoopId>;
