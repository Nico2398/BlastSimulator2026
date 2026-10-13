// BlastSimulator2026 — Sound catalog
// The one table that says what every sound in the game is: which bus it plays
// on, where its audio comes from (a decoded sample or a synthesized recipe),
// how loud it is, how it varies from play to play and how it is rate-limited.
// Adding a sound is adding an entry here (plus its file in public/audio/sfx/ or
// its recipe in synth/recipes.ts); nothing that consumes the catalog changes.
//
// What things sound like. The game is a worksite, so the world sounds like one:
// real field recordings of an excavator, a jackhammer, a plate compactor, a metal
// workshop, trucks, thunder, wind and rain (public/audio/CREDITS.md). The menus
// are the site cabin: dry clicks, paper, a stamp, a door, a till, a desk bell.
// Orders and reports come over the site radio, and an event rings the office
// phone; those electronic sounds are synthesized, because the real devices are
// simple tone and noise generators. The blast is built from real thunder cracks
// and claps over a synthesized transient and sub-bass.
//
// Level convention. Every one-shot file is normalised to -18 dBFS gated RMS with
// a -1 dBFS peak ceiling, every looped bed to -26 dBFS (see public/audio/CREDITS.md);
// every synth recipe is rendered to the same levels. `gainDb` is the trim against
// that reference, so 0 means "as loud as an ordinary effect". A few spiky files
// (coins, hammer, till...) sit under -18 because the asset limiter budget caps
// their gain, and a hard-transient recipe (blast_snap) lands under it for the
// same reason; their trims here include the measured shortfall.
//
// The blast layers (snap, crack, boom, sub) are trimmed together: they stack within
// 30 ms, so the sum, not each one, has to clear the master safety clipper's knee
// (effectively about 0.66 at the limiter input, because the compressor adds
// makeup gain: see MASTER_LIMITER_CONFIG).
// Re-measure with `npm run sounds:check` after changing any of them.

/** Buses a sound can play on: the user-facing volume sliders other than master/music. */
export type SoundBus = 'effects' | 'ambient' | 'ui';

/** Procedural sounds rendered at startup by src/audio/synth. */
export type SynthRecipeId =
  | 'blast_snap'
  | 'blast_sub'
  | 'blast_beep'
  | 'blast_cancel'
  | 'siren_loop'
  | 'radio_order'
  | 'radio_info'
  | 'radio_good'
  | 'radio_warn'
  | 'radio_end'
  | 'phone_ring'
  | 'alarm_buzzer'
  | 'reverse_beeper'
  | 'instrument_beep';

/** Where a looped sample repeats: the file holds one period between these marks, plus a run-in and a run-out. */
export interface LoopRegion {
  readonly startS: number;
  readonly endS: number;
}

interface SampleSource {
  readonly kind: 'sample';
  /** File basenames under AUDIO_ASSET_BASE (no extension). One is picked per play, never the same twice in a row. */
  readonly files: readonly string[];
  /** Looped beds only: the period every file of this source repeats (assets/audio/build.py writes them this way). */
  readonly loopRegion?: LoopRegion;
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
  /** Seamless looped bed driven through `AudioPlayer.loop`: a looping synth recipe, or samples with a `loopRegion`. */
  readonly loop?: true;
}

const sample = (...files: string[]): SampleSource => ({ kind: 'sample', files });
const synth = (recipe: SynthRecipeId): SynthSource => ({ kind: 'synth', recipe });
/** Seconds of audio before (and after) the looped period in every bed file (the recipe's `loop.pad_s`). */
const BED_RUN_IN_S = 0.5;

/** A recorded bed: `periodS` of audio (the recipe's `loop.period_s`) after a `BED_RUN_IN_S` run-in. */
const bed = (file: string, periodS: number): SampleSource => ({
  kind: 'sample',
  files: [file],
  loopRegion: { startS: BED_RUN_IN_S, endS: BED_RUN_IN_S + periodS },
});

