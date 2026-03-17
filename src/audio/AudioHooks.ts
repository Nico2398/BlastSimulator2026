// BlastSimulator2026 — Audio Event Hooks (11.3)
// Wires game events to AudioManager sounds.
// Called from main.ts after each command and on each frame.

import { AudioManager } from './AudioManager.js';
import { SoundLibrary } from './Placeholder.js';
import type { SoundHandle } from './AudioManager.js';
import type { WeatherState } from '../core/weather/WeatherCycle.js';

export class AudioHooks {
  private readonly audio: AudioManager;
  private readonly lib: SoundLibrary;

  private ambientHandle: SoundHandle | null = null;
  private rainHandle: SoundHandle | null = null;
  private currentWeather: WeatherState | null = null;

  constructor(audio: AudioManager) {
    this.audio = audio;
    this.lib = new SoundLibrary(audio.getContext());
  }

  /** Call when UI button is clicked. */
  onUIClick(): void {
    this.audio.resume().then(() => {
      this.audio.playBuffer(this.lib.get('beep'), 'ui');
    });
  }

  /** Call when a blast is executed. Staggers boom sounds by sequence delays. */
  onBlast(sequenceDelays: Record<string, number>): void {
    this.audio.resume().then(() => {
      // Play a boom per hole at the correct delay, up to 8 holes (cap for sanity)
      const entries = Object.entries(sequenceDelays).slice(0, 8);
      if (entries.length === 0) {
        // No sequence: single boom immediately
        this.audio.playBuffer(this.lib.get('boom'), 'effects');
      } else {
        for (const [, delayMs] of entries) {
          this.audio.playBuffer(this.lib.get('boom'), 'effects', delayMs);
        }
      }
      // Post-blast rumble at the end of the sequence
      const maxDelay = entries.reduce((m, [, d]) => Math.max(m, d), 0);
      this.audio.playBuffer(this.lib.get('rumble'), 'effects', maxDelay + 800);
    });
  }

  /** Call when a fragment hits the ground. */
  onFragmentImpact(): void {
    this.audio.resume().then(() => {
      this.audio.playBuffer(this.lib.get('thud'), 'effects');
    });
  }

  /** Call when an event notification fires (pending event). */
  onEventNotification(): void {
    this.audio.resume().then(() => {
      this.audio.playBuffer(this.lib.get('chime'), 'ui');
    });
  }

  /** Call to start ambient mine hum (once per game session). */
  startAmbient(): void {
    if (this.ambientHandle) return;
    this.audio.resume().then(() => {
      this.ambientHandle = this.audio.playLooping(this.lib.get('ambient'), 'ambient');
    });
  }

  /** Call when weather state changes. Manages rain loop. */
  onWeatherChange(weather: WeatherState): void {
    if (weather === this.currentWeather) return;
    this.currentWeather = weather;

    const isRainy = weather === 'light_rain' || weather === 'heavy_rain' || weather === 'storm';

    if (isRainy && !this.rainHandle) {
      this.audio.resume().then(() => {
        // Adjust ambient volume for rain
        this.audio.setVolume('ambient', weather === 'storm' ? 0.5 : 0.3);
        this.rainHandle = this.audio.playLooping(this.lib.get('rain'), 'ambient');
      });
    } else if (!isRainy && this.rainHandle) {
      this.rainHandle.stop();
      this.rainHandle = null;
      this.audio.setVolume('ambient', 0.4);
    }
  }

  /** Stop all looping sounds. */
  stopAll(): void {
    this.ambientHandle?.stop();
    this.ambientHandle = null;
    this.rainHandle?.stop();
    this.rainHandle = null;
  }

  dispose(): void {
    this.stopAll();
    this.audio.dispose();
  }
}
