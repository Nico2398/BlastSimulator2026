// BlastSimulator2026 — Game audio director
// The one object the game talks to for the world's sound: feeds, work sites, the
// blast timeline, the evacuation siren, ambience and distant life, composed.
// It depends only on the AudioPlayer, the core event emitter and plain game
// state, so a recording fake player and hand-built states test it end to end.
//
// Integration (src/main.ts and the renderer call these; nothing here knows them):
//   afterGameCommand   director.onCommand({ command, success, prevState, state })
//   every frame        director.update({ dtS, state, menuUp, listener })      real seconds
//   blast effects sync director.onBlast({ origin, holeCount, flights, report })
//   playback skipped   director.cancelBlast()
//   sky lightning      director.onLightning()
//   dispose            director.dispose()
// The director forwards the listener to the player, so the caller need not.

import type { AudioPlayer, Listener } from '../AudioPlayer.js';
import type { EventEmitter } from '../../core/state/EventEmitter.js';
import type { GameState } from '../../core/state/GameState.js';
import type { Random } from '../../core/math/Random.js';
import { getEventById } from '../../core/events/EventPool.js';
import { parseCommand } from '../../console/ConsoleRunner.js';
import { DIRECTOR_CONFIG } from '../../core/config/audio/game.js';
import { clamp } from '../engine/units.js';
import { Ambience } from './Ambience.js';
import { BlastAudio } from './BlastAudio.js';
import type { BlastInfo } from './blastPlan.js';
import { DistantLife } from './DistantLife.js';
import { createDirectorEnv } from './env.js';
import { EvacuationSiren, evacuationRemaining } from './EvacuationSiren.js';
import { EventFeed } from './EventFeed.js';
import { LevelStings } from './LevelStings.js';
import { StateDiffFeed } from './StateDiffFeed.js';
import { Subscriptions } from './Subscriptions.js';
import type { DirectorEnv, EntityPositionFn } from './types.js';
import { WorkSounds } from './WorkSounds.js';

interface GameAudioDirectorOptions {
  readonly player: AudioPlayer;
  readonly emitter: EventEmitter;
  readonly random: Random;
  /** The renderer's interpolated position of an entity; core state positions are the fallback. */
  readonly entityPosition?: EntityPositionFn;
  /** Category of a game event, for its stinger; defaults to the event pool's. */
  readonly eventCategory?: (eventId: string) => string | undefined;
  /** Receives errors from event handlers and entry points; they never reach the caller. */
  readonly onError?: (error: unknown) => void;
}

export interface CommandReport {
  /** The raw command line that just ran. */
  readonly command: string;
  readonly success: boolean;
  /** The game state before the command; a different object from `state` means a new level or a load. */
  readonly prevState: GameState | null;
  readonly state: GameState | null;
}

export interface FrameInput {
  /** Real seconds since the previous frame. */
  readonly dtS: number;
  /** The running game; null at the main menu. */
  readonly state: GameState | null;
  /** A full-screen menu (main menu, world map, level end, loading) hides the game. */
  readonly menuUp: boolean;
  readonly listener: Listener | null;
}

export class GameAudioDirector {
  private readonly env: DirectorEnv;
  private readonly subscriptions: Subscriptions;
  private readonly events: EventFeed;
  private readonly diff: StateDiffFeed;
  private readonly stings: LevelStings;
  private readonly work: WorkSounds;
  private readonly blast: BlastAudio;
  private readonly siren: EvacuationSiren;
  private readonly ambience: Ambience;
  private readonly life: DistantLife;

  private nowS = 0;
  private state: GameState | null = null;
  private listener: Listener | null = null;
  private menuUp = false;
  private evacuationLeft: number | null = null;
  private failed = false;

  constructor(private readonly options: GameAudioDirectorOptions) {
    this.env = createDirectorEnv({
      player: options.player,
      random: options.random,
      now: () => this.nowS,
      listener: () => this.listener,
      state: () => this.state,
      entityPosition: options.entityPosition,
    });
    this.stings = new LevelStings(this.env);
    this.events = new EventFeed(this.env, this.stings);
    this.diff = new StateDiffFeed(this.env, options.eventCategory ?? (id => getEventById(id)?.category));
    this.work = new WorkSounds(this.env);
    this.blast = new BlastAudio(this.env, seconds => this.work.suppress(seconds));
    this.siren = new EvacuationSiren(this.env);
    this.ambience = new Ambience(this.env);
    this.life = new DistantLife(this.env);

    this.subscriptions = new Subscriptions(options.emitter, error => this.report(error));
    this.events.attach(this.subscriptions);
    this.subscriptions.on('blast:started', () => {
      this.blast.preRoll();
      this.siren.notifyDetonation();
    });
  }

