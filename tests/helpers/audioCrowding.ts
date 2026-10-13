// BlastSimulator2026 — Crowding harness: a real game, the real audio directors, a recording engine
// Runs real console games (src/console) the way src/main.ts drives them, attaches the real
// GameAudioDirector to the real emitter and mirrors main.ts's wiring: every command goes through
// commandCue then director.onCommand, every 1/60 s frame ticks the game once per real second
// (`tick <speed>`) and calls director.update with a fake listener. The AudioPlayer is a recorder that
// applies the real engine's rules (the real VoiceBudget: cooldowns, per-sound caps, global cap and the
// real spatial culling), with voice lengths taken from the shipped MP3s and the synth config, so a
// test can count what a person would actually be asked to hear. Nothing here makes a sound.

import { readFileSync } from 'fs';
import { join } from 'path';
import type { AudioPlayer, Listener, LoopHandle, LoopOptions, PlayOptions, SoundHandle } from '../../src/audio/AudioPlayer.js';
import { SOUND_CATALOG, type LoopId, type OneShotId, type SoundBus, type SoundDefinition } from '../../src/audio/SoundCatalog.js';
import { computeSpatial } from '../../src/audio/engine/spatial.js';
import { VoiceBudget, type VoiceTicket } from '../../src/audio/engine/VoiceBudget.js';
import { GameAudioDirector } from '../../src/audio/director/GameAudioDirector.js';
import { commandCue } from '../../src/audio/ui/commandCues.js';
import { CommandClaim } from '../../src/audio/ui/CommandClaim.js';
import { parseCommand, type CommandResult } from '../../src/console/ConsoleRunner.js';
import { createRunner, runCommand, type RunnerWithContext } from '../../src/console/createRunner.js';
import { BASE_TICK_MS } from '../../src/core/config/balance.js';
import { VOICE_CONFIG } from '../../src/core/config/audio/engine.js';
import {
  BLAST_BEEP_CONFIG, BLAST_CANCEL_CONFIG, BLAST_SNAP_CONFIG, BLAST_SUB_CONFIG, DEVICE_SOUNDS,
  SIREN_CONFIG as SIREN_SYNTH_CONFIG,
} from '../../src/core/config/audio/synth.js';
import { Random } from '../../src/core/math/Random.js';
import { parseMp3 } from './mp3Info.js';
import type { GameState } from '../../src/core/state/GameState.js';

/** Frames per real second of the simulated render loop. */
const FRAMES_PER_S = 60;
const FRAME_S = 1 / FRAMES_PER_S;
const SFX_DIR = join(import.meta.dirname, '../../public/audio/sfx');

export type GameSpeed = 1 | 2 | 4 | 8;
/** Which code path asked for the sound: the player's command cue, or the world director. */
type CueSource = 'command' | 'director';

export interface PlayRecord {
  readonly id: OneShotId;
  readonly bus: SoundBus;
  /** Real second the play was requested. */
  readonly tS: number;
  /** Real second the sound starts (request plus delay). */
  readonly startS: number;
  readonly durationS: number;
  readonly key: string;
  readonly source: CueSource;
  readonly positional: boolean;
  /** False when the engine would have dropped it. */
  readonly accepted: boolean;
  readonly dropReason: 'culled' | 'budget' | null;
  /** Index of the console command (or frame) context it was requested in, for same-action pairing. */
  readonly commandIndex: number;
}

interface BedChange {
  readonly id: LoopId;
  readonly tS: number;
  readonly level: number;
}

interface DuckRecord {
  readonly bus: SoundBus;
  readonly tS: number;
  readonly amountDb: number;
}

/** Length in seconds of a shipped sample, read from its Xing header. */
function sampleDurationS(name: string): number {
  const info = parseMp3(readFileSync(join(SFX_DIR, `${name}.mp3`)));
  if (!info?.hasXing) throw new Error(`${name}.mp3 has no Xing header`);
  return info.durationS;
}

const SYNTH_DURATION_S: Readonly<Record<string, number>> = {
  blast_snap: BLAST_SNAP_CONFIG.durationSec,
  blast_sub: BLAST_SUB_CONFIG.durationSec,
  blast_beep: BLAST_BEEP_CONFIG.durationSec,
  blast_cancel: BLAST_CANCEL_CONFIG.durationSec,
  siren_loop: SIREN_SYNTH_CONFIG.durationSec,
  ...Object.fromEntries(Object.entries(DEVICE_SOUNDS).map(([id, device]) => [id, device.durationSec])),
};

