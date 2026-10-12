// BlastSimulator2026 — Interface cues for UI chokepoints
// Small named entry points the UI calls where DOM delegation cannot see what happened (a panel sliding
// in, a toast, a pick on the 3D canvas). Each maps onto one catalog sound; none knows about audio nodes.

import type { AudioPlayer } from '../AudioPlayer.js';
import type { OneShotId } from '../SoundCatalog.js';
import { UI_SELECTION_PITCH_CENTS } from '../../core/config/audio/ui.js';
import { safePlay } from './safePlay.js';

/** Severity vocabulary of NotificationCenter. */
export type NotificationSeverity = 'info' | 'positive' | 'warn' | 'critical';

/** Things a click on the 3D scene can select. */
export type SelectionKind = keyof typeof UI_SELECTION_PITCH_CENTS;

/** The volume sliders of the settings panel. */
export type VolumeChannel = 'master' | 'effects' | 'ambient' | 'ui' | 'music';

/** Least to most severe; also the id each severity plays. */
const NOTIFICATION_CUES: Readonly<Record<NotificationSeverity, { readonly rank: number; readonly id: OneShotId }>> = {
  info: { rank: 0, id: 'notify_info' },
  positive: { rank: 1, id: 'notify_good' },
  warn: { rank: 2, id: 'notify_warn' },
  critical: { rank: 3, id: 'notify_bad' },
};

export class UiCues {
  private pendingSeverity: NotificationSeverity | null = null;

  /**
   * @param defer Runs a task after the current synchronous work. The simulation applies a whole tick as one
   *   synchronous command, so every toast of that tick lands before the task and only one is voiced.
   */
  constructor(
    private readonly player: AudioPlayer,
    private readonly defer: (task: () => void) => void = task => queueMicrotask(task),
  ) {}

  /** A side panel opened or closed (every route: rail, shortcut, Escape). */
  panelShown(open: boolean): void {
    safePlay(this.player, open ? 'ui_open' : 'ui_close');
  }

  /** A toast or log entry arrived. Several in one tick collapse into the most severe one. */
  notification(severity: NotificationSeverity): void {
    const pending = this.pendingSeverity;
    if (pending !== null) {
      if (NOTIFICATION_CUES[severity].rank > NOTIFICATION_CUES[pending].rank) this.pendingSeverity = severity;
      return;
    }
    this.pendingSeverity = severity;
    this.defer(() => this.flushNotification());
  }

  /** The player picked a thing in the 3D scene. */
  entitySelected(kind: SelectionKind): void {
    safePlay(this.player, 'ui_select', { pitchCents: UI_SELECTION_PITCH_CENTS[kind] });
  }

  /** A placement click was refused (blocked cell, no funds). */
  placementRefused(): void {
    safePlay(this.player, 'ui_invalid');
  }

  /** A modal dialog appeared. */
  modalShown(): void {
    safePlay(this.player, 'ui_modal');
  }

  /** The player accepted a confirmation dialog. */
  confirmAccepted(): void {
    safePlay(this.player, 'ui_confirm');
  }

  /**
   * A settings slider moved: tick on the bus the slider controls, so the player hears the level they are
   * setting. Master and music have no bus of their own here and are heard on the interface bus.
   * The controlling `<input>` should carry `data-sfx="none"` so delegation does not tick as well.
   */
  volumeAdjusted(channel: VolumeChannel): void {
    const bus = channel === 'effects' || channel === 'ambient' ? channel : undefined;
    safePlay(this.player, 'ui_slider', bus === undefined ? undefined : { bus });
  }

  private flushNotification(): void {
    const severity = this.pendingSeverity;
    this.pendingSeverity = null;
    if (severity !== null) safePlay(this.player, NOTIFICATION_CUES[severity].id);
  }
}