  /** After every console command, whatever it was. */
  onCommand(report: CommandReport): void {
    this.guard(() => {
      const { state } = report;
      if (state === null) return;
      if (state !== this.state || report.prevState !== state) {
        this.beginLevel(state);
        return;
      }
      this.observe(state);
      const parsed = parseCommand(report.command);
      if (report.success && parsed.command === 'blast' && parsed.args[0] === 'cancel') this.siren.notifyCancelled();
    });
  }

  /** Once per rendered frame, with real seconds. */
  update(frame: FrameInput): void {
    this.guard(() => {
      const dtS = clamp(frame.dtS, 0, DIRECTOR_CONFIG.maxFrameStepS);
      this.nowS += dtS;
      this.menuUp = frame.menuUp;
      this.listener = frame.listener;
      if (frame.listener) this.options.player.setListener(frame.listener);

      const { state } = frame;
      if (state !== this.state) this.beginLevel(state);
      else if (state !== null && state.tickCount !== this.diff.lastTick) this.observe(state);

      const playing = state !== null && !frame.menuUp;
      const frozen = state === null || state.isPaused || state.levelEnded;
      this.events.update(dtS);
      if (playing) this.events.flush();
      else this.events.clear();
      this.work.update(dtS, playing && !frozen);
      if (frame.menuUp) this.blast.hush();
      this.blast.update(dtS);
      this.siren.update(dtS, {
        armed: state !== null && state.pendingDetonation !== null,
        remaining: this.evacuationLeft,
        muted: !playing || state.levelEnded,
      });
      this.ambience.update(dtS, {
        weather: state?.weather.current ?? null,
        paused: frozen,
        menuUp: frame.menuUp,
        viewDistance: frame.listener?.viewDistance ?? null,
      });
      this.life.update(dtS, playing && !frozen);
    });
  }

  /** The renderer fires a blast's flash and shake: its sound starts now. */
  onBlast(info: BlastInfo): void {
    this.guard(() => {
      if (this.state === null || this.menuUp) return;
      this.siren.notifyDetonation();
      this.blast.play(info, this.diff.takeBlastChargeKg());
    });
  }

  /** Playback of the blast was skipped: cut its scheduled sounds. */
  cancelBlast(): void {
    this.guard(() => this.blast.cancel());
  }

  /** The sky flashed: thunder follows. */
  onLightning(): void {
    this.guard(() => this.ambience.onLightning());
  }

  /** Forget everything transient: a new level, a load, a return to the menu. The next look at the world is a silent baseline. */
  reset(): void {
    this.guard(() => this.forget());
  }

  /** Stop listening to the game and silence every bed. */
  dispose(): void {
    this.guard(() => {
      this.subscriptions.dispose();
      this.forget();
      this.ambience.clear();
    });
  }

  private forget(): void {
    this.state = null;
    this.evacuationLeft = null;
    this.diff.forget();
    this.events.reset();
    this.stings.reset();
    this.blast.cancel();
    this.siren.clear();
    this.work.clear();
    this.life.reset();
    this.env.gate.clear();
  }

  /** A different game state object: silently baseline it. */
  private beginLevel(state: GameState | null): void {
    this.forget();
    this.state = state;
    if (state === null) return;
    this.diff.observe(state, true);
    this.work.refresh(state);
    this.evacuationLeft = evacuationRemaining(state);
  }

  /** Look at the world after a command or a tick: cues, flags, work sites. */
  private observe(state: GameState): void {
    const worldDiff = this.diff.observe(state, this.menuUp);
    if (worldDiff.levelEnd !== null && !this.menuUp) this.stings.play(worldDiff.levelEnd);
    if (worldDiff.blastLanded) this.siren.notifyDetonation();
    this.work.refresh(state);
    this.evacuationLeft = evacuationRemaining(state);
    if (this.menuUp) this.events.clear();
    else this.events.flush();
  }

  private guard(action: () => void): void {
    try {
      action();
    } catch (error) {
      this.report(error);
    }
  }

  private report(error: unknown): void {
    if (this.options.onError) {
      this.options.onError(error);
      return;
    }
    if (this.failed) return;
    this.failed = true;
    console.error('Game audio director error (audio continues without it):', error);
  }
}
