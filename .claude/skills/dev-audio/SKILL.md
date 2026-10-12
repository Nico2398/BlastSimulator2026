---
name: dev-audio
description: >
  Audio system of BlastSimulator2026: module map and data flow from the sound catalog through the
  Web Audio engine and the directors to the main.ts hooks, the bus graph and level convention, how to
  add a sampled one-shot, a synth sound, a UI cue, a world cue or a music track, licensing rules for
  sound banks, real-time rate limiting, the tuning map, and what each audio tool proves and what no
  tool proves. Use when adding or changing any sound, volume, music track or audio asset, or when
  judging what an audio change has verified.
---

## What ships

Sampled one-shots (`public/audio/sfx/*.mp3`, 80 mono files, mostly CC0 plus a few CC-BY OpenSFX) layered with generative sounds rendered in code at startup (blast snap/sub/tail, warning beeps, siren, thunder, wind, rain, machinery bed, the reverb impulse). Samples carry realism, synthesis carries what no bank has (a tuned siren, seamless weather beds, a blast tail). No music tracks yet: the architecture exists and `MUSIC_TRACKS` is empty.

**Pending, state it honestly when asked:** no music tracks; Settings has no Music slider until the first track (the `music` bus and its default volume exist); no in-game credits screen (credits ship as a file only); no main-menu ambience; nobody has listened to any of it (see "What no channel proves").

## Module map and data flow

```
SOUND_CATALOG (src/audio/SoundCatalog.ts: every sound, one table)
   -> AudioEngine (preload: SampleBank decodes mp3, SynthBank renders recipes) -> SoundPlayer -> AudioManager graph
   -> implements AudioPlayer (src/audio/AudioPlayer.ts: play / loop / duck / setListener) or NULL_AUDIO_PLAYER
   -> directors only ever see AudioPlayer:  ui/ (DOM + commands)   director/ (world)   music/ (own streaming path)
   -> src/main.ts + a few injected hooks in src/ui and src/renderer call the directors
```

- `src/audio/AudioManager.ts`: owns the AudioContext, bus graph, volumes, mute, ducking, hidden-tab suspend/resume. Works without Web Audio (volumes still stored, Settings still works).
- `src/audio/AudioEngine.ts`: the facade. Three preload tiers: samples used by priority >= 3 sounds (flips `ready`), remaining samples, then synth recipes and the reverb impulse. Never rejects; `failedAssets` lists what did not load.
- `src/audio/engine/`: `SoundPlayer` (voice graph, variant pick, pitch/level jitter), `VoiceBudget` (cooldowns, per-sound caps, global cap with priority stealing), `spatial` (distance, pan, air absorption), `ducking`, `LoopBed`, `softClip`, `preloadPlan`.
- `src/audio/synth/`: pure deterministic DSP, runs in Node. `recipes.ts` is the table; `sounds/*` are the recipes; `finish.ts` brings every render to the level convention.
- `src/audio/director/`: `GameAudioDirector` composes `EventFeed` (core events), `StateDiffFeed` + `worldDiff` (state changes), `WorkSounds` (work bursts + machinery bed), `BlastAudio` + `blastPlan` (blast timeline), `EvacuationSiren`, `Ambience` (weather beds, thunder), `DistantLife`, `LevelStings`. Depends on AudioPlayer, the core `EventEmitter` and `GameState` only; `src/core` never imports `src/audio`.
- `src/audio/ui/`: `installUiSounds` + `uiTone` (one capture-phase DOM delegation: every control gets a sound), `UiCues` (chokepoints the DOM cannot see), `commandCues` + `commandCueTable` (console command -> cue), `CommandClaim` (command cue suppresses the generic click).
- `src/audio/music/`: `MusicCatalog`, `resolveMusicTrack`, `musicContext`, `MusicPlayer` (streamed, equal-power crossfade), `MusicDirector`.
- `src/audio/debug/` (`?audioLog=1` play log), `src/audio/lab/` (logic of the sound lab and the offline mixes).

**main.ts hooks:** `AudioEngine` is built only outside `?scenarioMode=1` (scenario runs get the null player, no fetch, no decode, no music); the UI and director layers are still built on the null player so their handlers run. `runGameCommand` calls `commandCue` then `gameAudio.onCommand` once per command; the frame callback calls `gameAudio.update` (real seconds, listener from camera target + ground-right + distance, never the shaken camera) and `music.update`; the renderer's blast callback calls `gameAudio.onBlast` + `music.duck`; `setLightningHandler` calls `onLightning`; skipping or seeking blast playback calls `cancelBlast`. `UIManager.setUiCues` forwards `UiCues` to panels, `NotificationCenter`, `ConfirmModal`, `SettingsPanel`; selection and `PlacementController.setRefusedHandler` call `UiCues`. `tests/unit/lint/MainAudioWiring.test.ts` guards these call sites by source text.

**One owner per sound.** `commandCue` voices orders, hire, fire, purchase, order-time build, denials, time and confirm cues. The director voices what only state shows: building_built, vehicle_start and vehicle_scrap of the new/removed vehicle, drill_done, charge_loaded, survey_done, order_done, level_up, unlock, worker_collapse, coins for income, level stings, the whole blast. Toasts for director-voiced events are created `silent: true`. Grep a sound id for existing callers before adding another.