const durationCache = new Map<string, number>();

/** How long a one-shot sounds: its longest variant, so overlap is never under-counted. */
export function soundDurationS(id: OneShotId): number {
  const cached = durationCache.get(id);
  if (cached !== undefined) return cached;
  const source = (SOUND_CATALOG[id] as SoundDefinition).source;
  const seconds = source.kind === 'sample'
    ? Math.max(...source.files.map(sampleDurationS))
    : SYNTH_DURATION_S[source.recipe] ?? 1;
  durationCache.set(id, seconds);
  return seconds;
}

interface Held {
  readonly endS: number;
  readonly ticket: VoiceTicket;
}

/**
 * An AudioPlayer that applies the engine's admission rules and records every request. Voices are held
 * from the request to the end of the sound, like the real SoundPlayer, and a stopped handle releases early.
 */
export class CrowdRecorder implements AudioPlayer {
  readonly ready = true;
  readonly plays: PlayRecord[] = [];
  readonly beds: BedChange[] = [];
  readonly ducks: DuckRecord[] = [];
  /** Real seconds, advanced by the sim. */
  nowS = 0;
  /** Tag stamped on each play. */
  source: CueSource = 'director';
  /** Index of the command in progress. */
  commandIndex = 0;
  private listener: Listener | null = null;
  private readonly budget = new VoiceBudget(VOICE_CONFIG.globalVoiceCap, () => this.nowS * 1000, VOICE_CONFIG.cooldownSweepThreshold);
  private held: Held[] = [];

  setListener(listener: Listener): void {
    this.listener = listener;
  }

  /** Give back the slots of voices that have finished by `nowS`. */
  advance(nowS: number): void {
    this.nowS = nowS;
    if (this.held.length === 0) return;
    const live: Held[] = [];
    for (const voice of this.held) {
      if (voice.endS <= nowS) voice.ticket.release();
      else live.push(voice);
    }
    this.held = live;
  }

  play(id: OneShotId, opts: PlayOptions = {}): SoundHandle | null {
    const def = SOUND_CATALOG[id] as SoundDefinition;
    const durationS = soundDurationS(id);
    const startS = this.nowS + Math.max(0, opts.delayS ?? 0);
    const key = opts.key ?? id;
    const base = { id, bus: opts.bus ?? def.bus, tS: this.nowS, startS, durationS, key, source: this.source, positional: opts.at !== undefined && def.spatial === true, commandIndex: this.commandIndex };
    if (def.spatial && opts.at && this.listener && !computeSpatial(this.listener, opts.at).audible) {
      this.plays.push({ ...base, accepted: false, dropReason: 'culled' });
      return null;
    }
    const ticket = this.budget.acquire(
      { sound: id, key, cooldownMs: def.cooldownMs ?? 0, maxVoices: def.maxVoices ?? Infinity, priority: def.priority },
      () => undefined,
    );
    if (!ticket) {
      this.plays.push({ ...base, accepted: false, dropReason: 'budget' });
      return null;
    }
    const held: Held = { endS: startS + durationS, ticket };
    this.held.push(held);
    this.plays.push({ ...base, accepted: true, dropReason: null });
    return { stop: () => { ticket.release(); this.held = this.held.filter(h => h !== held); } };
  }

  loop(id: LoopId, opts: LoopOptions = {}): LoopHandle {
    if (opts.level !== undefined) this.beds.push({ id, tS: this.nowS, level: opts.level });
    return {
      setLevel: (level: number) => { this.beds.push({ id, tS: this.nowS, level }); },
      stop: () => { this.beds.push({ id, tS: this.nowS, level: 0 }); },
    };
  }

  duck(bus: SoundBus, amountDb: number): void {
    this.ducks.push({ bus, tS: this.nowS, amountDb });
  }

  /** Accepted one-shots only. */
  get heard(): PlayRecord[] {
    return this.plays.filter(p => p.accepted);
  }
}

