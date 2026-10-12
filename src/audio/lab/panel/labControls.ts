// BlastSimulator2026 — What the lab panel drives
// The panel only knows this narrow surface, so it is built and tested without a
// browser audio context; the page supplies the real thing.

import type { AudioPlayer } from '../../AudioPlayer.js';
import type { VolumeChannel } from '../../AudioManager.js';
import type { AssetReport, MixReport } from '../labReport.js';
import type { MixScenarioName } from '../mixTypes.js';
import type { LabStatus } from './labStatus.js';

export interface LabControls {
  readonly player: AudioPlayer;
  getVolume(channel: VolumeChannel): number;
  setVolume(channel: VolumeChannel, value: number): void;
  status(): LabStatus;
  assets(): AssetReport;
  /** Play the representative blast timeline. */
  playBlast(): void;
  /** Start or stop the busy-mine bed; returns whether it is running now. */
  toggleBusyMine(): boolean;
  /** Silence everything the lab is playing, scenarios included. */
  stopAll(): void;
  /** Render a scenario offline, offer it as a WAV download and return its measurements. */
  downloadMix(name: MixScenarioName): Promise<MixReport>;
}