## Bus graph and levels

```
voice: source -> [lowpass -> pan, if spatial] -> gain -> bus (volume -> duck) -> master gain
       -> compressor (-3 dB, 20:1) -> soft clipper (knee 0.8, ceiling 0.97) -> destination
       gain -> reverb send -> wet lane of the same bus (volume -> duck) -> convolver -> return -> master
```

Buses: `effects`, `ambient`, `ui` (catalog `SoundBus`) and `music` (MusicPlayer only), plus master. Each bus has a dry and a wet lane so a slider or a duck scales the reverb tail with the sound.

**Level convention.** Every sample is normalised to -18 dBFS gated RMS, -1 dBFS peak ceiling; every synth one-shot is rendered to the same; every loop to -26 dBFS (`SYNTH_LEVELS` in `src/core/config/audio/synth.ts`). Catalog `gainDb` is the trim against that reference: 0 means an ordinary effect. Spiky files (coins, till, hammer) land under -18 and carry a positive trim. The blast layers (snap, crack, boom, sub, tail) stack within 30 ms and are trimmed together: re-measure with `npm run sounds:check` after touching any of them or `BLAST_AUDIO_CONFIG.maxBoostDb`.

## Adding things

**Sampled one-shot.** (1) Add the sound to `sounds` in `assets/audio/recipe.json`: `kind` (`ui`, `work`, `sting`, `blast`: sets the length cap), `layers` (`pack`, `file`, optional `start`/`dur`/`at`/`gain_db`/`af`); the pack must exist under `packs` with its licence. (2) `python3 assets/audio/build.py --sources <dir> --only <name> --report` (needs Python 3, numpy, ffmpeg and a local copy of the upstream packs laid out as `packs[*].dir`; not in the repo). Output is deterministic, mono 44.1 kHz mp3 in `public/audio/sfx/`. (3) `python3 assets/audio/build.py --credits` regenerates `public/audio/CREDITS.md` from `assets/audio/credits.template.md`; never hand-edit it. (4) Add the catalog entry with `sample('<name>')`. `tests/unit/audio/AudioAssets.test.ts` fails on a file the catalog does not name, a catalog name with no file, a file missing from the recipe or the credits, a non-CC0/CC-BY licence, a length over the cap or a byte-identical duplicate.

**Synth sound.** Recipe module in `src/audio/synth/sounds/` (a `SynthRecipe`: `variants`, `loop`, `render(variant)`, pure and deterministic, seeded through `rngFor`), ending in `finishRender(raw, sampleRate, 'oneShot' | 'loop')` so it lands on the level convention. Every number goes in `src/core/config/audio/synth.ts`. Register it in `SYNTH_RECIPES` and the `SynthRecipeId` union in the catalog, then add the catalog entry with `synth('<id>')` (`loop: true` for a bed, played through `AudioPlayer.loop`). Each render carries its own `sampleRate`. `tests/unit/audio/synth/` checks level, seams and character.

**UI cue.** Prefer no code: `installUiSounds` infers the tone from the element (`bsx-btn-primary`, `bsx-btn-danger`, `bsx-btn-locked`, `aria-pressed`, `data-lang`, disabled state). Override with `data-sfx="<cue>"` (set allowed in `src/audio/ui/uiTone.ts`) or `data-sfx="none"` on the control or an ancestor. A command-backed action: add the verb to `COMMAND_CUES` in `src/audio/ui/commandCueTable.ts`, or to `SILENT_COMMANDS` with the reason; a test fails when a registered verb is in neither. Failed commands play `ui_denied`; `scripted: true` commands (tutorial) play nothing; `tick` is always silent. A chokepoint the DOM cannot see gets a named `UiCues` method called from an injected hook. A new pickable kind needs a pitch in `UI_SELECTION_PITCH_CENTS`. No player-visible string is involved, so no i18n.

**World cue.** Core code emits an event or changes state; it never calls audio. Pick the feed: a core event -> `EventFeed` (`subs.on`, intent -> sound in `ENTITY_CUES`/`FLAG_SOUNDS`, policy in `EVENT_CUES`/`FLAG_CUES`); a state change -> `src/audio/director/worldDiff.ts` with its cooldown in `DIFF_CONFIG`; a work site -> `WorkSounds`; the blast -> `blastPlan`; weather -> `Ambience`. Play one-off cues through `playCue` (range check, cooldown, then the player) and give positional cues a `site` so they pan and attenuate.

**Music track.** Drop the mp3 in `public/audio/music/`, add one entry to `MUSIC_TRACKS` in `src/audio/music/MusicCatalog.ts` (scope `menu`, `game`, `biome` or `level`; most specific wins; the biome is the declared `GameState.mineType`), follow `public/audio/music/README.md` (mastering, loop seams, size), credit the file through `assets/audio/credits.template.md`, run `npx vitest run tests/unit/audio/music` (fails on duplicate id, unknown biome/level id, missing file). With the first track also add the Settings row: `{ channel: 'music', labelKey: 'ui.settings.audio.music' }` in `AUDIO_CHANNELS` of `src/ui/panels/SettingsPanel.ts` plus the `ui.settings.audio.music` key in `en.json` and `fr.json`. Check the first track once in Chrome and Firefox: streamed element routing and autoplay recovery are only covered by fakes.