export interface CrowdSimOptions {
  readonly speed: GameSpeed;
  /** Seed of the director's random source. */
  readonly audioSeed?: number;
  /** Camera distance to its target (m). */
  readonly viewDistance?: number;
  /** Frames a scripted player waits after each command (a person cannot issue 60 commands a second). */
  readonly commandGapFrames?: number;
  /** A player who never answers a pending event (idle game). */
  readonly afk?: boolean;
}

/** Frames before a player answers an event dialog. */
const EVENT_REACTION_FRAMES = 90;
/** Real seconds a stalled wait may spin before the harness gives up. */
const STALL_LIMIT_S = 600;
const DEFAULT_GAP_FRAMES = 30;
const DEFAULT_VIEW_DISTANCE = 60;

/** A real game with the real audio directors attached, advanced frame by frame like src/main.ts. */
export class CrowdSim {
  readonly engine: RunnerWithContext = createRunner();
  readonly recorder = new CrowdRecorder();
  readonly director: GameAudioDirector;
  readonly commands: string[] = [];
  /** Player commands the game refused (each one is a `ui_denied`). */
  readonly refused: { readonly command: string; readonly output: string }[] = [];
  private readonly claim = new CommandClaim();
  private frameCount = 0;
  private framesSinceTick = 0;
  private listener: Listener | null = null;
  private speedSet = false;
  /** A full-screen menu is up: the game is hidden and frozen, exactly like fullScreenMenuUp() in main.ts. */
  menuUp = false;
  /** Ticks the auto-tick loop may still advance: unlimited when free-running, none while a person types. */
  private tickAllowance = Infinity;
  /** Frames the game was running (not paused, not ended). */
  runningFrames = 0;

  constructor(readonly options: CrowdSimOptions) {
    this.director = new GameAudioDirector({
      player: this.recorder,
      emitter: this.engine.emitter,
      random: new Random(options.audioSeed ?? 7),
      onError: (error) => { throw error instanceof Error ? error : new Error(String(error)); },
    });
  }

  get state(): GameState | null { return this.engine.ctx.state; }
  get realS(): number { return this.frameCount * FRAME_S; }

  /**
   * One console command typed by the player, voiced exactly like main.ts's runGameCommand, then a pause. The
   * game does not advance during that pause, so a scripted game follows the scenario's own trajectory at any
   * speed; the audio frames (and so every real-time timer) do advance.
   */
  command(cmd: string, gapFrames: number = this.options.commandGapFrames ?? DEFAULT_GAP_FRAMES, optional = false): CommandResult {
    const result = this.exec(cmd, true, optional);
    // A button that is not there is not clicked: an optional command that was refused costs no time.
    if (!(optional && !result.success)) this.withTicks(0, () => this.frames(gapFrames));
    return result;
  }

  /** Run `body` with the auto-tick loop allowed `ticks` more ticks. */
  private withTicks(ticks: number, body: () => void): void {
    const before = this.tickAllowance;
    this.tickAllowance = ticks;
    try {
      body();
    } finally {
      this.tickAllowance = before;
    }
  }

  /**
   * Choose the game speed once, with the command a player would use. Later `time speed` commands of a
   * script are ignored so every scenario runs at the speed under test.
   */
  chooseSpeed(): void {
    if (this.speedSet || this.state === null) return;
    this.speedSet = true;
    this.command(`time speed ${this.options.speed}`);
  }

  frames(count: number): void {
    for (let i = 0; i < count; i++) this.frame();
  }

  seconds(count: number): void {
    this.frames(Math.round(count * FRAMES_PER_S));
  }

  /** Let `ticks` game ticks pass at the chosen speed, answering events like a player. */
  waitTicks(ticks: number): void {
    const state = this.state;
    if (state === null) return;
    const target = state.tickCount + ticks;
    this.withTicks(ticks, () => this.runUntil(() => this.state === null || this.state.tickCount >= target || this.state.levelEnded));
  }

  /** Let ticks pass until `done()` (checked after each tick) or `maxTicks` have passed. */
  waitUntil(done: () => boolean, maxTicks: number): boolean {
    const state = this.state;
    if (state === null) return false;
    const target = state.tickCount + maxTicks;
    let seen = state.tickCount;
    let reached = false;
    this.withTicks(maxTicks, () => this.runUntil(() => {
      const now = this.state;
      if (now === null || now.levelEnded) return true;
      if (now.tickCount !== seen) {
        seen = now.tickCount;
        reached = done();
      }
      return reached || now.tickCount >= target;
    }));
    return reached;
  }