export const SOUND_CATALOG = {
  // ── Interface: generic controls (delegated from the DOM) ──
  ui_click: { bus: 'ui', source: sample('ui_click_1', 'ui_click_2'), gainDb: -6, pitchJitterCents: 60, cooldownMs: 25, maxVoices: 3, priority: 2 },
  ui_hover: { bus: 'ui', source: sample('ui_hover'), gainDb: -10.5, cooldownMs: 70, maxVoices: 2, priority: 1 },
  ui_open: { bus: 'ui', source: sample('ui_open'), gainDb: -6, cooldownMs: 60, maxVoices: 2, priority: 2 },
  ui_close: { bus: 'ui', source: sample('ui_close'), gainDb: -6, cooldownMs: 60, maxVoices: 2, priority: 2 },
  // A page turned on the site clipboard.
  ui_tab: { bus: 'ui', source: sample('ui_tab'), gainDb: -4, pitchJitterCents: 80, cooldownMs: 60, maxVoices: 2, priority: 2 },
  ui_toggle_on: { bus: 'ui', source: sample('ui_toggle_on'), gainDb: -6, cooldownMs: 40, maxVoices: 2, priority: 2 },
  ui_toggle_off: { bus: 'ui', source: sample('ui_toggle_off'), gainDb: -6, cooldownMs: 40, maxVoices: 2, priority: 2 },
  ui_slider: { bus: 'ui', source: sample('ui_slider'), gainDb: -7, pitchJitterCents: 40, cooldownMs: 55, maxVoices: 2, priority: 1 },
  ui_denied: { bus: 'ui', source: sample('ui_denied'), gainDb: -3, cooldownMs: 120, maxVoices: 2, priority: 3 },
  // A rubber stamp: the primary button signs the form.
  ui_confirm: { bus: 'ui', source: sample('ui_confirm'), gainDb: -6, pitchJitterCents: 60, cooldownMs: 60, maxVoices: 2, priority: 2 },
  ui_back: { bus: 'ui', source: sample('ui_back'), gainDb: -7, cooldownMs: 60, maxVoices: 2, priority: 2 },
  ui_select: { bus: 'ui', source: sample('ui_select'), gainDb: -6, pitchJitterCents: 50, cooldownMs: 50, maxVoices: 2, priority: 2 },
  ui_invalid: { bus: 'ui', source: sample('ui_invalid'), gainDb: -2, cooldownMs: 250, maxVoices: 1, priority: 2 },
  ui_modal: { bus: 'ui', source: sample('ui_modal'), gainDb: -5, cooldownMs: 200, maxVoices: 1, priority: 2 },

  // ── Interface: the site radio, the cabin phone and the alarm buzzer ──
  notify_info: { bus: 'ui', source: synth('radio_info'), gainDb: -10, cooldownMs: 400, maxVoices: 2, priority: 2 },
  notify_good: { bus: 'ui', source: synth('radio_good'), gainDb: -9, cooldownMs: 400, maxVoices: 2, priority: 3 },
  notify_warn: { bus: 'ui', source: synth('radio_warn'), gainDb: -8, cooldownMs: 500, maxVoices: 2, priority: 3 },
  notify_bad: { bus: 'ui', source: synth('alarm_buzzer'), gainDb: -9, cooldownMs: 600, maxVoices: 2, priority: 3 },
  notify_alert: { bus: 'ui', source: synth('phone_ring'), gainDb: -9, cooldownMs: 1000, maxVoices: 1, priority: 4 },
  // Who is on the phone: a picket crowd and its whistle, a judge's gavel, three knocks at the door, applause.
  event_union: { bus: 'ui', source: sample('event_union'), gainDb: -6, cooldownMs: 1000, maxVoices: 1, priority: 3 },
  event_lawsuit: { bus: 'ui', source: sample('event_lawsuit'), gainDb: -5, cooldownMs: 1000, maxVoices: 1, priority: 3 },
  event_mafia: { bus: 'ui', source: sample('event_mafia'), gainDb: -5, cooldownMs: 1000, maxVoices: 1, priority: 3 },
  event_politics: { bus: 'ui', source: sample('event_politics'), gainDb: -7, cooldownMs: 1000, maxVoices: 1, priority: 3 },

  // ── Interface: orders, staff, money ──
  order_queued: { bus: 'ui', source: synth('radio_order'), gainDb: -10, cooldownMs: 120, maxVoices: 2, priority: 2 },
  order_done: { bus: 'ui', source: synth('radio_end'), gainDb: -13, cooldownMs: 250, maxVoices: 2, priority: 1 },
  build_placed: { bus: 'effects', source: sample('place_1', 'place_2', 'place_3', 'place_4'), gainDb: -4, pitchJitterCents: 80, cooldownMs: 120, maxVoices: 2, priority: 2 },
  // The contract signed (a page and a stamp), the cabin door slammed behind someone.
  hire: { bus: 'ui', source: sample('hire'), gainDb: -4, pitchJitterCents: 60, cooldownMs: 150, maxVoices: 2, priority: 2 },
  fire: { bus: 'ui', source: sample('fire'), gainDb: -5, pitchJitterCents: 80, cooldownMs: 150, maxVoices: 2, priority: 2 },
  purchase: { bus: 'ui', source: sample('cash_till'), gainDb: -4, cooldownMs: 150, maxVoices: 2, priority: 2 },
  // A desk bell: research done (twice), a worker skilled up (once, higher).
  unlock: { bus: 'ui', source: sample('unlock'), gainDb: -7, cooldownMs: 300, maxVoices: 1, priority: 3 },
  level_up: { bus: 'ui', source: sample('level_up'), gainDb: -9, cooldownMs: 600, maxVoices: 1, priority: 2 },
  coins_small: { bus: 'ui', source: sample('coins_small'), gainDb: -2.5, pitchJitterCents: 100, cooldownMs: 500, maxVoices: 2, priority: 2 },
  coins_big: { bus: 'ui', source: sample('coins_big'), gainDb: 2, cooldownMs: 800, maxVoices: 1, priority: 2 },
  cash_till: { bus: 'ui', source: sample('cash_till'), gainDb: 0, cooldownMs: 1500, maxVoices: 1, priority: 3 },

  // ── World: construction, vehicles, crew ──
  building_built: { bus: 'effects', source: sample('impact_plate_1', 'impact_plate_2'), gainDb: -2, pitchJitterCents: 120, cooldownMs: 300, maxVoices: 2, priority: 2, spatial: true, reverbSend: 0.2 },
  building_demolished: { bus: 'effects', source: sample('crash_1', 'crash_2'), gainDb: 0, pitchJitterCents: 150, cooldownMs: 400, maxVoices: 2, priority: 3, spatial: true, reverbSend: 0.4 },
  // A diesel turning over, or air brakes released and a truck pulling away.
  vehicle_start: { bus: 'effects', source: sample('truck_start', 'truck_start_2'), gainDb: -5, pitchJitterCents: 100, cooldownMs: 900, maxVoices: 2, priority: 2, spatial: true, reverbSend: 0.15 },
  vehicle_horn: { bus: 'effects', source: sample('horn'), gainDb: -7, pitchJitterCents: 80, cooldownMs: 2500, maxVoices: 1, priority: 2, spatial: true, reverbSend: 0.25 },
  vehicle_reverse: { bus: 'effects', source: synth('reverse_beeper'), gainDb: -12, pitchJitterCents: 40, cooldownMs: 4000, maxVoices: 1, priority: 1, spatial: true, reverbSend: 0.3 },
  vehicle_scrap: { bus: 'effects', source: sample('impact_metal_1', 'impact_metal_2'), gainDb: 0, pitchJitterCents: 150, cooldownMs: 300, maxVoices: 2, priority: 2, spatial: true, reverbSend: 0.2 },
  shift_whistle: { bus: 'effects', source: sample('shift_whistle'), gainDb: -9, cooldownMs: 4000, maxVoices: 1, priority: 2, reverbSend: 0.3 },
  worker_collapse: { bus: 'effects', source: sample('impact_soft_1', 'impact_soft_2', 'impact_soft_3'), gainDb: -3, pitchJitterCents: 120, cooldownMs: 800, maxVoices: 2, priority: 2, spatial: true },
  drill_done: { bus: 'effects', source: sample('impact_metal_1', 'impact_metal_2'), gainDb: -5, pitchJitterCents: 200, cooldownMs: 300, maxVoices: 2, priority: 1, spatial: true },
  charge_loaded: { bus: 'effects', source: sample('charge_click'), gainDb: -4.5, pitchJitterCents: 150, cooldownMs: 250, maxVoices: 2, priority: 1, spatial: true },
  survey_done: { bus: 'effects', source: synth('instrument_beep'), gainDb: -9, cooldownMs: 600, maxVoices: 1, priority: 2, spatial: true, reverbSend: 0.2 },

  // ── World: work and hauling (short bursts of real machinery, one site at a time) ──
  work_drill: { bus: 'effects', source: sample('drill_1', 'drill_2', 'drill_3'), gainDb: -7, pitchJitterCents: 80, gainJitterDb: 1.5, cooldownMs: 400, maxVoices: 2, priority: 1, spatial: true, reverbSend: 0.15 },
  work_dig: { bus: 'effects', source: sample('dig_1', 'dig_2', 'dig_3', 'dig_4'), gainDb: -6, pitchJitterCents: 80, gainJitterDb: 1.5, cooldownMs: 400, maxVoices: 2, priority: 1, spatial: true, reverbSend: 0.1 },
  work_compact: { bus: 'effects', source: sample('compact_1', 'compact_2'), gainDb: -8, pitchJitterCents: 60, gainJitterDb: 1.5, cooldownMs: 400, maxVoices: 2, priority: 1, spatial: true, reverbSend: 0.1 },
  work_hammer: { bus: 'effects', source: sample('hammer_1', 'hammer_2', 'hammer_3', 'hammer_4'), gainDb: -6, pitchJitterCents: 100, gainJitterDb: 1.5, cooldownMs: 400, maxVoices: 2, priority: 1, spatial: true, reverbSend: 0.15 },
  haul_load: { bus: 'effects', source: sample('load_1', 'load_2', 'load_3'), gainDb: -5, pitchJitterCents: 200, gainJitterDb: 2, cooldownMs: 150, maxVoices: 3, priority: 1, spatial: true, reverbSend: 0.1 },
  haul_dump: { bus: 'effects', source: sample('dump_1', 'dump_2'), gainDb: -5, pitchJitterCents: 150, gainJitterDb: 2, cooldownMs: 200, maxVoices: 2, priority: 1, spatial: true, reverbSend: 0.15 },
  boulder_break: { bus: 'effects', source: sample('boulder_break'), gainDb: -2, pitchJitterCents: 200, cooldownMs: 250, maxVoices: 2, priority: 2, spatial: true, reverbSend: 0.25 },
  // No cooldownMs on the debris or the dud: each cue is keyed per impact (blastPlan), so a cooldown would never apply.
  debris_hit: { bus: 'effects', source: sample('impact_rock_1', 'impact_rock_2', 'impact_rock_3', 'impact_rock_4', 'impact_soft_1', 'impact_soft_2'), gainDb: -6, pitchJitterCents: 450, gainJitterDb: 4, maxVoices: 10, priority: 1, spatial: true, reverbSend: 0.3 },
  debris_pebble: { bus: 'effects', source: sample('impact_small_1', 'impact_small_2', 'impact_small_3', 'impact_small_4', 'impact_small_5'), gainDb: -9, pitchJitterCents: 500, gainJitterDb: 4, maxVoices: 8, priority: 1, spatial: true, reverbSend: 0.25 },

  // ── Blasting ──
  blast_beep: { bus: 'effects', source: synth('blast_beep'), gainDb: -4, cooldownMs: 150, maxVoices: 2, priority: 4 },
  blast_cancel: { bus: 'effects', source: synth('blast_cancel'), gainDb: -4, cooldownMs: 500, maxVoices: 1, priority: 4 },
  blast_siren: { bus: 'effects', source: synth('siren_loop'), gainDb: -4, priority: 4, loop: true },
  blast_crack: { bus: 'effects', source: sample('blast_crack_1', 'blast_crack_2', 'blast_crack_3'), gainDb: 1, pitchJitterCents: 100, maxVoices: 3, priority: 4, spatial: true, reverbSend: 0.35 },
  blast_boom: { bus: 'effects', source: sample('blast_boom_1', 'blast_boom_2'), gainDb: 2, pitchJitterCents: 80, maxVoices: 3, priority: 4, spatial: true, reverbSend: 0.45 },
  blast_snap: { bus: 'effects', source: synth('blast_snap'), gainDb: -2, maxVoices: 3, priority: 4, spatial: true, reverbSend: 0.25 },
  blast_sub: { bus: 'effects', source: synth('blast_sub'), gainDb: -2, maxVoices: 2, priority: 4, reverbSend: 0.2 },
  // The rumble rolling back off the pit walls.
  blast_tail: { bus: 'effects', source: sample('blast_rumble_1', 'blast_rumble_2'), gainDb: -3, pitchJitterCents: 120, maxVoices: 2, priority: 4, reverbSend: 0.4 },
  // Keyed per dud (blastPlan), like the debris: no cooldownMs.
  blast_dud: { bus: 'effects', source: sample('blast_dud'), gainDb: -3, pitchJitterCents: 150, maxVoices: 3, priority: 3, spatial: true, reverbSend: 0.3 },

  // ── Level end stings: the end-of-shift whistle and applause, or a breakdown and a dying whistle ──
  level_win: { bus: 'effects', source: sample('level_win'), gainDb: -2, maxVoices: 1, priority: 4 },
  level_lose: { bus: 'effects', source: sample('level_lose'), gainDb: -2, maxVoices: 1, priority: 4 },

  // ── Ambient ──
  // Looped beds run at priority 3 (the siren at 4): only priority-4 sounds (blast synths, level stings) may take a bed's slot at the voice cap,
  // and the player restarts a bed that lost it (SoundPlayer.setListener), so weather never silently vanishes.
  thunder: { bus: 'ambient', source: sample('thunder_1', 'thunder_2', 'thunder_3', 'thunder_4'), gainDb: -3, pitchJitterCents: 150, cooldownMs: 2500, maxVoices: 2, priority: 2, reverbSend: 0.15 },
  amb_wind: { bus: 'ambient', source: bed('bed_wind', 21.6), gainDb: 0, priority: 3, loop: true },
  amb_wind_storm: { bus: 'ambient', source: bed('bed_wind_storm', 21.6), gainDb: 0, priority: 3, loop: true },
  amb_rain_light: { bus: 'ambient', source: bed('bed_rain_light', 16.2), gainDb: 0, priority: 3, loop: true },
  amb_rain_heavy: { bus: 'ambient', source: bed('bed_rain_heavy', 16.2), gainDb: 0, priority: 3, loop: true },
  // A diesel idling: only machines near the listener feed it (WorkSounds).
  amb_machinery: { bus: 'ambient', source: bed('bed_diesel', 18), gainDb: -2, priority: 3, loop: true },
} as const satisfies Record<string, SoundDefinition>;

type SoundId = keyof typeof SOUND_CATALOG;

/** Ids of looped beds (played through `AudioPlayer.loop`). */
export type LoopId = {
  [K in SoundId]: (typeof SOUND_CATALOG)[K] extends { readonly loop: true } ? K : never;
}[SoundId];

/** Ids of one-shot sounds (played through `AudioPlayer.play`). */
export type OneShotId = Exclude<SoundId, LoopId>;