## Licensing

CC0 preferred. CC-BY allowed only when credited verbatim (author, title, source, licence link, "changes were made") in `public/audio/CREDITS.md`; today that is the OpenSFX group (credited by name in the README and CREDITS.md). Never CC-BY-NC, ND or SA, game rips, "free for personal use", GPL, or anything without a verifiable licence page. A mirror is not first-party: verify against the author's own repository. The licence goes into `assets/audio/recipe.json` with the sound, so CREDITS.md is generated, never remembered.

## Real-time rate limiting

The simulation runs 1x to 8x as one synchronous `tick N` command per real second, so a whole crew's events arrive in one burst and anything scaled by game speed multiplies. Every limit is in **real seconds**, never ticks: `GameAudioDirector.update` advances its own clock by the frame delta (clamped); the engine's cooldowns use `performance.now`. Events only mark intents; one flush per frame plays at most `maxPerFlush`, nearest to the listener first, with a per-entity cooldown, a global `spacingS` per intent and a token bucket for hauling. A state diff spanning more than `maxCoalescedTicks` is a load or a skip and plays nothing. The engine counts a scheduled voice as busy from the `play()` call, so `BlastAudio` hands cues over 0.35 s ahead. New world sounds need a number in `src/core/config/audio/game.ts` for each of these, and a crowding test case when they can fire in volume.

## Tools: what each proves

| Tool | Command | Proves |
|------|---------|--------|
| Audio unit suites | `npx vitest run tests/unit/audio` | Catalog consistency, engine voice rules, recipe levels and seams, which cue each feed/command/control requests and how often |
| Crowding tests | `tests/unit/audio/crowding/` (inside the suite above) | Real game scripts at 1x and 8x through the real directors and the real voice budget: sound counts per window stay under measured bounds |
| Wiring lint | `npx vitest run tests/unit/lint/MainAudioWiring.test.ts` | The main.ts call sites exist (source text, not behaviour) |
| `npm run sounds:check` | headless Chromium; reuses a dev server or starts its own | All 80 samples decode, all recipes render, live context runs, three scenarios (ui-tour, blast, busy-mine) mixed offline through the real graph: NaN, peak above -0.1 dBFS, silence fail; clips, DC, mono loss, drops warn. Writes WAVs and `report.json`. Exit 0/1/2 (2 = could not run) |
| `npm run audio:smoke` | same browser setup | The real engine preloads with zero failures; real clicks on menu controls produce the intended cues once each; a scripted game under `?scenarioMode=1&audioLog=1` shows the cues the game intends (hire, build, drill, blast layers, ducks) |
| `/sound-lab.html` | `npm run dev`, dev server only | Audition every sound by bus, spatial distance/pan, beds, live blast and busy-mine, "Download mix WAV" |
| `assets/audio/build.py` | see above | Rebuilds samples and credits deterministically |
| `?audioLog=1` | any page | `window.__audioLog` and `window.__audioStatus()` record every request |

## What no channel proves

How it sounds. Every tool here measures counts, timing, levels and graph structure; none hears. Whether a timbre is pleasant, a mix is alive but not crowded, a cue reads as the right thing (the lawsuit gavel, the mafia sting, the blast crack), a loop is fatiguing, or small laptop speakers reproduce a low rumble is a human listening pass, and that pass belongs to the owner. Never write that a sound "sounds good"; write which numbers and tests passed. The `visual` channel does not play audio. Browser-only behaviour (autoplay policy, `ended` on a source stopped before it starts, `pointerdown` on disabled controls, Safari) is covered by fakes or one headless Chromium only.

## Tuning map

| What | Where |
|------|-------|
| Per-sound level, pitch/level jitter, cooldown, voice cap, priority, spatial, reverb send, bus | `src/audio/SoundCatalog.ts` (`gainDb` is the trim against the level convention) |
| Sample processing and loudness target | `assets/audio/recipe.json` (`spec`, `kinds`, `body`) |
| Master limiter and clipper, reverb return, duck attack/depth, voice caps, fades, preload tier, spatial curve | `src/core/config/audio/engine.ts` |
| Default bus volumes | `AUDIO_DEFAULT_VOLUMES` in `src/core/config/balance.ts` |
| World cues: event/flag/haul budgets, state-diff cooldowns, income thresholds, work bursts, machinery bed, blast timeline and ducks, siren, weather bed levels, thunder, distant life | `src/core/config/audio/game.ts` |
| Interface: hover/value/denied gaps, danger pitch, slider pitch, selection pitch, vehicle start delay | `src/core/config/audio/ui.ts` |
| Synth recipes and level targets | `src/core/config/audio/synth.ts` |
| Music fades and blast dip | `src/core/config/audio/music.ts` |
| Sound lab and `sounds:check` limits | `src/core/config/audio/lab.ts`; play log size in `src/core/config/audio/debug.ts` |