  /** One rendered frame: the auto-tick loop, then the director, then the voices that finished. */
  frame(): void {
    const state = this.state;
    this.recorder.advance(this.realS);
    if (state && !state.isPaused && !state.levelEnded && !this.menuUp && this.tickAllowance > 0) {
      this.runningFrames++;
      this.framesSinceTick++;
      if (this.framesSinceTick * FRAME_S * 1000 >= BASE_TICK_MS) {
        this.framesSinceTick = 0;
        const tickBefore = state.tickCount;
        this.exec(`tick ${Math.min(state.timeScale, this.tickAllowance)}`, false);
        // A tick refused for a pending event advanced nothing and spends nothing.
        this.tickAllowance -= (this.state?.tickCount ?? tickBefore) - tickBefore;
      }
    } else {
      this.framesSinceTick = 0;
    }
    this.director.update({ dtS: FRAME_S, state: this.state, menuUp: this.menuUp, listener: this.listenerFor(this.state) });
    this.frameCount++;
  }

  private runUntil(done: () => boolean): void {
    let waitingForPlayer = 0;
    const limit = this.frameCount + STALL_LIMIT_S * FRAMES_PER_S;
    while (!done() && this.frameCount < limit) {
      const state = this.state;
      // A script that waits on a game nobody resumed would wait for ever.
      if (state?.isPaused && !state.events.pendingEvent) return;
      if (state?.events.pendingEvent && !this.options.afk) {
        if (++waitingForPlayer >= EVENT_REACTION_FRAMES) {
          waitingForPlayer = 0;
          this.exec('event choose 0', true);
        }
      }
      this.frame();
    }
  }

  /** runGameCommand of main.ts: the command, the renderer's blast report, the command cue, the director. */
  private exec(cmd: string, byPlayer: boolean, optional = false): CommandResult {
    this.recorder.advance(this.realS);
    this.recorder.commandIndex++;
    this.commands.push(cmd);
    const prevState = this.state;
    const prevReport = prevState?.lastBlastReport ?? null;
    const result = runCommand(this.engine, cmd);
    const parsed = parseCommand(cmd);
    const voiced = byPlayer && !(optional && !result.success);
    if (voiced && !result.success) this.refused.push({ command: cmd, output: result.output });
    const state = this.state;
    if (state && state.lastBlastReport && state.lastBlastReport !== prevReport && state === prevState) this.reportBlast(state);
    if (voiced) {
      this.recorder.source = 'command';
      commandCue(this.recorder, parsed, result.success, { claim: this.claim });
      this.recorder.source = 'director';
    }
    this.director.onCommand({ parsed, success: result.success, prevState, state });
    if (state !== prevState && state) {
      // A new level starts at the speed the player already chose, and looks from over its own pit.
      state.timeScale = this.options.speed;
      this.listener = null;
    }
    return result;
  }

  /** What GameRendererBlastVisuals tells the director at the instant the flash starts. */
  private reportBlast(state: GameState): void {
    const { ctx } = this.engine;
    const fragments = ctx.lastBlastFragments ?? [];
    const grid = ctx.grid;
    const origin = fragments.length > 0
      ? { x: fragments.reduce((s, p) => s + p.x, 0) / fragments.length, z: fragments.reduce((s, p) => s + p.z, 0) / fragments.length }
      : { x: (grid?.minX ?? 0) + (grid?.sizeX ?? 0) / 2, z: (grid?.minZ ?? 0) + (grid?.sizeZ ?? 0) / 2 };
    this.director.onBlast({
      origin,
      holeCount: (ctx.lastBlastHoles ?? state.drillHoles).length,
      flights: ctx.lastBlastFlights ?? [],
      report: state.lastBlastReport,
    });
  }

  /** The camera sits over the middle of the pit, at a fixed zoom. */
  private listenerFor(state: GameState | null): Listener | null {
    const grid = this.engine.ctx.grid;
    if (state === null || grid === null) return null;
    this.listener ??= {
      x: grid.minX + grid.sizeX / 2,
      z: grid.minZ + grid.sizeZ / 2,
      rightX: 1,
      rightZ: 0,
      viewDistance: this.options.viewDistance ?? DEFAULT_VIEW_DISTANCE,
    };
    return this.listener;
  }
}
